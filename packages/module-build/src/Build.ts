import type { Manifest } from "@macrograph/module/Manifest";

import { ModulePackage } from "@macrograph/module/ModulePackage";
import { SharedLibraries } from "@macrograph/module/SharedLibraries";
import { stylexProps } from "@macrograph/module/vite";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { Effect, Schema } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { rolldown, type Plugin as RolldownPlugin } from "rolldown";
import { build as viteBuild, type Plugin as VitePlugin, type Rolldown } from "vite";

import { Checks } from "./Checks.ts";
import { PackageConfig } from "./PackageConfig.ts";
import { StyleX } from "./StyleX.ts";

export interface Options {
  /** The module's package directory (the folder with its `package.json`). */
  readonly packageDirectory: string;
  /** Where the package folder is written. Emptied first. */
  readonly outDirectory: string;
  /**
   * Root that StyleX hashes token file paths against. Defaults to the nearest ancestor with a
   * `pnpm-workspace.yaml`, or the package directory.
   */
  readonly rootDirectory?: string;
  readonly limits?: Partial<Checks.Limits>;
  /** Fail the build when a check reports an error. Defaults to true. */
  readonly failOnError?: boolean;
  /** Minify the UI bundle. Defaults to true. The server entry is never minified. */
  readonly minifyUi?: boolean;
}

export interface Result {
  readonly config: PackageConfig.Model;
  readonly manifest: Manifest.Model;
  readonly outDirectory: string;
  readonly issues: ReadonlyArray<Checks.Issue>;
  /** `node:` built-ins the server entry requires, without the prefix. */
  readonly nodeBuiltins: ReadonlyArray<string>;
}

export class BuildError extends Schema.TaggedError<BuildError>()("ModuleBuildError", {
  packageDirectory: Schema.String,
  reason: Schema.String,
  issues: Schema.Array(Schema.Unknown),
}) {}

const fail = (packageDirectory: string, reason: string, issues: ReadonlyArray<Checks.Issue> = []) =>
  new BuildError({ packageDirectory, reason, issues });

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const builtinName = (specifier: string) => {
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  return builtins.has(bare) || specifier.startsWith("node:") ? bare : undefined;
};

const missingPrefix = "\0macrograph-missing:";

/**
 * Leaves shared server libraries and Node built-ins as `require(...)` calls and turns
 * unresolvable optional `require`s into stubs that throw, so the bundle only ever requires
 * what the host resolves.
 */
const serverExternals = (external: ReadonlySet<string>): RolldownPlugin => ({
  name: "macrograph-module-server-externals",
  async resolveId(source, importer, extra) {
    if (SharedLibraries.isShared(source, "server") || external.has(source))
      return { id: source, external: true };
    const builtin = builtinName(source);
    if (builtin !== undefined) return { id: `node:${builtin}`, external: true };
    if (extra.kind !== "require-call" || source.startsWith(".") || source.startsWith("/"))
      return null;
    const resolved = await this.resolve(source, importer, { skipSelf: true, kind: extra.kind });
    return resolved === null ? `${missingPrefix}${source}` : null;
  },
  load(id) {
    if (!id.startsWith(missingPrefix)) return null;
    const specifier = id.slice(missingPrefix.length);
    return `throw new Error(${JSON.stringify(`Cannot find module '${specifier}'`)});`;
  },
});

