import { EditorAccess } from "@macrograph/editor";
import { Effect, Schema, Semaphore } from "effect";
import { randomBytes } from "node:crypto";

import type { AtomicFileStore } from "./AtomicFileStore.ts";

const Session = Schema.Struct({ userId: Schema.String, email: Schema.String });
export type Session = typeof Session.Type;
const StoredSessions = Schema.Record(Schema.String, Session);

export interface ClientSessions {
  readonly create: (session: Session) => Effect.Effect<string>;
  readonly remove: (token: string) => Effect.Effect<void>;
  readonly resolve: (token: string | undefined) => Effect.Effect<Session | undefined>;
  readonly policy: (
    ownerId: Effect.Effect<string | undefined>,
    adminIds: ReadonlySet<string>,
  ) => EditorAccess.Policy["Service"];
}

export const make = (store: AtomicFileStore): ClientSessions => {
  const lock = Semaphore.makeUnsafe(1);
  let sessions: Readonly<Record<string, Session>> | undefined;

  const load = Effect.gen(function* () {
    if (sessions !== undefined) return sessions;
    const raw = yield* store.read.pipe(Effect.orDie);
    sessions =
      raw === null
        ? {}
        : yield* Effect.try({
            try: () => Schema.decodeUnknownSync(StoredSessions)(JSON.parse(raw)),
            catch: () => new Error("Stored client sessions are invalid"),
          }).pipe(Effect.orDie);
    return sessions;
  });

  const save = (next: Readonly<Record<string, Session>>) =>
    store.write(JSON.stringify(next)).pipe(
      Effect.orDie,
      Effect.tap(() => Effect.sync(() => (sessions = next))),
    );

  const resolve = (token: string | undefined) =>
    lock.withPermit(
      load.pipe(
        Effect.map((current) =>
          token !== undefined && Object.hasOwn(current, token) ? current[token] : undefined,
        ),
      ),
    );

  return {
    create: (session) =>
      lock.withPermit(
        Effect.gen(function* () {
          const current = yield* load;
          const token = randomBytes(32).toString("base64url");
          yield* save({ ...current, [token]: session });
          return token;
        }),
      ),
    remove: (token) =>
      lock.withPermit(
        Effect.gen(function* () {
          const current = yield* load;
          if (!Object.hasOwn(current, token)) return;
          const next = { ...current };
          delete next[token];
          yield* save(next);
        }),
      ),
    resolve,
    policy: (ownerId, adminIds) =>
      EditorAccess.Policy.of({
        resolve: (headers, clientId) =>
          Effect.gen(function* () {
            const authorization = headers.authorization;
            const bearer = authorization?.startsWith("Bearer ")
              ? authorization.slice("Bearer ".length)
              : undefined;
            const session = yield* resolve(headers["x-macrograph-session"] ?? bearer);
            const owner = yield* ownerId;
            const connectionId = `self-hosted-${clientId}`;
            const canEdit =
              session !== undefined && (session.userId === owner || adminIds.has(session.userId));
            return {
              actor: { type: "CLIENT", id: connectionId },
              connectionId,
              displayName: session?.email.split("@")[0] ?? "",
              projectId: "local",
              canEdit,
              canManageCredentials:
                session !== undefined && owner !== undefined && session.userId === owner,
            };
          }),
      }),
  };
};

export * as ClientSessions from "./ClientSessions.ts";
