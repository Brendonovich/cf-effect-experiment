import * as Credential from "@macrograph/plugin/Credential";
import * as Engine from "@macrograph/plugin/Engine";
import { Effect, Redacted, Schema, Scope, Semaphore } from "effect";

export const DEFAULT_BASE_URL = "https://www.macrograph.app/api";
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export class SessionStoreError extends Schema.TaggedError<SessionStoreError>()(
  "CloudCredentialSessionStoreError",
  { reason: Schema.String },
) {}

export interface SessionStore {
  readonly read: Effect.Effect<string | null, SessionStoreError>;
  readonly write: (value: string) => Effect.Effect<void, SessionStoreError>;
  readonly clear: Effect.Effect<void, SessionStoreError>;
}

export class CloudCredentialError extends Schema.TaggedError<CloudCredentialError>()(
  "CloudCredentialError",
  {
    code: Schema.Literals([
      "request-failed",
      "invalid-response",
      "not-connected",
      "authorization-expired",
      "authorization-denied",
    ]),
    reason: Schema.String,
  },
) {}

const Pending = Schema.Struct({
  state: Schema.Literal("pending"),
  id: Schema.String,
  verificationUrl: Schema.String,
});
const Session = Schema.Struct({
  state: Schema.Literal("connected"),
  token: Schema.String,
  userId: Schema.String,
  email: Schema.String,
  expiresAt: Schema.Number,
});
const StoredState = Schema.Union([Pending, Session]);
type StoredState = typeof StoredState.Type;

const RegistrationStart = Schema.Struct({
  id: Schema.String,
  userCode: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.String,
});
const RegistrationGrant = Schema.Struct({ token: Schema.String });
const RegistrationError = Schema.TaggedStruct("ServerRegistrationError", {
  code: Schema.Literals(["authorization_pending", "incorrect_id", "access_denied"]),
});
const RegistrationResult = Schema.Union([RegistrationGrant, RegistrationError]);
const Registration = Schema.Struct({ ownerId: Schema.String });
const CloudUser = Schema.NullOr(Schema.Struct({ id: Schema.String, email: Schema.String }));
const DeviceAuthorization = Schema.Struct({
  device_code: Schema.String,
  verification_uri_complete: Schema.String,
});
const DeviceGrant = Schema.Struct({
  userId: Schema.String,
  access_token: Schema.String,
  refresh_token: Schema.String,
  token_type: Schema.Literal("Bearer"),
});
const DeviceFlowError = Schema.TaggedStruct("DeviceFlowError", {
  code: Schema.Literals([
    "authorization_pending",
    "expired_token",
    "incorrect_device_code",
    "access_denied",
  ]),
});
const DeviceGrantResult = Schema.Union([DeviceGrant, DeviceFlowError]);

export const CloudCredential = Schema.Struct({
  provider: Schema.String,
  id: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  scopes: Schema.optional(Schema.Array(Schema.String)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  token: Schema.Struct({
    access_token: Schema.String,
    expires_in: Schema.Number,
    refresh_token: Schema.optional(Schema.String),
    token_type: Schema.String,
    issuedAt: Schema.Number,
  }),
});
const CloudCredentialList = Schema.Array(CloudCredential);

export interface Options {
  readonly store: SessionStore;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly clientId?: string;
}

export type CredentialClient = Engine.CredentialService & {
  readonly catalog: Effect.Effect<Credential.Catalog>;
  readonly refetch: Effect.Effect<Credential.Catalog>;
  readonly auth: Credential.AuthController;
};

export interface Service {
  readonly credentials: CredentialClient;
  readonly auth: Credential.AuthController;
  readonly clientAuth: {
    readonly start: Effect.Effect<typeof DeviceAuthorization.Type, CloudCredentialError>;
    readonly poll: (
      deviceCode: string,
    ) => Effect.Effect<
      | { readonly state: "pending" }
      | { readonly state: "connected"; readonly userId: string; readonly email: string },
      CloudCredentialError
    >;
  };
}

export const normalizeBaseUrl = (value = DEFAULT_BASE_URL) =>
  value
    .replace(/^https:\/\/macrograph\.app(?=\/|$)/, "https://www.macrograph.app")
    .replace(/\/$/, "");

const sensitiveKey = (key: string) => {
  const normalized = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase();
  return [
    "authorization",
    "authentication",
    "cookie",
    "credential",
    "password",
    "passphrase",
    "privatekey",
    "secret",
    "token",
    "apikey",
  ].some((part) => normalized.includes(part));
};

const sanitize = (value: Schema.Json, secrets: ReadonlyArray<string>): Schema.Json => {
  if (typeof value === "string")
    return secrets.reduce(
      (current, secret) => (secret === "" ? current : current.replaceAll(secret, "[redacted]")),
      value,
    );
  if (Array.isArray(value)) return value.map((item) => sanitize(item, secrets));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKey(key) ? "[redacted]" : sanitize(item, secrets),
      ]),
    );
  return value;
};

