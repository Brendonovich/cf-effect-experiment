import { Duration, Effect, Queue, Stream } from "effect";
import { existsSync, type FSWatcher, watch as watchFs } from "node:fs";
import { dirname, resolve } from "node:path";

export const defaultDebounce = Duration.millis(250);

const nearestExisting = (dir: string): string | undefined => {
  let current = dir;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return current;
};

/**
 * Emits the watched folders that changed, once per burst of file changes, after the burst has
 * been quiet for `debounce`. A folder that doesn't exist yet is waited for by watching its
 * nearest existing parent; once it appears it is reported as changed and watched recursively.
 * Watchers close with the stream's scope.
 */
export const watch = (
  dirs: ReadonlyArray<string>,
  debounce: Duration.Input = defaultDebounce,
): Stream.Stream<ReadonlySet<string>> =>
  Stream.suspend(() => {
    const targets = [...new Set(dirs.map((dir) => resolve(dir)))];
    const pending = new Set<string>();
    return Stream.callback<void>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          /** Keyed by watched path; `recursive` watchers cover a target, others wait for one. */
          const watchers = new Map<string, FSWatcher>();
          const open = (path: string, recursive: boolean, onChange: () => void) => {
            if (watchers.has(path)) return;
            try {
              const watcher = watchFs(path, { recursive }, onChange);
              watcher.on("error", onChange);
              watchers.set(path, watcher);
            } catch {
              // The folder vanished between the check and the watch; the next sync retries.
            }
          };
          const sync = () => {
            const wanted = new Set<string>();
            for (const target of targets) {
              if (existsSync(target)) {
                wanted.add(target);
                open(target, true, () => {
                  pending.add(target);
                  Queue.offerUnsafe(queue, undefined);
                });
                continue;
              }
              const parent = nearestExisting(target);
              if (parent === undefined) continue;
              const key = `${parent}\0waiting`;
              wanted.add(key);
              if (watchers.has(key)) continue;
              try {
                const watcher = watchFs(parent, { recursive: false }, () => {
                  const before = new Set(watchers.keys());
                  sync();
                  for (const appeared of targets)
                    if (!before.has(appeared) && watchers.has(appeared)) {
                      pending.add(appeared);
                      Queue.offerUnsafe(queue, undefined);
                    }
                });
                watcher.on("error", () => undefined);
                watchers.set(key, watcher);
              } catch {
                // Retried on the next sync.
              }
            }
            for (const [key, watcher] of watchers)
              if (!wanted.has(key)) {
                watcher.close();
                watchers.delete(key);
              }
          };
          sync();
          return watchers;
        }),
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
