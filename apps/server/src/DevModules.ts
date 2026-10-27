import { PackageConfig } from "@macrograph/module-build/PackageConfig";
import { ModuleEvaluator } from "@macrograph/module-host/ModuleEvaluator";
import { VmLoader } from "@macrograph/module-host/VmLoader";
import { ModuleId } from "@macrograph/module/ModuleId";
import { ModulePackage } from "@macrograph/module/ModulePackage";
import { Effect, Layer } from "effect";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ModuleOptions } from "./Server.ts";

/** A built-in module package in the workspace, from `virtual:macrograph-dev-modules`. */
export interface Source {
  readonly packageDirectory: string;
  /** The `macrograph` field of its `package.json`. */
  readonly config: unknown;
  /** Imports `entries.server` through Vite's server runner. */
  readonly server: () => Promise<unknown>;
  /** Absolute path of `entries.ui`, if any. */
  readonly ui?: string;
}

const message = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/**
 * Dev mode loads built-ins from source. Each built-in gets a manifest-only folder under
 * `directory`, laid out like `dist/modules`, so it goes through the same registry path as a
 * shipped package; the evaluator then imports its source through Vite's server runner (keeping
 * server HMR) and the catalog points its UI at the Vite-served source.
 */
export const options = (input: {
  readonly sources: ReadonlyArray<Source>;
  readonly directory: string;
  readonly basePath: string;
}): Effect.Effect<ModuleOptions, PackageConfig.InvalidConfig> =>
  Effect.gen(function* () {
    const directory = resolve(input.directory);
    rmSync(directory, { recursive: true, force: true });
    const byId = new Map<ModuleId.Id, Source & { readonly root: string }>();
    for (const source of input.sources) {
      const config = yield* PackageConfig.decodePackageJson(
        join(source.packageDirectory, "package.json"),
        { macrograph: source.config },
      );
      const manifest = yield* PackageConfig.toManifest(config, {
        ui: config.entries.ui !== undefined,
        styles: [],
      });
      const id = ModuleId.make({
        namespace: ModuleId.OfficialNamespace,
        publisher: manifest.publisher,
        name: manifest.name,
      });
      const parts = ModuleId.parts(id);
      const root = join(directory, parts.namespace, parts.publisher, parts.name, manifest.version);
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(root, ModulePackage.ManifestFile),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      byId.set(id, { ...source, root });
    }

    const evaluator = Layer.succeed(ModuleEvaluator.Service)({
      evaluate: (module) => {
        const source = byId.get(module.id);
        if (source === undefined || module.source !== "shipped" || module.root !== source.root)
          return VmLoader.evaluate(module);
        return Effect.tryPromise({
          try: source.server,
          catch: (error) => new VmLoader.EvaluateError({ id: module.id, message: message(error) }),
        }).pipe(Effect.map((exports) => ModulePackage.serverEntryDefault({ exports })));
      },
    });

    return {
      shippedDirs: [directory],
      evaluator,
      extraWatchDirs: [...byId].map(([id, source]) => ({
        dir: join(source.packageDirectory, "src"),
        id,
      })),
      mapEntry: (entry) => {
        const source = byId.get(entry.id);
        if (source?.ui === undefined || entry.ui === undefined || entry.source !== "shipped")
          return entry;
        // Vite serves workspace sources under `/@fs/`, so host and module share one module graph.
        return { ...entry, ui: { entryUrl: `${input.basePath}/@fs${source.ui}`, styleUrls: [] } };
      },
    } satisfies ModuleOptions;
  });

export * as DevModules from "./DevModules.ts";
