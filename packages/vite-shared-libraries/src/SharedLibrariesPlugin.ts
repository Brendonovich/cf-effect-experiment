import type { HtmlTagDescriptor, Plugin, ResolvedConfig, Rolldown, ViteDevServer } from "vite";

import { SharedLibraries } from "@macrograph/module/SharedLibraries";
import { join, posix, relative, sep } from "node:path";

import * as BuildManifest from "./BuildManifest.ts";
import * as ImportMap from "./ImportMap.ts";
import * as PackageExports from "./PackageExports.ts";

export interface Options {
  /** Shared specifier patterns. A trailing `/*` expands to every subpath in the package's `exports`. */
  readonly specifiers?: ReadonlyArray<string>;
  /** Specifiers removed after expansion. */
  readonly exclude?: ReadonlyArray<string>;
  /**
   * Inject an import map in dev that points at Vite's pre-bundled dependencies and linked
   * workspace sources, so prebuilt module UI can share the dev server's instances.
   */
  readonly devImportMap?: boolean;
}

export interface SharedSpecifier {
  readonly specifier: string;
  readonly package: PackageExports.Package;
  /** A directory from which Node resolution finds the package. */
  readonly resolveFrom: string;
}

/**
 * Expands shared specifier patterns into concrete specifiers using each package's real `exports`
 * field. Packages are located from `root` first, then from the other shared packages, so
 * transitive shared dependencies (such as `@tanstack/solid-query` through `@macrograph/editor-ui`)
 * are found even when the app does not depend on them directly.
 */
export const expand = (
  root: string,
  patterns: ReadonlyArray<string> = SharedLibraries.browser,
  exclude: ReadonlyArray<string> = SharedLibraries.browserExcluded,
): ReadonlyArray<SharedSpecifier> => {
  const names = [...new Set(patterns.map((pattern) => SharedLibraries.packageName(pattern)))];
  const located = new Map<
    string,
    { readonly package: PackageExports.Package; readonly from: string }
  >();
  let progress = true;
  while (progress && located.size < names.length) {
    progress = false;
    const searchFrom = [root, ...[...located.values()].map((entry) => entry.package.directory)];
    for (const name of names) {
      if (located.has(name)) continue;
      for (const from of searchFrom) {
        const pkg = PackageExports.locate(name, from);
        if (pkg === undefined) continue;
        located.set(name, { package: pkg, from });
        progress = true;
        break;
      }
    }
  }
  const missing = names.filter((name) => !located.has(name));
  if (missing.length > 0)
    throw new Error(`Shared libraries could not be located from ${root}: ${missing.join(", ")}`);

  const result = new Map<string, SharedSpecifier>();
  for (const pattern of patterns) {
    const name = SharedLibraries.packageName(pattern);
    const entry = located.get(name);
    if (entry === undefined) continue;
    const add = (specifier: string) => {
      if (!exclude.includes(specifier))
        result.set(specifier, { specifier, package: entry.package, resolveFrom: entry.from });
    };
    if (pattern.endsWith("/*")) {
      for (const subpath of PackageExports.subpaths(entry.package))
        if (subpath !== ".") add(PackageExports.specifier(name, subpath));
      continue;
    }
    const subpath = pattern === name ? "." : `.${pattern.slice(name.length)}`;
    const file = PackageExports.resolveSubpath(entry.package, subpath);
    if (file === undefined || !PackageExports.isScript(file))
      throw new Error(`Shared library ${pattern} does not resolve to a script`);
    add(pattern);
  }
  return [...result.values()].sort((a, b) => (a.specifier < b.specifier ? -1 : 1));
};

/** `_shared/[hash]/solid-js/store.js` for `solid-js/store`. */
const sharedFileName = (specifier: string) =>
  `${BuildManifest.sharedDirectory}/[hash]/${specifier.replace(/[^\w@./-]/g, "_")}.js`;

const toPosix = (path: string) => path.split(sep).join("/");

const isChunk = (output: Rolldown.OutputBundle[string]): output is Rolldown.OutputChunk =>
  output.type === "chunk";

/**
 * Shares library instances between the host app and separately built module UI.
 *
 * In production builds each shared specifier becomes its own entry chunk under
 * `/_shared/<hash>/...` with every export preserved. The host's own imports of those libraries
 * resolve to the same modules, so there is exactly one instance of each. An inline import map is
 * added to `index.html` so module UI can import the same files by bare specifier, and a build
 * manifest with the import map's CSP hash is written to {@link BuildManifest.file}.
 */
