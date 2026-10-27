import type { ModuleId } from "@macrograph/module/ModuleId";

import { Duration, Effect, Layer, Option, Result } from "effect";
import { resolve } from "node:path";

import { ContentHash } from "./ContentHash.ts";
import { ModuleEvaluator } from "./ModuleEvaluator.ts";
import { ModuleFiles } from "./ModuleFiles.ts";
import { ModuleRegistryCore } from "./ModuleRegistryCore.ts";
import { ModuleSources } from "./ModuleSources.ts";
import { ModuleState } from "./ModuleState.ts";
import { ModuleStateFile } from "./ModuleStateFile.ts";
import { ModuleWatcher } from "./ModuleWatcher.ts";

/**
 * The Node module registry: the platform-neutral registry (`ModuleRegistryCore`) on top of module
 * folders, the `vm` loader (through `ModuleEvaluator`), `state.json` and the file watcher.
 */
export {
  type Entries,
  type Entry,
  type Loaded,
  type Platform,
  type StaticFile,
  layerWith,
  make,
  Service,
  toCatalogEntry,
  toDetails,
} from "./ModuleRegistryCore.ts";

export interface WatchOptions {
  readonly debounce?: Duration.Input;
  /**
   * More folders to watch, each tied to a module, e.g. a built-in's source folder in dev. A change
   * marks that module stale without hashing.
   */
  readonly extraDirs?: ReadonlyArray<{ readonly dir: string; readonly id: ModuleId.Id }>;
}

export interface Options extends ModuleRegistryCore.Options {
  /** Enables the `installed` and `local` sources, dev links and `state.json`. */
  readonly dataDir?: string;
  /** Roots laid out as `<namespace>/<publisher>/<name>/<version>/`, e.g. `dist/modules`. */
  readonly shippedDirs?: ReadonlyArray<string>;
  readonly staticModules?: ReadonlyArray<ModuleSources.StaticModule>;
  /** Watch `local/`, linked folders and `extraDirs`, marking changed modules stale. */
  readonly watch?: WatchOptions | false;
}

/** The Node platform: folder sources, `vm` evaluation, `state.json` and the watcher. */
export const platform = (options: Options) =>
  Effect.gen(function* () {
    const evaluator = yield* ModuleEvaluator.Service;
    const paths = Option.map(Option.fromNullishOr(options.dataDir), ModuleSources.paths);
    const state = yield* Option.match(paths, {
      onNone: () => ModuleState.memory(),
      onSome: (value) => ModuleStateFile.file(value.state),
    });
    const watchOptions = options.watch === false ? undefined : options.watch;
    const extraDirs = (watchOptions?.extraDirs ?? []).map((extra) => ({
      dir: resolve(extra.dir),
      id: extra.id,
    }));
    return {
      state,
      scan: (value) =>
        ModuleSources.scan({
          shippedDirs: options.shippedDirs ?? [],
          paths,
          links: ModuleState.links(value),
          staticModules: options.staticModules ?? [],
        }),
      contentHash: ModuleSources.contentHash,
      evaluate: (copy, root) =>
        evaluator.evaluate({ id: copy.id, source: copy.source, root, manifest: copy.manifest }),
      hashFolder: (root) => Effect.option(ContentHash.compute(root)),
      isWithin: ModuleFiles.isWithin,
      resolveFile: ModuleFiles.resolveFile,
      link: (id, path) =>
        Result.map(ModuleSources.validateLink(id, path), (copy) => ({
          copy,
          root: Option.getOrElse(copy.root, () => resolve(path)),
        })),
      ...(watchOptions === undefined
        ? {}
        : {
            watch: {
              changes: (value) =>
                ModuleWatcher.watch(
                  [
                    ...Option.match(paths, { onNone: () => [], onSome: (dirs) => [dirs.local] }),
                    ...ModuleState.links(value).values(),
                    ...extraDirs.map((extra) => extra.dir),
                  ],
                  watchOptions.debounce,
                ),
              staleWithoutHash: (changed) =>
                extraDirs.filter((extra) => changed.has(extra.dir)).map((extra) => extra.id),
            },
          }),
    } satisfies ModuleRegistryCore.Platform;
  });

export const layer = (options: Options) =>
  Layer.effect(ModuleRegistryCore.Service)(
    Effect.flatMap(platform(options), (value) => ModuleRegistryCore.make(options, value)),
  );

export * as ModuleRegistry from "./ModuleRegistry.ts";
