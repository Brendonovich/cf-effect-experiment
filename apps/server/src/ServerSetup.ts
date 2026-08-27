import type { Credential } from "@macrograph/plugin";

import { Effect, Schema, Semaphore } from "effect";
import { randomBytes, timingSafeEqual } from "node:crypto";

import type { AtomicFileStore } from "./AtomicFileStore.ts";
import type { ClientSessions } from "./ClientSessions.ts";

const Owner = Schema.Struct({ ownerId: Schema.String });
const LegacyAuthorization = Schema.Union([
  Schema.Struct({ state: Schema.Literal("connected"), userId: Schema.String }),
  Schema.Struct({ state: Schema.Literal("pending") }),
]);

export class SetupError extends Schema.TaggedError<SetupError>()("SetupError", {
  reason: Schema.String,
}) {}

export const make = (options: {
  readonly store: AtomicFileStore;
  readonly legacyAuthStore: AtomicFileStore;
  readonly auth: Credential.AuthController;
  readonly sessions: ClientSessions;
}) => {
  const lock = Semaphore.makeUnsafe(1);
  let loaded = false;
  let ownerId: string | undefined;
  let key: string | undefined;
  let started = false;

  const saveOwner = (id: string) =>
    options.store.write(JSON.stringify({ ownerId: id })).pipe(
      Effect.orDie,
      Effect.tap(() =>
        Effect.sync(() => {
          ownerId = id;
          key = undefined;
        }),
      ),
    );

  const load = Effect.gen(function* () {
    if (loaded) return;
    const raw = yield* options.store.read.pipe(Effect.orDie);
    if (raw !== null) {
      ownerId = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(Owner)(JSON.parse(raw)).ownerId,
        catch: () => new Error("Stored server ownership is invalid"),
      }).pipe(Effect.orDie);
    } else {
      // Preserve existing ownership even when its cloud authorization has expired.
      const legacy = yield* options.legacyAuthStore.read.pipe(Effect.orDie);
      if (legacy !== null) {
        const authorization = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(LegacyAuthorization)(JSON.parse(legacy)),
          catch: () => new Error("Stored server authorization is invalid"),
        }).pipe(Effect.orDie);
        if (authorization.state === "connected") yield* saveOwner(authorization.userId);
      }
    }
    if (ownerId === undefined) key = randomBytes(32).toString("base64url");
    loaded = true;
  });

  const validate = Effect.fnUntraced(function* (provided: string) {
    yield* load;
    if (ownerId !== undefined)
      return yield* new SetupError({ reason: "This server has already been configured" });
    if (
      key === undefined ||
      Buffer.byteLength(provided) !== Buffer.byteLength(key) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(key))
    )
      return yield* new SetupError({ reason: "Invalid setup key" });
  });

  return {
    ownerId: lock.withPermit(load.pipe(Effect.map(() => ownerId))),
    setupKey: lock.withPermit(load.pipe(Effect.map(() => key))),
    start: (provided: string) =>
      lock.withPermit(
        Effect.gen(function* () {
          yield* validate(provided);
          if (!started) {
            // Never adopt a registration started before this process's setup key was issued.
            yield* options.auth.disconnect;
          }
          const status = yield* options.auth.start;
          started = status.state === "pending";
          return status;
        }),
      ),
    poll: (provided: string) =>
      lock.withPermit(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            yield* validate(provided);
            if (!started)
              return yield* new SetupError({ reason: "Start setup before approving it" });
            const status = yield* restore(options.auth.poll);
            if (status.state !== "connected") return status;
            // Serialize claim and session creation so only one setup request can succeed.
            yield* saveOwner(status.identity.id);
            const token = yield* options.sessions.create({
              userId: status.identity.id,
              email: status.identity.displayName,
            });
            return { state: "connected" as const, token };
          }),
        ),
      ),
  };
};

export * as ServerSetup from "./ServerSetup.ts";