export const sharedLibraries = (options: Options = {}): Plugin => {
  let config: ResolvedConfig;
  let shared: ReadonlyArray<SharedSpecifier> = [];
  /** Specifiers sharing one module, keyed by its resolved id. The first is the canonical name. */
  const groups = new Map<string, Array<string>>();
  let server: ViteDevServer | undefined;

  const importMapFromBundle = (bundle: Rolldown.OutputBundle) => {
    const imports: Record<string, string> = {};
    const files: Array<string> = [];
    for (const output of Object.values(bundle)) {
      if (!isChunk(output) || !output.isEntry || typeof output.facadeModuleId !== "string")
        continue;
      const specifiers = groups.get(output.facadeModuleId);
      if (specifiers === undefined) continue;
      for (const specifier of specifiers) imports[specifier] = `${config.base}${output.fileName}`;
      files.push(output.fileName);
    }
    return { map: ImportMap.make(imports), files: files.sort() };
  };

  const importMapTag = (map: ImportMap.Model): HtmlTagDescriptor => ({
    tag: "script",
    attrs: { type: "importmap" },
    children: ImportMap.serialize(map),
    injectTo: "head-prepend",
  });

  const devUrl = (file: string) => {
    const [path = file, query] = file.split("?", 2);
    const relativePath = toPosix(relative(config.root, path));
    const url =
      relativePath.startsWith("..") || posix.isAbsolute(relativePath)
        ? `@fs${toPosix(path).startsWith("/") ? "" : "/"}${toPosix(path)}`
        : relativePath;
    return `${config.base}${url}${query === undefined ? "" : `?${query}`}`;
  };

  const devImportMap = async () => {
    const environment = server?.environments.client;
    if (environment === undefined) return undefined;
    const optimizer = environment.depsOptimizer;
    await optimizer?.scanProcessing;
    const optimized = optimizer
      ? { ...optimizer.metadata.discovered, ...optimizer.metadata.optimized }
      : {};
    const imports: Record<string, string> = {};
    for (const entry of shared) {
      const info = optimized[entry.specifier];
      if (info !== undefined && optimizer !== undefined) {
        imports[entry.specifier] = devUrl(optimizer.getOptimizedDepId(info));
        continue;
      }
      // Only linked workspace sources are resolved directly; resolving an undiscovered
      // node_modules dependency would register it with the optimizer and trigger a reload.
      if (entry.package.directory.split(sep).includes("node_modules")) continue;
      const resolved = await environment.pluginContainer.resolveId(
        entry.specifier,
        join(entry.resolveFrom, "index.html"),
      );
      if (resolved !== null && !resolved.external) imports[entry.specifier] = devUrl(resolved.id);
    }
    return ImportMap.make(imports);
  };

  return {
    name: "macrograph:shared-libraries",
    applyToEnvironment: (environment) => environment.config.consumer === "client",
    config: (userConfig, env) => {
      if (env.command !== "build") return;
      const output =
        userConfig.build?.rolldownOptions?.output ?? userConfig.build?.rollupOptions?.output;
      if (Array.isArray(output))
        throw new Error("sharedLibraries does not support multiple outputs");
      const fallback = posix.join(userConfig.build?.assetsDir ?? "assets", "[name]-[hash].js");
      // Rolldown names emitted chunks with `chunkFileNames`, input entries with `entryFileNames`.
      const fileNames =
        (previous: string | ((chunk: Rolldown.PreRenderedChunk) => string) | undefined) =>
        (chunk: Rolldown.PreRenderedChunk) => {
          const specifiers =
            chunk.isEntry && typeof chunk.facadeModuleId === "string"
              ? groups.get(chunk.facadeModuleId)
              : undefined;
          if (specifiers?.[0] !== undefined) return sharedFileName(specifiers[0]);
          if (typeof previous === "function") return previous(chunk);
          return previous ?? fallback;
        };
      return {
        build: {
          rolldownOptions: {
            output: {
              entryFileNames: fileNames(output?.entryFileNames),
              chunkFileNames: fileNames(output?.chunkFileNames),
            },
          },
        },
      };
    },
    configResolved: (resolved) => {
      config = resolved;
      shared = expand(
        resolved.root,
        options.specifiers ?? SharedLibraries.browser,
        options.exclude ?? SharedLibraries.browserExcluded,
      );
    },
    configureServer: (devServer) => {
      server = devServer;
    },
    async buildStart() {
      if (config.command !== "build") return;
      groups.clear();
      for (const entry of shared) {
        const resolved = await this.resolve(
          entry.specifier,
          join(entry.resolveFrom, "index.html"),
          {
            skipSelf: true,
          },
        );
        if (resolved === null || resolved.external) {
          this.warn(`Shared library ${entry.specifier} could not be resolved`);
          continue;
        }
        const existing = groups.get(resolved.id);
        if (existing !== undefined) {
          existing.push(entry.specifier);
          continue;
        }
        groups.set(resolved.id, [entry.specifier]);
        this.emitFile({
          type: "chunk",
          id: resolved.id,
          name: entry.specifier,
          preserveSignature: "strict",
        });
      }
    },
    transformIndexHtml: {
      order: "post",
      handler: async (_html, context) => {
        if (context.bundle !== undefined)
          return [importMapTag(importMapFromBundle(context.bundle).map)];
        if (options.devImportMap === false || server === undefined) return;
        const map = await devImportMap();
        return map === undefined ? undefined : [importMapTag(map)];
      },
    },
    generateBundle(_options, bundle) {
      const { map, files } = importMapFromBundle(bundle);
      const manifest: BuildManifest.Model = {
        version: 1,
        importMap: map,
        scriptSrc: [ImportMap.cspSource(ImportMap.serialize(map))],
        files,
      };
      this.emitFile({
        type: "asset",
        fileName: BuildManifest.file,
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
};

export * as SharedLibrariesPlugin from "./SharedLibrariesPlugin.ts";
