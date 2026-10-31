/**
 * An OAuth 2.0 client for macrograph.app (see `apps/cloud/OAUTH.md`). Servers register themselves
 * (RFC 7591) and sign users in with the device authorization grant (RFC 8628); the owner's grant,
 * with a rotating refresh token, gives access to their credentials.
 */
import * as Credential from "@macrograph/module/Credential";
import * as Engine from "@macrograph/module/Engine";
import { Data, Effect, Redacted, Schema, Scope, Semaphore } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

export const DEFAULT_ISSUER = "https://macrograph.app";
export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/** Signs the owner in and keeps a refresh token for their credentials. */
export const OWNER_SCOPE = "openid email offline_access credentials";
/** Identifies a user signing in to a server; nothing outlives the sign-in. */
export const SIGN_IN_SCOPE = "openid email";

const clockSkewSeconds = 60;
const accessTokenMarginMs = 60_000;

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

/** How this client identifies itself to the authorization server. */
export type ClientConfig =
  /** A built-in public client, such as the browser playground. */
  | { readonly type: "public"; readonly clientId: string }
  /** A confidential client that registers itself on first use, such as a server. */
  | {
      readonly type: "registered";
      readonly name: string;
      readonly softwareId: string;
      readonly softwareVersion?: string;
    };

export interface Options {
  readonly store: SessionStore;
  readonly client: ClientConfig;
  /** The authorization server's issuer identifier. */
  readonly issuer?: string;
  readonly now?: () => number;
}

// ---- Persisted state ----

const RegisteredClient = Schema.Struct({
  issuer: Schema.String,
  clientId: Schema.String,
  clientSecret: Schema.String,
  registrationAccessToken: Schema.String,
  registrationClientUri: Schema.String,
  name: Schema.String,
});
const Grant = Schema.Struct({
  refreshToken: Schema.String,
  scope: Schema.String,
  userId: Schema.String,
  email: Schema.NullOr(Schema.String),
});
const PendingAuthorization = Schema.Struct({
  deviceCode: Schema.String,
  userCode: Schema.String,
  verificationUrl: Schema.String,
  interval: Schema.Number,
  expiresAt: Schema.Number,
});
const Stored = Schema.Struct({
  version: Schema.Literal(2),
  client: Schema.optional(RegisteredClient),
  grant: Schema.optional(Grant),
  pending: Schema.optional(PendingAuthorization),
});
type Stored = typeof Stored.Type;

// ---- Protocol messages ----

const Metadata = Schema.Struct({
  issuer: Schema.String,
  device_authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  jwks_uri: Schema.String,
  registration_endpoint: Schema.optional(Schema.String),
  revocation_endpoint: Schema.optional(Schema.String),
});
type Metadata = typeof Metadata.Type;

const Registration = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.String,
  registration_access_token: Schema.String,
  registration_client_uri: Schema.String,
});
const DeviceAuthorizationResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  interval: Schema.optional(Schema.Number),
});
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  token_type: Schema.String,
  expires_in: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  id_token: Schema.optional(Schema.String),
});
type TokenResponse = typeof TokenResponse.Type;
const ErrorResponse = Schema.Struct({
  error: Schema.String,
  error_description: Schema.optional(Schema.String),
});
const Jwks = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      kty: Schema.String,
      kid: Schema.optional(Schema.String),
      n: Schema.optional(Schema.String),
      e: Schema.optional(Schema.String),
    }),
  ),
});

export const CloudCredential = Schema.Struct({
  provider: Schema.String,
  id: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  scopes: Schema.optional(Schema.Array(Schema.String)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  token: Schema.Struct({
    access_token: Schema.String,
    expires_in: Schema.Number,
    token_type: Schema.String,
    issuedAt: Schema.Number,
  }),
});
const CloudCredentialList = Schema.Array(CloudCredential);

/** An RFC 6749 §5.2 error from the authorization server. */
class OAuthError extends Data.TaggedError("OAuthError")<{
  readonly error: string;
  readonly description: string | undefined;
}> {}

export interface DeviceSignIn {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly interval: number;
  readonly expiresIn: number;
}

export interface Identity {
  readonly userId: string;
  readonly email: string;
}

export type CredentialClient = Engine.CredentialService & {
  readonly catalog: Effect.Effect<Credential.Catalog>;
  readonly refetch: Effect.Effect<Credential.Catalog>;
  readonly auth: Credential.AuthController;
};

export interface Service {
  readonly credentials: CredentialClient;
  /** Connects the owner's account, whose grant gives access to their credentials. */
  readonly auth: Credential.AuthController;
  /** Like `auth.poll`, but only accepts the expected account. */
  readonly pollOwner: (
    ownerId: string,
  ) => Effect.Effect<Credential.AuthStatus, Credential.AuthError>;
  /** Identifies a user with a one-off device sign-in. */
  readonly signIn: {
    readonly start: Effect.Effect<DeviceSignIn, CloudCredentialError>;
    readonly poll: (
      deviceCode: string,
    ) => Effect.Effect<
      | { readonly state: "pending"; readonly interval: number }
      | ({ readonly state: "connected" } & Identity),
      CloudCredentialError
    >;
  };
}

// ---- Helpers ----

const base64UrlDecode = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(
    atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    (character) => character.charCodeAt(0),
  );
};

