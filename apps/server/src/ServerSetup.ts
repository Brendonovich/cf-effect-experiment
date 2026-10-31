import type { Credential } from "@macrograph/module";

import { Effect, Schema, Semaphore } from "effect";
import { randomBytes, timingSafeEqual } from "node:crypto";

import type { AtomicFileStore } from "./AtomicFileStore.ts";
import type { ClientSessions } from "./ClientSessions.ts";

const Owner = Schema.Struct({ ownerId: Schema.String });

export class SetupError extends Schema.TaggedError<SetupError>()("SetupError", {
  reason: Schema.String,
}) {}

export interface Status {
  readonly ownerId: string | undefined;
  readonly setupRequired: boolean;
}

/**
 * Claims an unowned server. Whoever holds the setup key printed at startup approves a device
 * sign-in that also connects their credentials, and becomes the owner. An owner whose connection
 * later ends signs in normally and reconnects from settings.
 */
export const make = (options: {
  readonly store: AtomicFileStore;
  /** Connects the owner's account; see `CloudCredentials.auth`. */
  readonly auth: Credential.AuthController;
  readonly sessions: ClientSessions;
  readonly onKeyIssued?: (key: string) => Effect.Effect<void>;
}) => {
  const lock = Semaphore.makeUnsafe(1);
  let loaded = false;
  let ownerId: string | undefined;
  let key: string | undefined;
  let started = false;

  const load = Effect.gen(function* () {
    if (loaded) return;
    const raw = yield* options.store.read.pipe(Effect.orDie);
    if (raw !== null)
      ownerId = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(Owner)(JSON.parse(raw)).ownerId,
        catch: () => new Error("Stored server ownership is invalid"),
      }).pipe(Effect.orDie);
    loaded = true;
  });

  // A key exists only while the server is unclaimed.
  const refresh = Effect.gen(function* () {
    yield* load;
    const setupRequired = ownerId === undefined;
    if (!setupRequired) key = undefined;
    else if (key === undefined) {
      key = randomBytes(32).toString("base64url");
      started = false;
      if (options.onKeyIssued !== undefined) yield* options.onKeyIssued(key);
    }
    return { ownerId, setupRequired } satisfies Status;
  });

  const validate = Effect.fnUntraced(function* (provided: string) {
    const { setupRequired } = yield* refresh;
    if (!setupRequired)
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
    status: lock.withPermit(refresh),
    setupKey: lock.withPermit(refresh.pipe(Effect.map(() => key))),
    start: (provided: string) =>
      lock.withPermit(
        Effect.gen(function* () {
          yield* validate(provided);
          // Never adopt an authorization started before this process's setup key was issued.
          if (!started) yield* options.auth.disconnect;
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
            // Holding the lock, only one poll can claim the server and get a session.
            yield* options.store
              .write(JSON.stringify({ ownerId: status.identity.id }))
              .pipe(Effect.orDie);
            ownerId = status.identity.id;
            key = undefined;
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
