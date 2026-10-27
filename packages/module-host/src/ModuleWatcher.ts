import { Duration, Effect, Queue, Stream } from "effect";
import { existsSync, watch as watchFs } from "node:fs";
import { resolve } from "node:path";

export const defaultDebounce = Duration.millis(250);

/**
 * Emits the watched folders that changed, once per burst of file changes, after the burst has
 * been quiet for `debounce`. Folders that don't exist are skipped. Watchers close with the
 * stream's scope.
 */
export const watch = (
  dirs: ReadonlyArray<string>,
  debounce: Duration.Input = defaultDebounce,
): Stream.Stream<ReadonlySet<string>> =>
  Stream.suspend(() => {
    const pending = new Set<string>();
    return Stream.callback<void>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          [...new Set(dirs.map((dir) => resolve(dir)))].filter(existsSync).flatMap((dir) => {
            const changed = () => {
              pending.add(dir);
              Queue.offerUnsafe(queue, undefined);
            };
            try {
              const watcher = watchFs(dir, { recursive: true }, changed);
              watcher.on("error", changed);
              return [watcher];
            } catch {
              return [];
            }
          }),
        ),
        (watchers) => Effect.sync(() => watchers.forEach((watcher) => watcher.close())),
      ),
    ).pipe(
      Stream.debounce(debounce),
      Stream.map(() => {
        const changed: ReadonlySet<string> = new Set(pending);
        pending.clear();
        return changed;
      }),
    );
  });

export * as ModuleWatcher from "./ModuleWatcher.ts";