const decodeJson = (part: string): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** RFC 6749 §2.3.1: both parts are form-encoded before Basic encoding. */
const basicAuthorization = (clientId: string, secret: string) => {
  const encode = (value: string) => encodeURIComponent(value).replaceAll("%20", "+");
  return `Basic ${btoa(`${encode(clientId)}:${encode(secret)}`)}`;
};

const isLoopback = (url: URL) =>
  url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";

const safeUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url))) &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};

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
  metadata: sanitize(credential.metadata ?? {}, [credential.token.access_token]) as Readonly<
    Record<string, Schema.Json>
  >,
});

const failure = (code: CloudCredentialError["code"], reason: string) =>
  new CloudCredentialError({ code, reason });

const requestFailed = () =>
  failure("request-failed", "MacroGraph could not complete the request; try again");
const invalidResponse = () =>
  failure("invalid-response", "MacroGraph returned an invalid response");

export const make = Effect.fnUntraced(function* (
  options: Options,
): Effect.fn.Return<Service, never, HttpClient.HttpClient> {
  const issuer = (options.issuer ?? DEFAULT_ISSUER).replace(/\/$/, "");
  const http = HttpClient.withScope(yield* HttpClient.HttpClient);
  const now = options.now ?? Date.now;
  const lock = Semaphore.makeUnsafe(1);
  const clientLock = Semaphore.makeUnsafe(1);
  const subscribers = new Set<() => Effect.Effect<void>>();
  let loaded = false;
  let stored: Stored = { version: 2 };
  let metadata: Metadata | undefined;
  const keys = new Map<string, CryptoKey>();
  let access: { readonly token: string; readonly expiresAt: number } | undefined;
  let cachedCredentials: ReadonlyArray<typeof CloudCredential.Type> | undefined;
  let authorizationChanged = false;
  /** When each device code may next be polled, so callers polling faster don't trip `slow_down`. */
  const polls = new Map<string, { nextAt: number; interval: number }>();

  // ---- Storage ----

  const storageError = (error: SessionStoreError) =>
    new Credential.AuthError({ reason: error.reason });
  const load = Effect.gen(function* () {
    if (loaded) return;
    const raw = yield* options.store.read;
    if (raw !== null) {
      const decoded = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(Stored)(JSON.parse(raw)),
        catch: () => undefined,
      }).pipe(Effect.option);
      // Unreadable or older state is discarded; the server registers and connects again.
      if (decoded._tag === "Some") stored = decoded.value;
      else yield* options.store.clear;
    }
    loaded = true;
  });
  const save = (next: Stored) =>
    options.store.write(JSON.stringify(next)).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          stored = next;
        }),
      ),
    );
  /** The stored state with only the given parts kept. */
  const keep = (parts: { readonly client?: boolean; readonly grant?: boolean }): Stored => ({
    version: 2,
    ...(parts.client && stored.client !== undefined ? { client: stored.client } : {}),
    ...(parts.grant && stored.grant !== undefined ? { grant: stored.grant } : {}),
  });
  const clearGrant = Effect.gen(function* () {
    yield* save(keep({ client: true }));
    access = undefined;
    cachedCredentials = undefined;
    authorizationChanged = true;
  });

  // Clears the pending change first: a subscriber that reads credentials must not notify again
  // from inside this notification, re-entering itself.
  const notify = Effect.suspend(() => {
    authorizationChanged = false;
    return Effect.forEach(Array.from(subscribers), (subscriber) => subscriber(), {
      discard: true,
    });
  });
  const notifyIfAuthorizationChanged = Effect.suspend(() => {
    if (!authorizationChanged) return Effect.void;
    authorizationChanged = false;
    return notify;
  });

  // ---- HTTP ----

  const execute = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.gen(function* () {
      const response = yield* http.execute(request).pipe(Effect.mapError(requestFailed));
      const body = yield* response.json.pipe(Effect.catch(() => Effect.succeed(undefined)));
      return { status: response.status, body };
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.fail(failure("request-failed", "MacroGraph took too long to respond")),
      }),
    );

  const decode = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError(invalidResponse));

  /** Decodes a success body, or fails with the RFC 6749 error the server returned. */
  const oauthResult = <A, I>(
    schema: Schema.Codec<A, I>,
    response: { readonly status: number; readonly body: unknown },
  ) =>
    Effect.gen(function* () {
      if (response.status >= 200 && response.status < 300)
        return yield* decode(schema, response.body);
      const error = yield* decode(ErrorResponse, response.body);
      return yield* new OAuthError({ error: error.error, description: error.error_description });
    });

  const discover = Effect.gen(function* () {
    if (metadata !== undefined) return metadata;
    const response = yield* execute(
      HttpClientRequest.get(`${issuer}/.well-known/oauth-authorization-server`),
    );
    if (response.status !== 200) return yield* requestFailed();
    const discovered = yield* decode(Metadata, response.body);
    // RFC 8414 §3.3: the metadata must describe the issuer it was fetched for.
    if (discovered.issuer !== issuer) return yield* invalidResponse();
    metadata = discovered;
    return discovered;
  });

  // ---- Clients ----

  interface ActiveClient {
    readonly clientId: string;
    readonly authenticate: (
      request: HttpClientRequest.HttpClientRequest,
      params: Record<string, string>,
    ) => HttpClientRequest.HttpClientRequest;
  }

  const form = (request: HttpClientRequest.HttpClientRequest, params: Record<string, string>) =>
    HttpClientRequest.bodyText(
      HttpClientRequest.setHeader(request, "accept", "application/json"),
      new URLSearchParams(params).toString(),
      "application/x-www-form-urlencoded",
    );

  const register = (config: Extract<ClientConfig, { type: "registered" }>) =>
    Effect.gen(function* () {
      const { registration_endpoint } = yield* discover;
      if (registration_endpoint === undefined) return yield* invalidResponse();
      const response = yield* execute(
        HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post(registration_endpoint), {
          client_name: config.name,
          grant_types: [DEVICE_CODE_GRANT, "refresh_token"],
          token_endpoint_auth_method: "client_secret_basic",
          software_id: config.softwareId,
          ...(config.softwareVersion === undefined
            ? {}
            : { software_version: config.softwareVersion }),
        }),
      );
      const registration = yield* oauthResult(Registration, response).pipe(
        Effect.catchTag("OAuthError", () => Effect.fail(requestFailed())),
      );
      const client: typeof RegisteredClient.Type = {
        issuer,
        clientId: registration.client_id,
        clientSecret: registration.client_secret,
        registrationAccessToken: registration.registration_access_token,
        registrationClientUri: registration.registration_client_uri,
        name: config.name,
      };
      // A new client cannot use grants issued to the old one.
      yield* save({ version: 2, client }).pipe(Effect.mapError(requestFailed));
      access = undefined;
      return client;
    });

  /** Keeps the registered name current (RFC 7592); a failure leaves the old name. */
  const rename = (client: typeof RegisteredClient.Type, name: string) =>
    Effect.gen(function* () {
      const response = yield* execute(
        HttpClientRequest.bodyJsonUnsafe(
          HttpClientRequest.setHeader(
            HttpClientRequest.put(client.registrationClientUri),
            "authorization",
            `Bearer ${client.registrationAccessToken}`,
          ),
          { client_id: client.clientId, client_name: name },
        ),
      );
      if (response.status !== 200) return client;
      const renamed = { ...client, name };
      yield* save({ ...stored, client: renamed }).pipe(Effect.mapError(requestFailed));
      return renamed;
    }).pipe(Effect.catch(() => Effect.succeed(client)));

  const activeClient = clientLock.withPermit(
    Effect.gen(function* (): Effect.fn.Return<ActiveClient, CloudCredentialError> {
      yield* load.pipe(Effect.mapError(requestFailed));
      const config = options.client;
      if (config.type === "public")
        return {
          clientId: config.clientId,
          authenticate: (request, params) =>
            form(request, { ...params, client_id: config.clientId }),
        };
      let client =
        stored.client !== undefined && stored.client.issuer === issuer
          ? stored.client
          : yield* register(config);
      if (client.name !== config.name) client = yield* rename(client, config.name);
      const { clientId, clientSecret } = client;
      return {
        clientId,
        authenticate: (request, params) =>
          form(
            HttpClientRequest.setHeader(
              request,
              "authorization",
              basicAuthorization(clientId, clientSecret),
            ),
            params,
          ),
      };
    }),
  );

  /** Runs a client request, registering again once if the server no longer knows the client. */
  const withClient = <A, R>(
    run: (client: ActiveClient) => Effect.Effect<A, CloudCredentialError | OAuthError, R>,
  ) =>
    activeClient.pipe(
      Effect.flatMap(run),
      Effect.catchTag("OAuthError", (error) =>
        error.error === "invalid_client" && options.client.type === "registered"
          ? clientLock.withPermit(save({ version: 2 }).pipe(Effect.mapError(requestFailed))).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  access = undefined;
                  authorizationChanged = true;
                }),
              ),
              Effect.andThen(activeClient),
              Effect.flatMap(run),
            )
          : Effect.fail(error),
      ),
    );

  const tokenRequest = (client: ActiveClient, params: Record<string, string>) =>
    Effect.gen(function* () {
      const { token_endpoint } = yield* discover;
      const response = yield* execute(
        client.authenticate(HttpClientRequest.post(token_endpoint), params),
      );
      const tokens = yield* oauthResult(TokenResponse, response);
      if (tokens.token_type.toLowerCase() !== "bearer") return yield* invalidResponse();
      return tokens;
    });

  const revoke = (client: ActiveClient, token: string, hint: "access_token" | "refresh_token") =>
    Effect.gen(function* () {
      const { revocation_endpoint } = yield* discover;
      if (revocation_endpoint === undefined) return;
      yield* execute(
        client.authenticate(HttpClientRequest.post(revocation_endpoint), {
          token,
          token_type_hint: hint,
        }),
      );
    }).pipe(Effect.ignore);

  // ---- ID tokens (OpenID Connect Core §3.1.3.7) ----

  const signingKey = (kid: string | undefined, refresh: boolean) =>
    Effect.gen(function* () {
      const cacheKey = kid ?? "";
      const cached = keys.get(cacheKey);
      if (cached !== undefined && !refresh) return cached;
      const { jwks_uri } = yield* discover;
      const response = yield* execute(HttpClientRequest.get(jwks_uri));
      const jwks = yield* decode(Jwks, response.body);
      keys.clear();
      for (const key of jwks.keys) {
        if (key.kty !== "RSA" || key.n === undefined || key.e === undefined) continue;
        const imported = yield* Effect.tryPromise({
          try: () =>
            crypto.subtle.importKey(
              "jwk",
              { kty: "RSA", n: key.n!, e: key.e! },
              { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
              false,
              ["verify"],
            ),
          catch: invalidResponse,
        });
        keys.set(key.kid ?? "", imported);
      }
      return keys.get(cacheKey);
    });

  const verifyIdToken = (token: string, clientId: string) =>
    Effect.gen(function* () {
      const [headerPart, payloadPart, signaturePart] = token.split(".");
      if (headerPart === undefined || payloadPart === undefined || signaturePart === undefined)
        return yield* invalidResponse();
      const header = decodeJson(headerPart);
      const claims = decodeJson(payloadPart);
      if (!isRecord(header) || !isRecord(claims) || header.alg !== "RS256")
        return yield* invalidResponse();
      const kid = typeof header.kid === "string" ? header.kid : undefined;
      const key = (yield* signingKey(kid, false)) ?? (yield* signingKey(kid, true));
      if (key === undefined) return yield* invalidResponse();
      const valid = yield* Effect.tryPromise({
        try: () =>
          crypto.subtle.verify(
            "RSASSA-PKCS1-v1_5",
            key,
            base64UrlDecode(signaturePart),
            new TextEncoder().encode(`${headerPart}.${payloadPart}`),
          ),
        catch: invalidResponse,
      });
      const seconds = now() / 1000;
      const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (
        !valid ||
        claims.iss !== issuer ||
        !audience.includes(clientId) ||
        (audience.length > 1 && claims.azp !== clientId) ||
        typeof claims.exp !== "number" ||
        claims.exp + clockSkewSeconds < seconds ||
        typeof claims.iat !== "number" ||
        claims.iat - clockSkewSeconds > seconds ||
        typeof claims.sub !== "string"
      )
        return yield* failure("invalid-response", "MacroGraph returned an invalid ID token");
      return {
        userId: claims.sub,
        email: typeof claims.email === "string" ? claims.email : null,
      };
    });

  // ---- Device flow (RFC 8628) ----

  const startDevice = (client: ActiveClient, scope: string) =>
    Effect.gen(function* () {
      const { device_authorization_endpoint } = yield* discover;
      const response = yield* execute(
        client.authenticate(HttpClientRequest.post(device_authorization_endpoint), { scope }),
      );
      const started = yield* oauthResult(DeviceAuthorizationResponse, response);
      const verificationUrl = safeUrl(
        started.verification_uri_complete ?? started.verification_uri,
      );
      if (verificationUrl === undefined)
        return yield* failure("invalid-response", "MacroGraph returned an unsafe verification URL");
      const interval = started.interval ?? 5;
      polls.set(started.device_code, { nextAt: now() + interval * 1000, interval });
      return {
        deviceCode: started.device_code,
        userCode: started.user_code,
        verificationUrl,
        interval,
        expiresIn: started.expires_in,
      } satisfies DeviceSignIn;
    });

  /** One token request for a device code, or `pending` while it is too soon to ask again. */
  const pollDevice = (client: ActiveClient, deviceCode: string) =>
    Effect.gen(function* (): Effect.fn.Return<
      { readonly state: "pending"; readonly interval: number } | TokenResponse,
      CloudCredentialError | OAuthError
    > {
      const schedule = polls.get(deviceCode) ?? { nextAt: 0, interval: 5 };
      if (now() < schedule.nextAt) return { state: "pending", interval: schedule.interval };
      const result = yield* tokenRequest(client, {
        grant_type: DEVICE_CODE_GRANT,
        device_code: deviceCode,
      }).pipe(
        Effect.map((tokens) => ({ tokens })),
        Effect.catchTag("OAuthError", (error) =>
          error.error === "authorization_pending" || error.error === "slow_down"
            ? Effect.succeed({ wait: error.error === "slow_down" ? 5 : 0 })
            : Effect.fail(error),
        ),
      );
      if ("tokens" in result) {
        polls.delete(deviceCode);
        return result.tokens;
      }
      const interval = schedule.interval + result.wait;
      polls.set(deviceCode, { nextAt: now() + interval * 1000, interval });
      return { state: "pending", interval };
    });

  const denied = (error: OAuthError) =>
    failure(
      "authorization-denied",
      error.error === "expired_token"
        ? "The code expired before it was approved; try again"
        : error.error === "access_denied"
          ? "The request was denied on macrograph.app"
          : (error.description ?? "MacroGraph sign in failed"),
    );

  // ---- The owner's grant ----

  const accessToken = (force: boolean) =>
    Effect.gen(function* () {
      yield* load.pipe(Effect.mapError(requestFailed));
      if (!force && access !== undefined && access.expiresAt - accessTokenMarginMs > now())
        return access.token;
      const grant = stored.grant;
      if (grant === undefined)
        return yield* failure("not-connected", "MacroGraph is not connected");
      const tokens = yield* withClient((client) =>
        tokenRequest(client, { grant_type: "refresh_token", refresh_token: grant.refreshToken }),
      ).pipe(
        Effect.catchTag("OAuthError", () =>
          // The grant was revoked, expired, or its refresh token was replayed.
          clearGrant.pipe(
            Effect.mapError(requestFailed),
            Effect.andThen(
              Effect.fail(
                failure(
                  "authorization-expired",
                  "MacroGraph authorization ended; reconnect the account",
                ),
              ),
            ),
          ),
        ),
      );
      // Refresh tokens rotate; persist the new one before using anything it unlocks.
      if (tokens.refresh_token !== undefined)
        yield* save({ ...stored, grant: { ...grant, refreshToken: tokens.refresh_token } }).pipe(
          Effect.mapError(requestFailed),
        );
      access = {
        token: tokens.access_token,
        expiresAt: now() + (tokens.expires_in ?? 3600) * 1000,
      };
      return tokens.access_token;
    });

  /** Calls the credentials API, refreshing the access token once if it was rejected. */
  const credentialsRequest = <A, I>(
    path: string,
    schema: Schema.Codec<A, I>,
    method: "GET" | "POST",
  ) =>
    Effect.gen(function* () {
      const attempt = (token: string) =>
        execute(
          HttpClientRequest.setHeader(
            HttpClientRequest.make(method)(`${issuer}/api${path}`),
            "authorization",
            `Bearer ${token}`,
          ),
        );
      let response = yield* attempt(yield* accessToken(false));
      if (response.status === 401) response = yield* attempt(yield* accessToken(true));
      if (response.status === 401 || response.status === 403) {
        yield* clearGrant.pipe(Effect.mapError(requestFailed));
        return yield* failure(
          "authorization-expired",
          "MacroGraph authorization ended; reconnect the account",
        );
      }
      if (response.status < 200 || response.status >= 300) return yield* requestFailed();
      return yield* decode(schema, response.body);
    });

  const fetchCredentials = credentialsRequest("/credentials", CloudCredentialList, "GET").pipe(
    Effect.tap((credentials) =>
      Effect.sync(() => {
        cachedCredentials = credentials;
      }),
    ),
  );

  const statusUnlocked = Effect.gen(function* (): Effect.fn.Return<
    Credential.AuthStatus,
    SessionStoreError
  > {
    yield* load;
    if (stored.grant !== undefined)
      return {
        state: "connected",
        identity: {
          id: stored.grant.userId,
          displayName: stored.grant.email ?? stored.grant.userId,
        },
      };
    const pending = stored.pending;
    return pending !== undefined && pending.expiresAt > now()
      ? { state: "pending", verificationUrl: pending.verificationUrl, userCode: pending.userCode }
      : { state: "disconnected" };
  });

  const authError = (error: CloudCredentialError | SessionStoreError) =>
    new Credential.AuthError({ reason: error.reason });

  const pollOwnerUnlocked = (expectedOwnerId: string | undefined) =>
    Effect.gen(function* (): Effect.fn.Return<Credential.AuthStatus, Credential.AuthError> {
      yield* load.pipe(Effect.mapError(storageError));
      const pending = stored.pending;
      if (pending === undefined || stored.grant !== undefined)
        return yield* statusUnlocked.pipe(Effect.mapError(storageError));
      const pendingStatus: Credential.AuthStatus = {
        state: "pending",
        verificationUrl: pending.verificationUrl,
        userCode: pending.userCode,
      };
      const clearPending = Effect.suspend(() => save(keep({ client: true, grant: true }))).pipe(
        Effect.mapError(storageError),
      );

      const outcome = yield* withClient((client) =>
        pollDevice(client, pending.deviceCode).pipe(
          Effect.flatMap((result) =>
            "state" in result
              ? Effect.succeed(undefined)
              : verifyIdToken(result.id_token ?? "", client.clientId).pipe(
                  Effect.map((identity) => ({ client, tokens: result, identity })),
                ),
          ),
        ),
      ).pipe(
        Effect.catchTag("OAuthError", (error) =>
          clearPending.pipe(Effect.andThen(Effect.fail(authError(denied(error))))),
        ),
        Effect.mapError((error) =>
          error instanceof Credential.AuthError ? error : authError(error),
        ),
      );
      if (outcome === undefined) return pendingStatus;

      const { client, tokens, identity } = outcome;
      if (tokens.refresh_token === undefined) {
        yield* clearPending;
        return yield* new Credential.AuthError({
          reason: "MacroGraph did not grant offline access",
        });
      }
      if (expectedOwnerId !== undefined && identity.userId !== expectedOwnerId) {
        yield* revoke(client, tokens.refresh_token, "refresh_token");
        yield* clearPending;
        return yield* new Credential.AuthError({
          reason: "Only the server owner's MacroGraph account can connect this server",
        });
      }
      yield* save({
        ...keep({ client: true }),
        grant: {
          refreshToken: tokens.refresh_token,
          scope: tokens.scope ?? OWNER_SCOPE,
          userId: identity.userId,
          email: identity.email,
        },
      }).pipe(Effect.mapError(storageError));
      access = {
        token: tokens.access_token,
        expiresAt: now() + (tokens.expires_in ?? 3600) * 1000,
      };
      cachedCredentials = undefined;
      return {
        state: "connected" as const,
        identity: { id: identity.userId, displayName: identity.email ?? identity.userId },
      };
    });

  const pollOwner = (expectedOwnerId: string | undefined) =>
    lock.withPermit(pollOwnerUnlocked(expectedOwnerId)).pipe(Effect.tap(() => notify));

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
        const started = yield* withClient((client) => startDevice(client, OWNER_SCOPE)).pipe(
          Effect.catchTag("OAuthError", (error) => Effect.fail(denied(error))),
          Effect.mapError(authError),
        );
        yield* save({
          ...stored,
          pending: {
            deviceCode: started.deviceCode,
            userCode: started.userCode,
            verificationUrl: started.verificationUrl,
            interval: started.interval,
            expiresAt: now() + started.expiresIn * 1000,
          },
        }).pipe(Effect.mapError(storageError));
        return {
          state: "pending" as const,
          verificationUrl: started.verificationUrl,
          userCode: started.userCode,
        };
      }),
    ),
    poll: pollOwner(undefined),
    disconnect: lock
      .withPermit(
        Effect.gen(function* () {
          yield* load;
          const grant = stored.grant;
          if (grant !== undefined)
            yield* withClient((client) => revoke(client, grant.refreshToken, "refresh_token")).pipe(
              Effect.ignore,
            );
          yield* clearGrant;
        }).pipe(Effect.mapError(storageError)),
      )
      .pipe(Effect.andThen(notify)),
  };

  // ---- Credentials ----

  const unavailable = (message: string): Credential.Catalog =>
    Credential.unavailable("request-failed", message);
  const catalogFrom = (
    credentials: ReadonlyArray<typeof CloudCredential.Type>,
  ): Credential.Catalog => ({
    _tag: "CredentialCatalogAvailable",
    credentials: credentials.map(toSummary),
  });
  const connected = load.pipe(Effect.map(() => stored.grant !== undefined));
  /**
   * Cached credentials last only as long as the access token, so a grant revoked on macrograph.app
   * is noticed within the hour instead of when the process restarts.
   */
  const cached = () =>
    access !== undefined && access.expiresAt > now() ? cachedCredentials : undefined;

  const get = lock
    .withPermit(
      Effect.gen(function* () {
        if (!(yield* connected)) return [];
        const source = cached() ?? (yield* fetchCredentials);
        return source.map(toEngineCredential);
      }).pipe(Effect.catch(() => Effect.succeed<Array<Engine.Credential>>([]))),
    )
    .pipe(Effect.tap(() => notifyIfAuthorizationChanged));
  const catalog = lock
    .withPermit(
      Effect.gen(function* () {
        if (!(yield* connected))
          return Credential.unavailable("not-connected", "MacroGraph is not connected.");
        return catalogFrom(cached() ?? (yield* fetchCredentials));
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
          const credential = yield* credentialsRequest(
            `/credentials/${encodeURIComponent(provider)}/${encodeURIComponent(id)}/refresh`,
            CloudCredential,
            "POST",
          );
          cachedCredentials = (cachedCredentials ?? []).map((candidate) =>
            candidate.provider === provider && candidate.id === id ? credential : candidate,
          );
          return toEngineCredential(credential);
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

  // ---- One-off sign-in for a server's users ----

  const signIn: Service["signIn"] = {
    start: withClient((client) => startDevice(client, SIGN_IN_SCOPE)).pipe(
      Effect.catchTag("OAuthError", (error) => Effect.fail(denied(error))),
    ),
    poll: (deviceCode) =>
      withClient((client) =>
        Effect.gen(function* () {
          const result = yield* pollDevice(client, deviceCode);
          if ("state" in result) return result;
          const identity = yield* verifyIdToken(result.id_token ?? "", client.clientId);
          // The server keeps its own session; nothing else needs this token.
          yield* revoke(client, result.access_token, "access_token");
          if (identity.email === null)
            return yield* failure("invalid-response", "MacroGraph did not share an email address");
          return { state: "connected" as const, userId: identity.userId, email: identity.email };
        }),
      ).pipe(Effect.catchTag("OAuthError", (error) => Effect.fail(denied(error)))),
  };

  return {
    auth,
    pollOwner: (ownerId) => pollOwner(ownerId),
    signIn,
    credentials: { get, refresh, subscribe, catalog, refetch, auth },
  };
});

export * as CloudCredentials from "./index.ts";
