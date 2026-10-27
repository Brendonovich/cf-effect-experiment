import { Effect } from "effect";
import { watch } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { Build } from "./Build.ts";
import { Checks } from "./Checks.ts";
import { Distribution } from "./Distribution.ts";

const usage = `Usage: macrograph-module <command> [options]

Commands:
  build [dir]    Build the module in dir (default: .) into a package folder
  dev [dir]      Build into a target folder, optionally rebuilding on changes
  package [dirs] Build modules into <out>/<namespace>/<publisher>/<name>/<version>/
  publish [dir]  Publish a built package to a registry (not implemented yet)

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

export const main = async (argv: ReadonlyArray<string>) => {
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
    case "publish":
      console.error(
        "publish is not implemented yet; it will upload a built package through @macrograph/module-registry.",
      );
      return 1;
    default:
      console.error(`Unknown command ${command}\n\n${usage}`);
      return 1;
  }
};

export * as Cli from "./Cli.ts";
