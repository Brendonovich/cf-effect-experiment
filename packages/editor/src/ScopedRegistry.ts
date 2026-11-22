import { Effect, Ref, type Scope } from "effect";

/**
 * A keyed registry whose entries live until the scope that added them closes. Removing an entry
 * removes exactly that registration; if it shadowed an earlier one for the same key, the earlier
 * one becomes current again.
 */
export interface ScopedRegistry<K, V> {
  readonly add: (key: K, value: V) => Effect.Effect<void, never, Scope.Scope>;
  readonly get: (key: K) => Effect.Effect<V | undefined>;
  readonly entries: Effect.Effect<ReadonlyMap<K, V>>;
  readonly isCurrent: (key: K, value: V) => Effect.Effect<boolean>;
}

interface Entry<V> {
  readonly value: V;
}

export const make = <K, V>(): Effect.Effect<ScopedRegistry<K, V>> =>
  Effect.map(Ref.make<ReadonlyMap<K, ReadonlyArray<Entry<V>>>>(new Map()), (ref) => {
    const current = (map: ReadonlyMap<K, ReadonlyArray<Entry<V>>>, key: K) =>
      map.get(key)?.at(-1)?.value;
    return {
      add: (key, value) => {
        const entry: Entry<V> = { value };
        return Effect.acquireRelease(
          Ref.update(ref, (map) => new Map(map).set(key, [...(map.get(key) ?? []), entry])),
          () =>
            Ref.update(ref, (map) => {
              const remaining = (map.get(key) ?? []).filter((candidate) => candidate !== entry);
              const next = new Map(map);
              if (remaining.length === 0) next.delete(key);
              else next.set(key, remaining);
              return next;
            }),
        );
      },
      get: (key) => Effect.map(Ref.get(ref), (map) => current(map, key)),
      entries: Effect.map(
        Ref.get(ref),
        (map) =>
          new Map(Array.from(map, ([key, entries]) => [key, entries.at(-1)!.value] as const)),
      ),
      isCurrent: (key, value) => Effect.map(Ref.get(ref), (map) => current(map, key) === value),
    };
  });

export * as ScopedRegistry from "./ScopedRegistry.ts";
