import { Cause, Effect } from "effect";
import { createMemo, createSignal } from "solid-js";

import type {
  ModuleCatalogEntry,
  ModuleCatalogPackage,
  ModuleCatalogSource,
} from "./ModuleCatalogSource";

export type ModuleCatalogListener = (
  next: ReadonlyMap<string, ModuleCatalogEntry>,
  previous: ReadonlyMap<string, ModuleCatalogEntry>,
) => void;

/** The module catalog of the current connection, keyed by module id. */
export function createModuleCatalog() {
  const [entries, setEntries] = createSignal<ReadonlyArray<ModuleCatalogEntry>>([]);
  const byId = createMemo(() => new Map(entries().map((entry) => [entry.id, entry] as const)));
  const listeners = new Set<ModuleCatalogListener>();
  let current: ReadonlyMap<string, ModuleCatalogEntry> = new Map();
  let generation = 0;

  const commit = (next: ReadonlyArray<ModuleCatalogEntry>) => {
    const previous = current;
    current = new Map(next.map((entry) => [entry.id, entry] as const));
    setEntries(next);
    for (const listener of listeners) listener(current, previous);
  };

  return {
    /** Reactive list of entries in catalog order. */
    entries,
    /** Reactive lookup by module id. */
    get: (id: string) => byId().get(id),
    /** The latest committed catalog, read without tracking. */
    current: () => current,
    /** Called synchronously after every committed change. */
    onChange(listener: ModuleCatalogListener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /**
     * Fetches the catalog and commits it unless a newer load or clear superseded it. A failed fetch
     * keeps the previous catalog.
     */
    load(source: ModuleCatalogSource, packages: ReadonlyArray<ModuleCatalogPackage>) {
      const request = ++generation;
      return source.fetch(packages).pipe(
        Effect.flatMap((next) =>
          Effect.sync(() => {
            if (request === generation) commit(next);
          }),
        ),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logError("Failed to load the module catalog", cause),
        ),
      );
    },
    /** Drops in-flight loads; keeps the committed catalog when `retain` is set. */
    clear(retain = false) {
      generation++;
      if (!retain) commit([]);
    },
  };
}

export type ModuleCatalogStore = ReturnType<typeof createModuleCatalog>;
