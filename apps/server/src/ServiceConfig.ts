import { Effect, Schema } from "effect";

import { makeAtomicFileStore } from "./AtomicFileStore.ts";
import { LocalAccess } from "./LocalAccess.ts";

/** The background service listens on loopback, on its channel's port, unless configured otherwise. */
export const defaultHostname = "127.0.0.1";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }));

export const Config = Schema.Struct({
  hostname: Schema.optionalKey(Schema.NonEmptyString),
  port: Schema.optionalKey(Port),
  token: Schema.optionalKey(Schema.NonEmptyString),
});
export type Config = typeof Config.Type;

export const keys = ["hostname", "port", "token"] as const;
export type Key = (typeof keys)[number];

export class ServiceConfigError extends Schema.TaggedError<ServiceConfigError>()(
  "ServiceConfigError",
  { message: Schema.String },
) {}

const ConfigJson = Schema.fromJsonString(Config);

export const read = (path: string) =>
  makeAtomicFileStore(path).read.pipe(
    Effect.mapError((error) => new ServiceConfigError({ message: `${error.reason}: ${path}` })),
    Effect.flatMap((raw) =>
      raw === null
        ? Effect.succeed<Config>({})
        : Schema.decodeUnknownEffect(ConfigJson)(raw).pipe(
            Effect.mapError(
              () => new ServiceConfigError({ message: `The service config at ${path} is invalid` }),
            ),
          ),
    ),
  );

/** Writes the config atomically, readable only by its owner. */
export const write = (path: string, config: Config) =>
  makeAtomicFileStore(path)
    .write(`${JSON.stringify(config, null, 2)}\n`)
    .pipe(
      Effect.mapError((error) => new ServiceConfigError({ message: `${error.reason}: ${path}` })),
    );

/**
 * Reads the config, creating and saving its local token if it has none. The token is persisted
 * once, so restarts keep the token clients already hold.
 */
export const loadWithToken = (path: string) =>
  Effect.gen(function* () {
    const stored = yield* read(path);
    if (stored.token !== undefined) return { config: stored, token: stored.token };
    const token = LocalAccess.generateToken();
    yield* write(path, { ...stored, token });
    return { config: stored, token };
  });

/** Parses a `macrograph service set` value for a key. */
export const parse = (key: Key, value: string) =>
  Schema.decodeUnknownEffect(Config)(
    key === "port" ? { port: Number(value) } : { [key]: value },
  ).pipe(
    Effect.mapError(
      () =>
        new ServiceConfigError({
          message:
            key === "port"
              ? "port must be an integer between 1 and 65535"
              : `${key} must not be empty`,
        }),
    ),
  );

export const isKey = (value: string): value is Key => keys.some((key) => key === value);

export * as ServiceConfig from "./ServiceConfig.ts";
