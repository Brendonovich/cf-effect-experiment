import { ModuleId } from "@macrograph/module/ModuleId";
import { Effect } from "effect";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

import { Build } from "./Build.ts";

export interface Options {
  readonly packageDirectories: ReadonlyArray<string>;
  /** Root of the tree, e.g. `apps/server/dist/modules`. */
  readonly outDirectory: string;
  /** Defaults to the official registry's namespace. */
  readonly namespace?: string;
  readonly rootDirectory?: string;
  readonly limits?: Build.Options["limits"];
  readonly concurrency?: number;
}

/**
 * Builds modules into `<out>/<namespace>/<publisher>/<name>/<version>/`, the layout of
 * preinstalled and installed packages.
 */
export const buildTree = (options: Options) =>
  Effect.forEach(
    options.packageDirectories,
    (packageDirectory) =>
      Effect.gen(function* () {
        const { config } = yield* Build.readConfig(packageDirectory);
        return yield* Build.build({
          packageDirectory,
          outDirectory: resolve(
            options.outDirectory,
            options.namespace ?? ModuleId.OfficialNamespace,
            config.publisher,
            config.name,
            config.version,
          ),
          ...(options.rootDirectory === undefined ? {} : { rootDirectory: options.rootDirectory }),
          ...(options.limits === undefined ? {} : { limits: options.limits }),
        });
      }),
    { concurrency: options.concurrency ?? 1 },
  );

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const record = (value: unknown, key: string): Readonly<Record<string, unknown>> => {
  const field = typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
  return typeof field === "object" && field !== null ? (field as Record<string, unknown>) : {};
};

/**
 * The installed directories of a package's dependencies that are modules (they have a
 * `macrograph` field in their `package.json`).
 */
export const moduleDependencies = (packageDirectory: string): ReadonlyArray<string> => {
  const manifest = readJson(join(packageDirectory, "package.json"));
  return Object.keys(record(manifest, "dependencies"))
    .sort()
    .flatMap((name) => {
      const directory = join(packageDirectory, "node_modules", name);
      const packageJson = join(directory, "package.json");
      if (!existsSync(packageJson)) return [];
      const dependency = readJson(packageJson);
      return typeof dependency === "object" && dependency !== null && "macrograph" in dependency
        ? [realpathSync(directory)]
        : [];
    });
};

export * as Distribution from "./Distribution.ts";
