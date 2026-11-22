import { Duration, Effect, Schedule, Schema, type Scope } from "effect";

import { makeAtomicFileStore } from "./AtomicFileStore.ts";

/** What a running background service publishes for its local clients. */
export const Info = Schema.Struct({
  id: Schema.String,
  version: Schema.String,
  /** The service's origin and base path, without a trailing slash. */
  url: Schema.String,
  pid: Schema.Int,
  /** The local token, which authenticates clients as the server's owner. */
  token: Schema.String,
  /** The command that started the service, so it can be restarted; absent for `pnpm dev:inline`. */
  command: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type Info = typeof Info.Type;

const InfoJson = Schema.fromJsonString(Info);

/** Whether two registrations describe the same service instance. */
export const same = (left: Info, right: Info) =>
  left.id === right.id &&
  left.version === right.version &&
  left.url === right.url &&
  left.pid === right.pid &&
  left.token === right.token;

/** Reads the registration, treating a missing, unreadable or invalid file as no registration. */
export const read = (path: string): Effect.Effect<Info | undefined> =>
  makeAtomicFileStore(path).read.pipe(
    Effect.flatMap((raw) =>
      raw === null ? Effect.succeed(undefined) : Schema.decodeUnknownEffect(InfoJson)(raw),
    ),
    Effect.catch(() => Effect.succeed(undefined)),
  );

/** Removes the registration only if it still describes `info`, so a successor's survives. */
export const removeIfOwned = (path: string, info: Info) =>
  read(path).pipe(
    Effect.flatMap((current) =>
      current !== undefined && same(current, info) ? makeAtomicFileStore(path).clear : Effect.void,
    ),
    Effect.ignore,
  );

/** Publishes `info` atomically, readable only by its owner, replacing any registration. */
export const write = (path: string, info: Info) =>
  makeAtomicFileStore(path).write(JSON.stringify(info)).pipe(Effect.orDie);

/**
 * Publishes `info` at `path` (atomically, readable only by its owner) for as long as the scope is
 * open, then removes it if it is still ours. Runs `shutdown` if the registration disappears or
 * another service replaces it, since clients can no longer find this one.
 */
export const register = Effect.fnUntraced(function* (options: {
  readonly path: string;
  readonly info: Info;
  readonly shutdown: Effect.Effect<void>;
  readonly checkInterval?: Duration.Input;
}): Effect.fn.Return<void, never, Scope.Scope> {
  yield* write(options.path, options.info);
  yield* Effect.addFinalizer(() => removeIfOwned(options.path, options.info));
  yield* read(options.path).pipe(
    Effect.repeat({
      while: (current) => current !== undefined && same(current, options.info),
      schedule: Schedule.spaced(options.checkInterval ?? Duration.seconds(5)),
    }),
    Effect.andThen(
      Effect.logWarning("The service registration was removed or replaced; shutting down"),
    ),
    Effect.andThen(options.shutdown),
    Effect.forkScoped,
  );
});

export * as ServiceRegistration from "./ServiceRegistration.ts";
