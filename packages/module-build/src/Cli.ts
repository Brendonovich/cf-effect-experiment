import { Publish } from "@macrograph/module-registry/Publish";
import { Manifest } from "@macrograph/module/Manifest";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { watch } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { Build } from "./Build.ts";
import { Checks } from "./Checks.ts";
import { Distribution } from "./Distribution.ts";
import { Pack } from "./Pack.ts";

export const DefaultRegistry = "https://registry.macrograph.app";
export const TokenEnvironmentVariable = "MACROGRAPH_TOKEN";

const usage = `Usage: macrograph-module <command> [options]

Commands:
  build [dir]    Build the module in dir (default: .) into a package folder
  dev [dir]      Build into a target folder, optionally rebuilding on changes
  package [dirs] Build modules into <out>/<namespace>/<publisher>/<name>/<version>/
  pack [dir]     Build and check the module, then write its package tarball
  publish [dir]  Build, check and pack the module, then upload it to a registry

Options:
  -o, --out <dir>       Output folder (build: <dir>/dist/macrograph,
                        dev: <target>/<publisher>/<name>)
  -t, --target <dir>    dev: the folder modules are linked from, e.g. a local modules folder
  -w, --watch           dev: rebuild when files in the module change
      --namespace <ns>  package: namespace folder (default: the official registry's)
      --dependencies-of <dir>
                        package: also build every module the package in <dir> depends on
      --root <dir>      Root StyleX hashes token paths against (default: workspace root)
      --no-minify       Don't minify the UI bundle
      --max-server <n>  Server entry size limit in bytes
      --max-ui <n>      UI size limit in bytes
      --from <dir>      pack/publish: use an already built package folder instead of building
      --tarball <file>  pack/publish: where to write the tarball
                        (pack default: <dir>/dist/<publisher>-<name>-<version>.tgz)
      --registry <url>  publish: registry URL (default: ${DefaultRegistry})
      --token <token>   publish: API token (default: $${TokenEnvironmentVariable})
      --dry-run         publish: pack and check only, don't upload
  -h, --help            Show this help
`;

const options = {
  out: { type: "string", short: "o" },
  target: { type: "string", short: "t" },
  watch: { type: "boolean", short: "w" },
  namespace: { type: "string" },
  "dependencies-of": { type: "string" },
  root: { type: "string" },
  "no-minify": { type: "boolean" },
  "max-server": { type: "string" },
  "max-ui": { type: "string" },
  from: { type: "string" },
  tarball: { type: "string" },
  registry: { type: "string" },
  token: { type: "string" },
  "dry-run": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

const printIssues = (issues: ReadonlyArray<Checks.Issue>) => {
  for (const issue of issues) console.warn(Checks.format(issue));
};

const limitsFrom = (values: { readonly "max-server"?: string; readonly "max-ui"?: string }) => ({
  ...(values["max-server"] === undefined ? {} : { serverBytes: Number(values["max-server"]) }),
  ...(values["max-ui"] === undefined ? {} : { uiBytes: Number(values["max-ui"]) }),
});

const runBuild = (buildOptions: Build.Options) =>
  Build.build(buildOptions).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        printIssues(result.issues);
        console.log(
          `Built ${result.manifest.publisher}/${result.manifest.name}@${result.manifest.version} → ${result.outDirectory}`,
        );
      }),
    ),
  );

const reportFailure = (error: unknown) => {
  if (typeof error === "object" && error !== null && "reason" in error)
    console.error(String(error.reason));
  else console.error(error);
};

export class PublishCheckError extends Schema.TaggedError<PublishCheckError>()(
  "ModulePublishCheckError",
  { reason: Schema.String },
) {}

export interface PackResult {
  readonly manifest: Manifest.Model;
  readonly tarball: Uint8Array<ArrayBuffer>;
  readonly issues: ReadonlyArray<Checks.Issue>;
}

/**
 * Reads a built package folder, runs the publish checks (no `build.external` allowance: published
 * modules may only require shared libraries and declared node built-ins) and packs it.
 */
export const packFolder = (directory: string, limits: Partial<Checks.Limits> = {}) =>
  Effect.gen(function* () {
    const files = yield* Build.readPackageFiles(directory);
    const { manifest, issues } = Checks.checkPackage(files, {
      limits,
      supportedApis: [Manifest.ApiVersion],
    });
    if (manifest === undefined || Checks.hasErrors(issues))
      return yield* new PublishCheckError({
        reason: `${directory} failed the publish checks:\n${Checks.errors(issues).map(Checks.format).join("\n")}`,
      });
    const tarball = yield* Pack.tarball(files);
    return { manifest, tarball, issues } satisfies PackResult;
  });

const tarballName = (manifest: Manifest.Model) =>
  `${manifest.publisher}-${manifest.name}-${manifest.version}.tgz`;

const writeTarball = (path: string, bytes: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    catch: (cause) =>
      new PublishCheckError({ reason: `Unable to write ${path}: ${String(cause)}` }),
  });

/** What the CLI reads from its surroundings; tests swap these. */
export interface Runtime {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof globalThis.fetch;
}

const defaultRuntime = (): Runtime => ({ env: process.env, fetch: globalThis.fetch });

