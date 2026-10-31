import type { Manifest } from "@macrograph/module/Manifest";

import { ModulePackage } from "@macrograph/module/ModulePackage";
import { SharedLibraries } from "@macrograph/module/SharedLibraries";
import { Effect, Schema } from "effect";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { rolldown, type Plugin as RolldownPlugin } from "rolldown";

import { Checks } from "./Checks.ts";
import { PackageConfig } from "./PackageConfig.ts";
import { UiBuild } from "./UiBuild.ts";

export interface Options {
  /** The module's package directory (the folder with its `package.json`). */
  readonly packageDirectory: string;
  /** Where the package folder is written. Emptied first. */
  readonly outDirectory: string;
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
 * Leaves shared server libraries, Node built-ins and native addons (`macrograph:native/*`) as
 * `require(...)` calls and turns unresolvable optional `require`s into stubs that throw, so the
 * bundle only ever requires what the host resolves.
 */
const serverExternals: RolldownPlugin = {
  name: "macrograph-module-server-externals",
  async resolveId(source, importer, extra) {
    if (
      SharedLibraries.isShared(source, "server") ||
      ModulePackage.parseNativeSpecifier(source) !== undefined
    )
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
};

/**
 * The absolute path of `<package>/<file>` resolved from a module's directory. Looks the package
 * folder up directly so the file doesn't have to be in the package's `exports`.
 */
export const resolvePackageFile = (packageDirectory: string, specifier: string): string => {
  const parts = specifier.split("/");
  const count = specifier.startsWith("@") ? 2 : 1;
  const name = parts.slice(0, count).join("/");
  const file = parts.slice(count);
  if (file.length === 0 || parts.some((part) => part === "" || part === "." || part === ".."))
    throw new Error(`${specifier} is not a <package>/<file> path`);
  const require = createRequire(join(packageDirectory, "package.json"));
  const directory = (require.resolve.paths(name) ?? [])
    .map((nodeModules) => join(nodeModules, name))
    .find((candidate) => existsSync(join(candidate, "package.json")));
  if (directory === undefined)
    throw new Error(`Cannot find package ${name} from ${packageDirectory}`);
  return join(realpathSync(directory), ...file);
};

interface Alias {
  readonly key: string;
  /** Real path of the dependency file being replaced. */
  readonly target: string;
  /** Matched against import specifiers before resolving them. */
  readonly stem: string;
  readonly replacement: string;
}

const resolveAliases = (packageDirectory: string, config: PackageConfig.Model) =>
  Object.entries(config.build?.alias ?? {}).map(([key, replacement]): Alias => {
    const file = resolvePackageFile(packageDirectory, key);
    if (!existsSync(file)) throw new Error(`Alias ${key} points at missing file ${file}`);
    const target = realpathSync(file);
    return {
      key,
      target,
      stem: basename(target, extname(target)),
      replacement: resolve(packageDirectory, replacement),
    };
  });

/** Replaces dependency files with module-local ones, comparing resolved paths. */
const aliasPlugin = (aliases: ReadonlyArray<Alias>, used: Set<string>): RolldownPlugin => ({
  name: "macrograph-module-alias",
  async resolveId(source, importer, extra) {
    const candidates = aliases.filter((alias) => source.includes(alias.stem));
    if (candidates.length === 0) return null;
    const resolved = await this.resolve(source, importer, { skipSelf: true, kind: extra.kind });
    if (resolved === null || resolved.external) return null;
    const id = resolved.id.split("?")[0] ?? resolved.id;
    const alias = candidates.find((candidate) => candidate.target === id);
    if (alias === undefined) return null;
    used.add(alias.key);
    return alias.replacement;
  },
});

/** Copies each native addon's prebuilt binaries to `native/<name>/<target>.node`. */
const copyNativeAddons = (
  packageDirectory: string,
  outDirectory: string,
  config: PackageConfig.Model,
) =>
  Effect.tryPromise({
    try: async () => {
      for (const [name, template] of Object.entries(config.build?.native ?? {})) {
        let copied = 0;
        for (const target of ModulePackage.NativeTargets) {
          const source = resolvePackageFile(
            packageDirectory,
            template.replaceAll(PackageConfig.TargetPlaceholder, target),
          );
          if (!existsSync(source)) continue;
          const destination = join(outDirectory, ModulePackage.nativePath(name, target));
          await mkdir(dirname(destination), { recursive: true });
          await copyFile(source, destination);
          copied++;
        }
        if (copied === 0)
          throw new Error(`No prebuilt binaries match ${template} for any known target`);
      }
    },
    catch: (cause) =>
      fail(
        packageDirectory,
        `Unable to copy native addons: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
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
      const aliases = resolveAliases(options.packageDirectory, options.config);
      const usedAliases = new Set<string>();
      const bundle = await rolldown({
        input: resolve(options.packageDirectory, options.entry),
        cwd: options.packageDirectory,
        platform: "node",
        logLevel: "warn",
        plugins: [aliasPlugin(aliases, usedAliases), serverExternals],
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
        const unused = aliases.filter((alias) => !usedAliases.has(alias.key));
        if (unused.length > 0)
          throw new Error(
            `Aliases never matched a bundled file: ${unused.map((alias) => alias.key).join(", ")}`,
          );
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

const buildUi = (options: UiBuild.Options) =>
  Effect.tryPromise({
    try: () => UiBuild.isolated(options),
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
    yield* copyNativeAddons(packageDirectory, outDirectory, config);
    const graphIssues: Array<Checks.Issue> = [
      ...Checks.sharedLibraryCopies(
        graphModules(server.moduleIds),
        "server",
        ModulePackage.ServerEntry,
      ),
    ];

    const ui = config.entries.ui;
    if (ui !== undefined) {
      const { moduleIds } = yield* buildUi({
        packageDirectory,
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

    const { requires } = Checks.analyzeServerEntry(server.code);
    const nodeBuiltins = requires
      .filter((specifier) => specifier.startsWith("node:"))
      .map((specifier) => specifier.slice("node:".length));
    const declared = new Set(config.node ?? []);
    const unusedNode = [...declared].filter((name) => !nodeBuiltins.includes(name));
    const unusedNative = PackageConfig.nativeAddons(config).filter(
      (name) => !requires.includes(ModulePackage.nativeSpecifier(name)),
    );

    const files = yield* readPackageFiles(outDirectory);
    const checked = Checks.checkPackage(
      files,
      options.limits === undefined ? {} : { limits: options.limits },
    );
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
      ...unusedNative.map(
        (name): Checks.Issue => ({
          severity: "warning",
          code: "undeclared-native-addon",
          message: `The package builds native addon ${name} but the server entry never requires ${ModulePackage.nativeSpecifier(name)}`,
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
