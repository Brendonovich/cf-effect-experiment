import { ApiKey } from "@macrograph/project-api";
import { Effect, Schema, Semaphore } from "effect";
import { randomUUID } from "node:crypto";

import type { AtomicFileStore } from "./AtomicFileStore.ts";

const StoredKey = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  keyHash: Schema.String,
  userId: Schema.String,
  email: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String),
});
type StoredKey = typeof StoredKey.Type;
const StoredKeys = Schema.Array(StoredKey);

/** An API key without its hash; keys act as the user who created them. */
export interface Summary {
  readonly id: string;
  readonly name: string;
  readonly userId: string;
  readonly email: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface Created extends Summary {
  /** The secret, which is only available when the key is created. */
  readonly key: string;
}

export interface ApiKeys {
  readonly create: (
    owner: { readonly userId: string; readonly email: string },
    name: string,
  ) => Effect.Effect<Created>;
  readonly list: Effect.Effect<ReadonlyArray<Summary>>;
  /** Returns whether a key was revoked. */
  readonly revoke: (id: string) => Effect.Effect<boolean>;
  readonly authenticate: (key: string) => Effect.Effect<Summary | undefined>;
}

/** How stale a key's last-used time may get before a request rewrites the key file. */
const lastUsedResolution = 60_000;

const summary = ({ keyHash: _, ...key }: StoredKey): Summary => key;

export const make = (store: AtomicFileStore, now: () => Date = () => new Date()): ApiKeys => {
  const lock = Semaphore.makeUnsafe(1);
  let keys: ReadonlyArray<StoredKey> | undefined;

  const load = Effect.gen(function* () {
    if (keys !== undefined) return keys;
    const raw = yield* store.read.pipe(Effect.orDie);
    keys =
      raw === null
        ? []
        : yield* Effect.try({
            try: () => Schema.decodeUnknownSync(StoredKeys)(JSON.parse(raw)),
            catch: () => new Error("Stored API keys are invalid"),
          }).pipe(Effect.orDie);
    return keys;
  });

  const save = (next: ReadonlyArray<StoredKey>) =>
    store.write(JSON.stringify(next)).pipe(
      Effect.orDie,
      Effect.tap(() => Effect.sync(() => (keys = next))),
    );

  return {
    create: (owner, name) =>
      lock.withPermit(
        Effect.gen(function* () {
          const current = yield* load;
          const { key, keyHash } = yield* ApiKey.generate;
          const stored: StoredKey = {
            id: randomUUID(),
            name,
            keyHash,
            userId: owner.userId,
            email: owner.email,
            createdAt: now().toISOString(),
            lastUsedAt: null,
          };
          yield* save([...current, stored]);
          return { ...summary(stored), key };
        }),
      ),
    list: lock.withPermit(load.pipe(Effect.map((current) => current.map(summary)))),
    revoke: (id) =>
      lock.withPermit(
        Effect.gen(function* () {
          const current = yield* load;
          const next = current.filter((key) => key.id !== id);
          if (next.length === current.length) return false;
          yield* save(next);
          return true;
        }),
      ),
    authenticate: (key) =>
      Effect.gen(function* () {
        const keyHash = yield* ApiKey.hash(key);
        return yield* lock.withPermit(
          Effect.gen(function* () {
            const current = yield* load;
            const found = current.find((stored) => stored.keyHash === keyHash);
            if (found === undefined) return undefined;
            const time = now();
            const lastUsed = found.lastUsedAt === null ? 0 : Date.parse(found.lastUsedAt);
            if (time.getTime() - lastUsed < lastUsedResolution) return summary(found);
            const used = { ...found, lastUsedAt: time.toISOString() };
            yield* save(current.map((stored) => (stored.id === found.id ? used : stored)));
            return summary(used);
          }),
        );
      }),
  };
};

export * as ApiKeys from "./ApiKeys.ts";