const reportPublishFailure = (error: unknown) => {
  if (error instanceof Publish.PublishError) {
    console.error(`Publish failed (${error.status} ${error.reason}): ${error.message}`);
    for (const problem of error.problems) console.error(`  - ${problem}`);
  } else reportFailure(error);
};

export const main = async (argv: ReadonlyArray<string>, runtime: Runtime = defaultRuntime()) => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options,
    allowPositionals: true,
  });
  const [command, directory = "."] = positionals;
  if (values.help === true || command === undefined) {
    console.log(usage);
    return command === undefined && values.help !== true ? 1 : 0;
  }
  const packageDirectory = resolve(directory);
  const common = {
    packageDirectory,
    ...(values.root === undefined ? {} : { rootDirectory: resolve(values.root) }),
    ...(values["no-minify"] === true ? { minifyUi: false } : {}),
    limits: limitsFrom(values),
  };

  switch (command) {
    case "build": {
      const outDirectory = resolve(values.out ?? join(packageDirectory, "dist", "macrograph"));
      return Effect.runPromise(runBuild({ ...common, outDirectory })).then(
        () => 0,
        (error: unknown) => {
          reportFailure(error);
          return 1;
        },
      );
    }
    case "dev": {
      if (values.out === undefined && values.target === undefined) {
        console.error("dev needs --target <dir> or --out <dir>");
        return 1;
      }
      const outDirectory = async () => {
        if (values.out !== undefined) return resolve(values.out);
        const { config } = await Effect.runPromise(Build.readConfig(packageDirectory));
        return resolve(values.target ?? ".", config.publisher, config.name);
      };
      const once = async () => {
        try {
          await Effect.runPromise(runBuild({ ...common, outDirectory: await outDirectory() }));
          return true;
        } catch (error) {
          reportFailure(error);
          return false;
        }
      };
      const ok = await once();
      if (values.watch !== true) return ok ? 0 : 1;
      console.log(`Watching ${packageDirectory} for changes…`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let running = Promise.resolve(true);
      watch(packageDirectory, { recursive: true }, (_event, file) => {
        const path = file?.toString() ?? "";
        if (path.startsWith("dist") || path.includes("node_modules")) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          running = running.then(once);
        }, 150);
      });
      return new Promise<number>(() => {});
    }
    case "package": {
      if (values.out === undefined) {
        console.error("package needs --out <dir>");
        return 1;
      }
      const packageDirectories = [
        ...positionals.slice(1).map((path) => resolve(path)),
        ...(values["dependencies-of"] === undefined
          ? []
          : Distribution.moduleDependencies(resolve(values["dependencies-of"]))),
      ];
      return Effect.runPromise(
        Distribution.buildTree({
          packageDirectories,
          outDirectory: resolve(values.out),
          ...(values.namespace === undefined ? {} : { namespace: values.namespace }),
          ...(values.root === undefined ? {} : { rootDirectory: resolve(values.root) }),
          limits: common.limits,
        }),
      ).then(
        (results) => {
          for (const result of results) {
            printIssues(result.issues);
            console.log(
              `Built ${result.manifest.publisher}/${result.manifest.name}@${result.manifest.version}`,
            );
          }
          console.log(`Packaged ${results.length} modules into ${resolve(values.out!)}`);
          return 0;
        },
        (error: unknown) => {
          reportFailure(error);
          return 1;
        },
      );
    }
    case "pack":
    case "publish": {
      const upload = command === "publish" && values["dry-run"] !== true;
      const token = values.token ?? runtime.env[TokenEnvironmentVariable];
      if (upload && (token === undefined || token === "")) {
        console.error(`publish needs --token <token> or ${TokenEnvironmentVariable}`);
        return 1;
      }
      const registry = values.registry ?? DefaultRegistry;
      const program = Effect.gen(function* () {
        const folder =
          values.from === undefined
            ? (yield* runBuild({
                ...common,
                outDirectory: resolve(values.out ?? join(packageDirectory, "dist", "macrograph")),
              })).outDirectory
            : resolve(values.from);
        const packed = yield* packFolder(folder, common.limits);
        printIssues(packed.issues);
        const { manifest } = packed;
        const label = `${manifest.publisher}/${manifest.name}@${manifest.version}`;
        const tarballPath =
          values.tarball !== undefined
            ? resolve(values.tarball)
            : upload
              ? undefined
              : join(packageDirectory, "dist", tarballName(manifest));
        if (tarballPath !== undefined) {
          yield* writeTarball(tarballPath, packed.tarball);
          console.log(`Packed ${label} → ${tarballPath} (${packed.tarball.byteLength} bytes)`);
        }
        if (!upload || token === undefined) return;
        const release = yield* Publish.publish({ registry, token, tarball: packed.tarball }).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, runtime.fetch),
        );
        console.log(`Published ${label} to ${registry}`);
        console.log(`  version:   ${release.version}`);
        console.log(`  integrity: ${release.integrity}`);
        console.log(`  trust:     ${release.trust}`);
        console.log(`  tarball:   ${release.tarball}`);
      });
      return Effect.runPromise(program).then(
        () => 0,
        (error: unknown) => {
          reportPublishFailure(error);
          return 1;
        },
      );
    }
    default:
      console.error(`Unknown command ${command}\n\n${usage}`);
      return 1;
  }
};

export * as Cli from "./Cli.ts";