const packageNames = new Map<string, string | undefined>();
/** The name of the package that owns a file, from its nearest `package.json`. */
const packageNameOf = (file: string): string | undefined => {
  let directory = dirname(file);
  const visited: Array<string> = [];
  while (true) {
    const cached = packageNames.get(directory);
    if (cached !== undefined || packageNames.has(directory)) {
      for (const path of visited) packageNames.set(path, cached);
      return cached;
    }
    visited.push(directory);
    const packageJson = join(directory, "package.json");
    if (existsSync(packageJson)) {
      const parsed: unknown = JSON.parse(readFileSync(packageJson, "utf8"));
      const name =
        typeof parsed === "object" &&
        parsed !== null &&
        "name" in parsed &&
        typeof parsed.name === "string"
          ? parsed.name
          : undefined;
      // Nested package.json files without a name (e.g. `{ "type": "module" }`) don't own a package.
      if (name !== undefined) {
        for (const path of visited) packageNames.set(path, name);
        return name;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      for (const path of visited) packageNames.set(path, undefined);
      return undefined;
    }
    directory = parent;
  }
};

const graphModules = (moduleIds: Iterable<string>) =>
  [...moduleIds]
    .filter((id) => !id.startsWith("\0"))
    .map((id) => {
      const file = id.split("?")[0] ?? id;
      return { id, packageName: file.startsWith(sep) ? packageNameOf(file) : undefined };
    });

const buildServer = (options: {
  readonly packageDirectory: string;
  readonly entry: string;
  readonly outFile: string;
  readonly config: PackageConfig.Model;
}) =>
  Effect.tryPromise({
    try: async () => {
      const bundle = await rolldown({
        input: resolve(options.packageDirectory, options.entry),
        cwd: options.packageDirectory,
        platform: "node",
        logLevel: "warn",
        plugins: [serverExternals(new Set(options.config.build?.external ?? []))],
      });
      try {
        const output = await bundle.generate({
          format: "cjs",
          exports: "named",
          codeSplitting: false,
          dynamicImportInCjs: false,
          minify: false,
        });
        const chunks = output.output.filter((item) => item.type === "chunk");
        const [chunk] = chunks;
        if (chunk === undefined || chunks.length !== 1)
          throw new Error(`Expected one server chunk, got ${chunks.length}`);
        await writeFile(options.outFile, chunk.code);
        return { code: chunk.code, moduleIds: chunk.moduleIds };
      } finally {
        await bundle.close();
      }
    },
    catch: (cause) =>
      /top-level await/i.test(String(cause))
        ? fail(options.packageDirectory, `Server build failed: ${String(cause)}`, [
            {
              severity: "error",
              code: "top-level-await",
              message: "Server code uses top-level await, which the host cannot evaluate",
              path: ModulePackage.ServerEntry,
            },
          ])
        : fail(options.packageDirectory, `Server build failed: ${String(cause)}`),
  });

const stylesFile = basename(ModulePackage.UiStyles);

const cssAssets = (bundle: Rolldown.OutputBundle) =>
  Object.values(bundle).flatMap((item) =>
    item.type === "asset" && item.fileName.endsWith(".css") ? [item] : [],
  );

/**
 * Collects every stylesheet, including StyleX's extracted CSS, into `ui/styles.css`. StyleX
 * only appends to a CSS asset that exists during `generateBundle`, so a placeholder is emitted
 * first; otherwise it writes a stray `assets/stylex.css` after the bundle is written.
 */
const uiStyles = (): VitePlugin => ({
  name: "macrograph-module-ui-styles",
  generateBundle: {
    order: "pre",
    handler(_options, bundle) {
      if (cssAssets(bundle).length === 0)
        this.emitFile({ type: "asset", fileName: "macrograph-styles-placeholder.css", source: "" });
    },
  },
});

const mergeUiStyles = (): VitePlugin => ({
  name: "macrograph-module-ui-styles-merge",
  enforce: "post",
  generateBundle: {
    order: "post",
    handler(_options, bundle) {
      const assets = cssAssets(bundle);
      const source = assets
        .map((asset) =>
          typeof asset.source === "string" ? asset.source : new TextDecoder().decode(asset.source),
        )
        .filter((css) => css.trim() !== "")
        .join("\n");
      for (const asset of assets) delete bundle[asset.fileName];
      if (source !== "") this.emitFile({ type: "asset", fileName: stylesFile, source });
    },
  },
});

const buildUi = (options: {
  readonly packageDirectory: string;
  readonly rootDirectory: string;
  readonly entry: string;
  readonly outDirectory: string;
  readonly minify: boolean;
}) =>
  Effect.tryPromise({
    try: async () => {
      const result = await viteBuild({
        configFile: false,
        root: options.packageDirectory,
        mode: "production",
        logLevel: "warn",
        publicDir: false,
        css: { postcss: { plugins: [] } },
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        plugins: [
          uiStyles(),
          stylexProps(),
          stylex.vite(StyleX.options(options.rootDirectory)),
          solid(),
          mergeUiStyles(),
        ],
        build: {
          outDir: options.outDirectory,
          emptyOutDir: true,
          copyPublicDir: false,
          target: "esnext",
          minify: options.minify,
          sourcemap: false,
          cssCodeSplit: false,
          reportCompressedSize: false,
          lib: {
            entry: resolve(options.packageDirectory, options.entry),
            formats: ["es"],
            fileName: () => basename(ModulePackage.UiEntry),
            cssFileName: basename(ModulePackage.UiStyles, ".css"),
          },
          rolldownOptions: {
            external: (id: string) => SharedLibraries.isShared(id, "browser"),
            output: {
              chunkFileNames: "[name]-[hash].js",
              assetFileNames: "[name]-[hash][extname]",
            },
          },
        },
      });
      const outputs = (Array.isArray(result) ? result : [result]).flatMap(
        (item: Rolldown.RolldownOutput | unknown) =>
          typeof item === "object" && item !== null && "output" in item
            ? (item as Rolldown.RolldownOutput).output
            : [],
      );
      return outputs.flatMap((item) => (item.type === "chunk" ? item.moduleIds : []));
    },
    catch: (cause) => fail(options.packageDirectory, `UI build failed: ${String(cause)}`),
  });

/** Every file in a folder, with forward-slash paths relative to it. */
export const readPackageFiles = (directory: string) =>
  Effect.tryPromise({
    try: async (): Promise<ReadonlyArray<Checks.File>> => {
      const entries = await readdir(directory, { recursive: true, withFileTypes: true });
      return Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const path = join(entry.parentPath, entry.name);
            return {
              path: relative(directory, path).split(sep).join("/"),
              contents: await readFile(path),
            };
          })
          .sort(),
      );
    },
    catch: (cause) => fail(directory, `Unable to read package files: ${String(cause)}`),
  });