const toEngineCredential = (credential: typeof CloudCredential.Type): Engine.Credential => ({
  id: credential.id,
  provider: credential.provider,
  displayName: credential.displayName,
  ...(typeof credential.metadata?.clientId === "string"
    ? { clientId: credential.metadata.clientId }
    : {}),
  token: { access: Redacted.make(credential.token.access_token) },
});

const toSummary = (credential: typeof CloudCredential.Type): Credential.Summary => ({
  provider: credential.provider,
  id: credential.id,
  displayName: credential.displayName,
  status: "available",
  scopes: credential.scopes ?? [],
  metadata: sanitize(credential.metadata ?? {}, [
    credential.token.access_token,
    credential.token.refresh_token ?? "",
  ]) as Readonly<Record<string, Schema.Json>>,
});

export const make = (options: Options): Service => {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const lock = Semaphore.makeUnsafe(1);
  const subscribers = new Set<() => Effect.Effect<void>>();
  let loaded = false;
  let stored: StoredState | undefined;
  let cachedCredentials: ReadonlyArray<typeof CloudCredential.Type> | undefined;
  let authorizationChanged = false;

  const storageError = (error: SessionStoreError): Credential.AuthError =>
    new Credential.AuthError({ reason: error.reason });
  const notify = Effect.forEach(subscribers, (subscriber) => subscriber(), { discard: true });
  const notifyIfAuthorizationChanged = Effect.suspend(() => {
    if (!authorizationChanged) return Effect.void;
    authorizationChanged = false;
    return notify;
  });
  const decodeStored = (raw: string) =>
    Effect.try({
      try: () => Schema.decodeUnknownSync(StoredState)(JSON.parse(raw)),
      catch: () => new SessionStoreError({ reason: "Stored MacroGraph authorization is invalid" }),
    });
  const load = Effect.gen(function* () {
    if (loaded) return;
    const raw = yield* options.store.read;
    if (raw !== null)
      stored = yield* decodeStored(raw).pipe(
        Effect.catch(() => options.store.clear.pipe(Effect.as(undefined))),
      );
    loaded = true;
  });
  const clear = Effect.gen(function* () {
    yield* options.store.clear;
    stored = undefined;
    cachedCredentials = undefined;
  });
  const activeSession = Effect.gen(function* () {
    yield* load;
    if (stored?.state !== "connected") return undefined;
    if (stored.expiresAt > now()) return stored;
    yield* clear;
    authorizationChanged = true;
    return undefined;
  });
  const request = <A, I>(
    path: string,
    schema: Schema.Codec<A, I>,
    init?: RequestInit,
    token?: string,
    acceptedErrorStatus?: number,
  ) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetchImplementation(`${baseUrl}${path}`, {
          ...init,
          headers: {
            ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
            ...(token === undefined
              ? {}
              : {
                  authorization: `Bearer ${token}`,
                  "client-id": options.clientId ?? "macrograph-server",
                }),
            ...init?.headers,
          },
        });
        if (response.status === 401)
          throw new CloudCredentialError({
            code: "authorization-expired",
            reason: "MacroGraph authorization expired; reconnect the account",
          });
        if (!response.ok && response.status !== acceptedErrorStatus)
          throw new CloudCredentialError({
            code: "request-failed",
            reason: "MacroGraph could not complete the credential request",
          });
        try {
          return Schema.decodeUnknownSync(schema)(await response.json());
        } catch {
          throw new CloudCredentialError({
            code: "invalid-response",
            reason: "MacroGraph returned an invalid credential response",
          });
        }
      },
      catch: (error) =>
        error instanceof CloudCredentialError
          ? error
          : new CloudCredentialError({
              code: "request-failed",
              reason: "MacroGraph could not complete the credential request",
            }),
    });
  const fetchCredentials = Effect.gen(function* () {
    const session = yield* activeSession;
    if (session === undefined)
      return yield* new CloudCredentialError({
        code: "not-connected",
        reason: "MacroGraph is not connected",
      });
    const credentials = yield* request(
      "/credentials",
      CloudCredentialList,
      undefined,
      session.token,
    );
    cachedCredentials = credentials;
    return credentials;
  }).pipe(
    Effect.tapError((error) =>
      error instanceof CloudCredentialError && error.code === "authorization-expired"
        ? clear.pipe(
            Effect.tap(() => Effect.sync(() => (authorizationChanged = true))),
            Effect.ignore,
          )
        : Effect.void,
    ),
  );
  const catalogFrom = (
    credentials: ReadonlyArray<typeof CloudCredential.Type>,
  ): Credential.Catalog => ({
    _tag: "CredentialCatalogAvailable",
    credentials: credentials.map(toSummary),
  });
  const unavailable = (message: string): Credential.Catalog =>
    Credential.unavailable("request-failed", message);

  const statusUnlocked = Effect.gen(function* (): Effect.fn.Return<
    Credential.AuthStatus,
    SessionStoreError
  > {
    yield* load;
    const session = yield* activeSession;
    if (session !== undefined)
      return {
        state: "connected",
        identity: { id: session.userId, displayName: session.email },
      };
    return stored?.state === "pending"
      ? { state: "pending", verificationUrl: stored.verificationUrl }
      : { state: "disconnected" };
  });

  const auth: Credential.AuthController = {
    providerName: "MacroGraph",
    status: lock.withPermit(statusUnlocked).pipe(
      Effect.mapError(storageError),
      Effect.tap(() => notifyIfAuthorizationChanged),
    ),
    start: lock.withPermit(
      Effect.gen(function* (): Effect.fn.Return<Credential.AuthStatus, Credential.AuthError> {
        const current = yield* statusUnlocked.pipe(Effect.mapError(storageError));
        if (current.state !== "disconnected") return current;
        const started = yield* request("/server/registration/start", RegistrationStart, {
          method: "POST",
        }).pipe(Effect.mapError((error) => new Credential.AuthError({ reason: error.reason })));
        const verificationUrl = new URL(started.verification_uri_complete);
        if (
          verificationUrl.protocol !== "https:" ||
          verificationUrl.username !== "" ||
          verificationUrl.password !== ""
        )
          return yield* new Credential.AuthError({
            reason: "MacroGraph returned an unsafe verification URL",
          });
        const pending: StoredState = {
          state: "pending",
          id: started.id,
          verificationUrl: verificationUrl.href,
        };
        yield* options.store.write(JSON.stringify(pending)).pipe(Effect.mapError(storageError));
        stored = pending;
        return { state: "pending" as const, verificationUrl: verificationUrl.href };
      }),
    ),
    poll: lock
      .withPermit(
        Effect.gen(function* (): Effect.fn.Return<Credential.AuthStatus, Credential.AuthError> {
          yield* load.pipe(Effect.mapError(storageError));
          if (stored?.state !== "pending")
            return yield* statusUnlocked.pipe(Effect.mapError(storageError));
          const pending = stored;
          const result = yield* request(
            "/server/registration",
            RegistrationResult,
            {
              method: "POST",
              body: JSON.stringify({ id: pending.id }),
            },
            undefined,
            400,
          ).pipe(Effect.mapError((error) => new Credential.AuthError({ reason: error.reason })));
          if ("code" in result) {
            if (result.code === "authorization_pending")
              return { state: "pending" as const, verificationUrl: pending.verificationUrl };
            yield* clear.pipe(Effect.mapError(storageError));
            return yield* new Credential.AuthError({
              reason: "MacroGraph authorization was denied or expired",
            });
          }
          const [registration, user] = yield* Effect.all([
            request("/server/registration", Registration, undefined, result.token),
            request("/user", CloudUser, undefined, result.token),
          ]).pipe(Effect.mapError((error) => new Credential.AuthError({ reason: error.reason })));
          if (user === null || user.id !== registration.ownerId)
            return yield* new Credential.AuthError({
              reason: "MacroGraph returned an invalid account identity",
            });
          const session: StoredState = {
            state: "connected",
            token: result.token,
            userId: registration.ownerId,
            email: user.email,
            expiresAt: now() + SESSION_LIFETIME_MS,
          };
          yield* options.store.write(JSON.stringify(session)).pipe(Effect.mapError(storageError));
          stored = session;
          cachedCredentials = undefined;
          return {
            state: "connected" as const,
            identity: { id: user.id, displayName: user.email },
          };
        }),
      )
      .pipe(Effect.tap(() => notify)),
    disconnect: lock
      .withPermit(clear.pipe(Effect.mapError(storageError)))
      .pipe(Effect.andThen(notify)),
  };

  const get = lock
    .withPermit(
      Effect.gen(function* () {
        const session = yield* activeSession;
        if (session === undefined) return [];
        const source = cachedCredentials ?? (yield* fetchCredentials);
        return source.map(toEngineCredential);
      }).pipe(Effect.catch(() => Effect.succeed<Array<Engine.Credential>>([]))),
    )
    .pipe(Effect.tap(() => notifyIfAuthorizationChanged));
  const catalog = lock
    .withPermit(
      Effect.gen(function* () {
        const session = yield* activeSession;
        if (session === undefined)
          return Credential.unavailable("not-connected", "MacroGraph is not connected.");
        return catalogFrom(cachedCredentials ?? (yield* fetchCredentials));
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(unavailable("Credentials could not be loaded from MacroGraph.")),
        ),
      ),
    )
    .pipe(Effect.tap(() => notifyIfAuthorizationChanged));
  const refetch = lock.withPermit(fetchCredentials.pipe(Effect.map(catalogFrom))).pipe(
    Effect.tap(() => notify),
    Effect.catch(() =>
      Effect.succeed(unavailable("Credentials could not be refreshed from MacroGraph.")),
    ),
    Effect.tap(() => notifyIfAuthorizationChanged),
  );
  const refresh = (provider: string, id: string) =>
    lock
      .withPermit(
        Effect.gen(function* () {
          const session = yield* activeSession;
          if (session === undefined)
            return yield* new CloudCredentialError({
              code: "not-connected",
              reason: "MacroGraph is not connected",
            });
          yield* request(
            `/credentials/${encodeURIComponent(provider)}/${encodeURIComponent(id)}/refresh`,
            CloudCredential,
            { method: "POST" },
            session.token,
          );
          const credentials = yield* fetchCredentials;
          const credential = credentials.find(
            (candidate) => candidate.provider === provider && candidate.id === id,
          );
          return credential === undefined
            ? yield* new CloudCredentialError({
                code: "invalid-response",
                reason: "MacroGraph did not return the refreshed credential",
              })
            : toEngineCredential(credential);
        }),
      )
      .pipe(
        Effect.tap(() => notify),
        Effect.ensuring(notifyIfAuthorizationChanged),
        Effect.orDie,
      );
  const subscribe = (
    callback: () => Effect.Effect<void>,
  ): Effect.Effect<void, never, Scope.Scope> =>
    Effect.gen(function* () {
      const scope = yield* Effect.scope;
      subscribers.add(callback);
      yield* Scope.addFinalizerExit(scope, () =>
        Effect.sync(() => {
          subscribers.delete(callback);
        }),
      );
    });

  const startClientAuth = Effect.gen(function* () {
    const session = yield* activeSession.pipe(
      Effect.mapError(
        (error) => new CloudCredentialError({ code: "request-failed", reason: error.reason }),
      ),
    );
    if (session === undefined)
      return yield* new CloudCredentialError({
        code: "not-connected",
        reason: "The server must be connected to MacroGraph before clients can sign in",
      });
    const authorization = yield* request(
      "/login/device/code",
      DeviceAuthorization,
      { method: "POST" },
      session.token,
    );
    const verificationUrl = new URL(authorization.verification_uri_complete);
    if (
      verificationUrl.protocol !== "https:" ||
      verificationUrl.username !== "" ||
      verificationUrl.password !== ""
    )
      return yield* new CloudCredentialError({
        code: "invalid-response",
        reason: "MacroGraph returned an unsafe verification URL",
      });
    return { ...authorization, verification_uri_complete: verificationUrl.href };
  });

  const pollClientAuth = (deviceCode: string) =>
    Effect.gen(function* () {
      const result = yield* request(
        `/login/oauth/access_token?device_code=${encodeURIComponent(deviceCode)}&grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:device_code")}`,
        DeviceGrantResult,
        { method: "POST" },
        undefined,
        400,
      );
      if ("code" in result) {
        if (result.code === "authorization_pending") return { state: "pending" as const };
        return yield* new CloudCredentialError({
          code: "authorization-denied",
          reason: "MacroGraph sign in was denied or expired",
        });
      }
      const user = yield* request("/user", CloudUser, undefined, result.access_token);
      if (user === null || user.id !== result.userId)
        return yield* new CloudCredentialError({
          code: "invalid-response",
          reason: "MacroGraph returned an invalid account identity",
        });
      return { state: "connected" as const, userId: user.id, email: user.email };
    });

  return {
    auth,
    clientAuth: { start: startClientAuth, poll: pollClientAuth },
    credentials: { get, refresh, subscribe, catalog, refetch, auth },
  };
};

export * as CloudCredentials from "./index.ts";