export const findWorkspaceRoot = (from: string) => {
  let directory = resolve(from);
  while (true) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
};

/** Reads and validates the `macrograph` field of a module's `package.json`. */
export const readConfig = (packageDirectory: string) =>
  Effect.gen(function* () {
    const path = join(packageDirectory, "package.json");
    const contents = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) => new PackageConfig.InvalidConfig({ path, reason: String(cause) }),
    });
    const json = yield* Effect.try({
      try: (): unknown => JSON.parse(contents),
      catch: (cause) => new PackageConfig.InvalidConfig({ path, reason: String(cause) }),
    });
    const config = yield* PackageConfig.decodePackageJson(path, json);
    const name =
      typeof json === "object" && json !== null && "name" in json && typeof json.name === "string"
        ? json.name
        : undefined;
    return { config, packageName: name };
  });

/** Builds a module package folder from a module's source package. */
export const build = (options: Options) =>
  Effect.gen(function* () {
    const packageDirectory = resolve(options.packageDirectory);
    const outDirectory = resolve(options.outDirectory);
    const rootDirectory = resolve(
      options.rootDirectory ?? findWorkspaceRoot(packageDirectory) ?? packageDirectory,
    );
    const { config } = yield* readConfig(packageDirectory);

    yield* Effect.tryPromise({
      try: async () => {
        await rm(outDirectory, { recursive: true, force: true });
        await mkdir(outDirectory, { recursive: true });
      },
      catch: (cause) =>
        fail(packageDirectory, `Unable to prepare ${outDirectory}: ${String(cause)}`),
    });

    const server = yield* buildServer({
      packageDirectory,
      entry: config.entries.server,
      outFile: join(outDirectory, ModulePackage.ServerEntry),
      config,
    });
    const graphIssues: Array<Checks.Issue> = [
      ...Checks.sharedLibraryCopies(
        graphModules(server.moduleIds),
        "server",
        ModulePackage.ServerEntry,
      ),
    ];

    const ui = config.entries.ui;
    if (ui !== undefined) {
      const moduleIds = yield* buildUi({
        packageDirectory,
        rootDirectory,
        entry: ui,
        outDirectory: join(outDirectory, ModulePackage.UiDirectory),
        minify: options.minifyUi ?? true,
      });
      graphIssues.push(
        ...Checks.sharedLibraryCopies(
          graphModules(moduleIds),
          "browser",
          ModulePackage.UiDirectory,
        ),
      );
    }

    if (config.icon !== undefined) {
      const icon = config.icon;
      yield* Effect.tryPromise({
        try: async () => {
          const target = join(outDirectory, PackageConfig.iconPath(config) ?? icon);
          await mkdir(dirname(target), { recursive: true });
          await copyFile(resolve(packageDirectory, icon), target);
        },
        catch: (cause) => fail(packageDirectory, `Unable to copy icon: ${String(cause)}`),
      });
    }

    const uiStyles = join(outDirectory, ModulePackage.UiStyles);
    const manifest = yield* PackageConfig.toManifest(config, {
      ui: ui !== undefined,
      styles: ui !== undefined && existsSync(uiStyles) ? [ModulePackage.UiStyles] : [],
    });
    yield* Effect.tryPromise({
      try: () =>
        writeFile(
          join(outDirectory, ModulePackage.ManifestFile),
          `${JSON.stringify(manifest, null, 2)}\n`,
        ),
      catch: (cause) => fail(packageDirectory, `Unable to write manifest: ${String(cause)}`),
    });

    const nodeBuiltins = Checks.analyzeServerEntry(server.code)
      .requires.filter((specifier) => specifier.startsWith("node:"))
      .map((specifier) => specifier.slice("node:".length));
    const declared = new Set(config.node ?? []);
    const unusedNode = [...declared].filter((name) => !nodeBuiltins.includes(name));

    const files = yield* readPackageFiles(outDirectory);
    const checked = Checks.checkPackage(files, {
      ...(options.limits === undefined ? {} : { limits: options.limits }),
      ...(config.build?.external === undefined ? {} : { external: config.build.external }),
    });
    const issues: ReadonlyArray<Checks.Issue> = [
      ...graphIssues,
      ...checked.issues,
      ...unusedNode.map(
        (name): Checks.Issue => ({
          severity: "warning",
          code: "undeclared-node-builtin",
          message: `The manifest declares node built-in ${name} but the server entry never requires it`,
          path: ModulePackage.ManifestFile,
        }),
      ),
    ];
    if ((options.failOnError ?? true) && Checks.hasErrors(issues))
      return yield* fail(
        packageDirectory,
        `Bundle checks failed:\n${Checks.errors(issues).map(Checks.format).join("\n")}`,
        issues,
      );
    return { config, manifest, outDirectory, issues, nodeBuiltins } satisfies Result;
  });

/** The folder a package is installed under: `<namespace>/<publisher>/<name>/<version>`. */
export const installPath = (manifest: Manifest.Model, namespace: string) =>
  join(namespace, manifest.publisher, manifest.name, manifest.version);

export * as Build from "./Build.ts";
