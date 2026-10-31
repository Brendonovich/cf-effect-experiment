/**
 * MacroGraph's OAuth 2.0 authorization server. Clients sign in with the device authorization grant
 * (RFC 8628) only; servers register themselves (RFC 7591/7592). See `OAUTH.md`.
 */
import { and, eq, gt, isNull, lt, notExists, sql } from "drizzle-orm";
import { type Context, Data, Effect } from "effect";
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http";

import type * as Database from "../database/Database.ts";

import {
  accountUsers,
  authAccessTokens,
  authClients,
  authDeviceAuthorizations,
  authGrants,
  authRateLimits,
  authRefreshTokens,
} from "../database/AccountDatabaseSchema.ts";
import * as Jwt from "./Jwt.ts";

export const deviceCodeGrantType = "urn:ietf:params:oauth:grant-type:device_code";

export const scopes = ["openid", "email", "offline_access", "credentials"] as const;
export type Scope = (typeof scopes)[number];

/** Built-in public clients. They cannot keep a secret, so they authenticate with `client_id` only. */
export const publicClients: Readonly<Record<string, { readonly name: string }>> = {
  "macrograph-playground": { name: "MacroGraph Playground" },
};

const deviceCodeLifetimeSeconds = 10 * 60;
const pollIntervalSeconds = 5;
const accessTokenLifetimeSeconds = 60 * 60;
const refreshTokenLifetimeSeconds = 90 * 24 * 60 * 60;
const idTokenLifetimeSeconds = 5 * 60;
const unusedClientLifetimeMs = 30 * 24 * 60 * 60 * 1000;

const accessTokenPrefix = "mgat_";

// ---- Encoding helpers ----

const encoder = new TextEncoder();

const randomToken = (prefix = "") =>
  `${prefix}${Jwt.base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))}`;

export const hashToken = (value: string) =>
  Effect.promise(async () => {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  });

const equalHashes = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
};

/** RFC 8628 §6.1: base-20 consonants avoid look-alike characters and accidental words. */
const userCodeAlphabet = "BCDFGHJKLMNPQRSTVWXZ";
const userCodeLength = 8;

export const generateUserCode = () => {
  const limit = 256 - (256 % userCodeAlphabet.length);
  let code = "";
  while (code.length < userCodeLength)
    for (const byte of crypto.getRandomValues(new Uint8Array(16)))
      if (byte < limit && code.length < userCodeLength)
        code += userCodeAlphabet[byte % userCodeAlphabet.length];
  return code;
};

/** Accepts any case and punctuation, as RFC 8628 §6.1 recommends. */
export const normalizeUserCode = (input: string) => {
  const code = input.toUpperCase().replaceAll(/[^A-Z]/g, "");
  return code.length === userCodeLength && [...code].every((c) => userCodeAlphabet.includes(c))
    ? code
    : undefined;
};

export const formatUserCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** RFC 6749 §3.3. Returns `undefined` for a malformed or unsupported scope. */
export const parseScope = (value: string): ReadonlyArray<Scope> | undefined => {
  const tokens = value.split(" ").filter((token) => token !== "");
  if (value !== "" && tokens.length === 0) return undefined;
  const parsed: Array<Scope> = [];
  for (const token of tokens) {
    const scope = scopes.find((candidate) => candidate === token);
    if (scope === undefined) return undefined;
    if (!parsed.includes(scope)) parsed.push(scope);
  }
  return parsed;
};

const formatScope = (value: ReadonlyArray<string>) => value.join(" ");
const storedScope = (value: string) => parseScope(value) ?? [];
const isSubset = (requested: ReadonlyArray<string>, allowed: ReadonlyArray<string>) =>
  requested.every((scope) => allowed.includes(scope));

// ---- Responses ----

export class OAuthReject extends Data.TaggedError("OAuthReject")<{
  readonly response: HttpServerResponse.HttpServerResponse;
}> {}

const noStore = { "cache-control": "no-store", pragma: "no-cache" };

export const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-expose-headers": "WWW-Authenticate",
  "access-control-max-age": "86400",
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: { ...noStore, ...headers } });

/** An RFC 6749 §5.2 error response. */
const oauthError = (
  error: string,
  description?: string,
  status = 400,
  headers: Record<string, string> = {},
) =>
  Effect.fail(
    new OAuthReject({
      response: json(
        { error, ...(description === undefined ? {} : { error_description: description }) },
        status,
        headers,
      ),
    }),
  );

const invalidRequest = (description: string) => oauthError("invalid_request", description);

/** An RFC 6750 §3 bearer token challenge. */
const bearerChallenge = (
  status: 400 | 401 | 403,
  error?: "invalid_request" | "invalid_token" | "insufficient_scope",
  details: { readonly description?: string; readonly scope?: string } = {},
) => {
  const parameters = [
    'realm="macrograph"',
    ...(error === undefined ? [] : [`error="${error}"`]),
    ...(details.description === undefined ? [] : [`error_description="${details.description}"`]),
    ...(details.scope === undefined ? [] : [`scope="${details.scope}"`]),
  ];
  return Effect.fail(
    new OAuthReject({
      response: HttpServerResponse.jsonUnsafe(
        error === undefined
          ? { error: "invalid_request" }
          : {
              error,
              ...(details.description === undefined
                ? {}
                : { error_description: details.description }),
            },
        { status, headers: { ...noStore, "www-authenticate": `Bearer ${parameters.join(", ")}` } },
      ),
    }),
  );
};

const handle = <R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, OAuthReject, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchTag("OAuthReject", (rejection) => Effect.succeed(rejection.response)),
    Effect.catchCause((cause) =>
      Effect.logError("OAuth request failed", cause).pipe(
        Effect.as(json({ error: "server_error" }, 500)),
      ),
    ),
    Effect.map((response) => HttpServerResponse.setHeaders(response, cors)),
  );

// ---- Requests ----

const requestIp = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers["cf-connecting-ip"] ?? request.headers["x-real-ip"] ?? null;

/** RFC 6749 §3.2: form-encoded, and no parameter may appear more than once. */
const readForm = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded")
      return yield* invalidRequest("Requests must be application/x-www-form-urlencoded");
    const text = yield* request.text.pipe(
      Effect.catchTag("HttpServerError", () => invalidRequest("The request body is unreadable")),
    );
    const params = new URLSearchParams(text);
    const form = new Map<string, string>();
    for (const [key, value] of params) {
      if (form.has(key)) return yield* invalidRequest(`The ${key} parameter is repeated`);
      // Parameters sent without a value are treated as omitted.
      if (value !== "") form.set(key, value);
    }
    return form;
  });

const readJsonObject = (request: HttpServerRequest.HttpServerRequest) =>
  request.json.pipe(
    Effect.catchTag("HttpServerError", () =>
      oauthError("invalid_client_metadata", "The request body must be a JSON object"),
    ),
    Effect.flatMap((body) =>
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? Effect.succeed(body as Readonly<Record<string, unknown>>)
        : oauthError("invalid_client_metadata", "The request body must be a JSON object"),
    ),
  );

const bearerToken = (request: HttpServerRequest.HttpServerRequest) => {
  const authorization = request.headers.authorization;
  if (authorization === undefined) return undefined;
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token !== undefined && token !== "" ? token : null;
};

const formDecode = (value: string) => {
  try {
    return decodeURIComponent(value.replaceAll("+", " "));
  } catch {
    return undefined;
  }
};

// ---- Clients ----

export interface Client {
  readonly id: string;
  readonly name: string;
  /** Built-in clients are ours; registered clients name themselves. */
  readonly verified: boolean;
  readonly scope: ReadonlyArray<Scope>;
}

type ClientRow = typeof authClients.$inferSelect;

const clientMetadata = (row: ClientRow, issuer: string) => ({
  client_id: row.id,
  client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
  client_secret_expires_at: 0,
  registration_client_uri: `${issuer}/oauth/register/${row.id}`,
  client_name: row.name,
  grant_types: [deviceCodeGrantType, "refresh_token"],
  response_types: [],
  token_endpoint_auth_method: row.tokenEndpointAuthMethod,
  scope: row.scope,
  ...(row.softwareId === null ? {} : { software_id: row.softwareId }),
  ...(row.softwareVersion === null ? {} : { software_version: row.softwareVersion }),
});

interface ValidatedMetadata {
  readonly name: string;
  readonly tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post";
  readonly scope: ReadonlyArray<Scope>;
  readonly softwareId: string | null;
  readonly softwareVersion: string | null;
}

/** RFC 7591 §2: unsupported values are rejected, omitted ones get our defaults. */
const validateMetadata = (body: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const invalid = (description: string) => oauthError("invalid_client_metadata", description);
    const optionalString = (key: string, max: number) => {
      const value = body[key];
      if (value === undefined || value === null) return Effect.succeed(null);
      return typeof value === "string" && value.trim() !== "" && value.length <= max
        ? Effect.succeed(value.trim())
        : invalid(`${key} must be a non-empty string of at most ${max} characters`);
    };
    const array = (key: string) => {
      const value = body[key];
      if (value === undefined) return Effect.succeed(undefined);
      return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? Effect.succeed(value as ReadonlyArray<string>)
        : invalid(`${key} must be an array of strings`);
    };

    const redirectUris = yield* array("redirect_uris");
    if (redirectUris !== undefined && redirectUris.length > 0)
      return yield* oauthError(
        "invalid_redirect_uri",
        "Only the device authorization grant is supported, which uses no redirect URIs",
      );
    const responseTypes = yield* array("response_types");
    if (responseTypes !== undefined && responseTypes.length > 0)
      return yield* invalid("No response types are supported");
    const grantTypes = yield* array("grant_types");
    if (
      grantTypes !== undefined &&
      !grantTypes.every((type) => type === deviceCodeGrantType || type === "refresh_token")
    )
      return yield* invalid(
        `grant_types may only contain ${deviceCodeGrantType} and refresh_token`,
      );

    const method = body.token_endpoint_auth_method ?? "client_secret_basic";
    if (method !== "client_secret_basic" && method !== "client_secret_post")
      return yield* invalid(
        "token_endpoint_auth_method must be client_secret_basic or client_secret_post",
      );

    let scope: ReadonlyArray<Scope> = scopes;
    if (body.scope !== undefined) {
      const parsed = typeof body.scope === "string" ? parseScope(body.scope) : undefined;
      if (parsed === undefined || parsed.length === 0)
        return yield* invalid(`scope may only contain ${formatScope(scopes)}`);
      scope = parsed;
    }

    const softwareId = yield* optionalString("software_id", 255);
    const name =
      (yield* optionalString("client_name", 100)) ??
      (softwareId === "macrograph-server" ? "MacroGraph server" : "Unnamed application");
    return {
      name,
      tokenEndpointAuthMethod: method,
      scope,
      softwareId,
      softwareVersion: yield* optionalString("software_version", 255),
    } satisfies ValidatedMetadata;
  });

// ---- Routes ----

type DatabaseClient = Context.Service.Shape<typeof Database.Service>;

export interface Options {
  readonly database: DatabaseClient;
  readonly signingKey: Effect.Effect<Jwt.SigningKey>;
  /** The issuer identifier for a request: the canonical origin, or the request's own. */
  readonly issuer: (request: HttpServerRequest.HttpServerRequest) => string;
  readonly now?: () => number;
}

export interface BearerAuthorization {
  readonly userId: string;
  readonly clientId: string;
  readonly grantId: string;
  readonly scope: ReadonlyArray<Scope>;
}

export const make = (options: Options) => {
  const { database } = options;
  const now = () => new Date(options.now?.() ?? Date.now());

  /** Counts a request in a fixed window and reports whether it went over the limit. */
  const rateLimited = (key: string, limit: number, windowSeconds: number) =>
    Effect.gen(function* () {
      const current = now();
      const windowStart = new Date(current.getTime() - windowSeconds * 1000);
      const rows = yield* database
        .insert(authRateLimits)
        .values({ key, windowStart: current, count: 1 })
        .onConflictDoUpdate({
          target: authRateLimits.key,
          set: {
            count: sql`case when ${authRateLimits.windowStart} < ${windowStart} then 1 else ${authRateLimits.count} + 1 end`,
            windowStart: sql`case when ${authRateLimits.windowStart} < ${windowStart} then ${current} else ${authRateLimits.windowStart} end`,
          },
        })
        .returning({ count: authRateLimits.count })
        .pipe(Effect.orDie);
      return (rows[0]?.count ?? 0) > limit;
    });

  const cleanup = Effect.gen(function* () {
    const current = now();
    yield* database
      .delete(authDeviceAuthorizations)
      .where(lt(authDeviceAuthorizations.expiresAt, current));
    yield* database.delete(authGrants).where(lt(authGrants.expiresAt, current));
    yield* database.delete(authRefreshTokens).where(lt(authRefreshTokens.expiresAt, current));
    yield* database.delete(authAccessTokens).where(lt(authAccessTokens.expiresAt, current));
    yield* database
      .delete(authClients)
      .where(
        and(
          lt(authClients.lastUsedAt, new Date(current.getTime() - unusedClientLifetimeMs)),
          notExists(
            database
              .select({ id: authGrants.id })
              .from(authGrants)
              .where(eq(authGrants.clientId, authClients.id)),
          ),
        ),
      );
  }).pipe(Effect.orDie);

  const deleteClient = (clientId: string) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .delete(authDeviceAuthorizations)
            .where(eq(authDeviceAuthorizations.clientId, clientId));
          // Tokens cascade from their grants.
          yield* transaction.delete(authGrants).where(eq(authGrants.clientId, clientId));
          yield* transaction.delete(authClients).where(eq(authClients.id, clientId));
        }),
      )
      .pipe(Effect.orDie);

  /** RFC 6749 §2.3: HTTP Basic, form credentials, or a public client's bare `client_id`. */
  const authenticateClient = (
    request: HttpServerRequest.HttpServerRequest,
    form: ReadonlyMap<string, string>,
  ) =>
    Effect.gen(function* (): Effect.fn.Return<Client, OAuthReject> {
      const authorization = request.headers.authorization;
      const basic = authorization?.toLowerCase().startsWith("basic ") === true;
      const failed = (description: string) =>
        oauthError(
          "invalid_client",
          description,
          401,
          basic ? { "www-authenticate": 'Basic realm="macrograph"' } : {},
        );

      let method: "client_secret_basic" | "client_secret_post" | "none";
      let clientId: string | undefined;
      let secret: string | undefined;
      if (basic) {
        if (form.has("client_secret"))
          return yield* invalidRequest("Use only one client authentication method");
        let decoded: string;
        try {
          decoded = atob(authorization!.slice("basic ".length).trim());
        } catch {
          return yield* failed("Malformed Basic credentials");
        }
        const separator = decoded.indexOf(":");
        if (separator === -1) return yield* failed("Malformed Basic credentials");
        clientId = formDecode(decoded.slice(0, separator));
        secret = formDecode(decoded.slice(separator + 1));
        if (clientId === undefined || secret === undefined)
          return yield* failed("Malformed Basic credentials");
        const formClientId = form.get("client_id");
        if (formClientId !== undefined && formClientId !== clientId)
          return yield* invalidRequest("client_id does not match the authenticated client");
        method = "client_secret_basic";
      } else if (form.has("client_secret")) {
        clientId = form.get("client_id");
        secret = form.get("client_secret");
        method = "client_secret_post";
      } else {
        clientId = form.get("client_id");
        method = "none";
      }
      if (clientId === undefined) return yield* invalidRequest("client_id is required");

      const builtIn = Object.hasOwn(publicClients, clientId) ? publicClients[clientId] : undefined;
      if (builtIn !== undefined) {
        if (method !== "none") return yield* failed("Public clients do not use a client secret");
        return { id: clientId, name: builtIn.name, verified: true, scope: scopes };
      }
      if (method === "none" || secret === undefined)
        return yield* failed("Client authentication is required");

      const rows = yield* database
        .select()
        .from(authClients)
        .where(eq(authClients.id, clientId))
        .limit(1)
        .pipe(Effect.orDie);
      const row = rows[0];
      const secretHash = yield* hashToken(secret);
      if (row === undefined || !equalHashes(row.secretHash, secretHash))
        return yield* failed("Unknown client or wrong client secret");
      if (row.tokenEndpointAuthMethod !== method)
        return yield* failed(`This client authenticates with ${row.tokenEndpointAuthMethod}`);
      yield* database
        .update(authClients)
        .set({ lastUsedAt: now() })
        .where(eq(authClients.id, row.id))
        .pipe(Effect.orDie);
      return { id: row.id, name: row.name, verified: false, scope: storedScope(row.scope) };
    });

  const signIdToken = (
    issuer: string,
    clientId: string,
    user: { readonly id: string; readonly email: string },
    scope: ReadonlyArray<Scope>,
  ) =>
    Effect.gen(function* () {
      const issuedAt = Math.floor(now().getTime() / 1000);
      return yield* Jwt.sign(
        yield* options.signingKey,
        {
          iss: issuer,
          sub: user.id,
          aud: clientId,
          iat: issuedAt,
          exp: issuedAt + idTokenLifetimeSeconds,
          ...(scope.includes("email") ? { email: user.email, email_verified: false } : {}),
        },
        { typ: "JWT" },
      );
    });

  /** Issues an access token (and ID and refresh tokens when granted) for a grant. */
  const issueTokens = (
    transaction: Pick<DatabaseClient, "insert" | "select">,
    issuer: string,
    grant: { readonly id: string; readonly clientId: string; readonly userId: string },
    grantScope: ReadonlyArray<Scope>,
    accessScope: ReadonlyArray<Scope>,
  ) =>
    Effect.gen(function* () {
      const current = now();
      const accessToken = randomToken(accessTokenPrefix);
      yield* transaction.insert(authAccessTokens).values({
        tokenHash: yield* hashToken(accessToken),
        grantId: grant.id,
        scope: formatScope(accessScope),
        expiresAt: new Date(current.getTime() + accessTokenLifetimeSeconds * 1000),
      });
      let refreshToken: string | undefined;
      if (grantScope.includes("offline_access")) {
        refreshToken = randomToken("mgrt_");
        yield* transaction.insert(authRefreshTokens).values({
          tokenHash: yield* hashToken(refreshToken),
          grantId: grant.id,
          expiresAt: new Date(current.getTime() + refreshTokenLifetimeSeconds * 1000),
        });
      }
      let idToken: string | undefined;
      if (accessScope.includes("openid")) {
        const users = yield* transaction
          .select({ id: accountUsers.id, email: accountUsers.email })
          .from(accountUsers)
          .where(eq(accountUsers.id, grant.userId))
          .limit(1);
        const user = users[0];
        if (user === undefined) return yield* Effect.die("Granting user no longer exists");
        idToken = yield* signIdToken(issuer, grant.clientId, user, accessScope);
      }
      return {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: accessTokenLifetimeSeconds,
        scope: formatScope(accessScope),
        ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
        ...(idToken === undefined ? {} : { id_token: idToken }),
      };
    });

  /** RFC 6750 bearer authentication for resources protected by an access token. */
  const authenticateBearer = (
    request: HttpServerRequest.HttpServerRequest,
    requiredScope: Scope,
  ): Effect.Effect<BearerAuthorization, OAuthReject> =>
    Effect.gen(function* () {
      const token = bearerToken(request);
      if (token === undefined) return yield* bearerChallenge(401);
      if (token === null) return yield* bearerChallenge(400, "invalid_request");
      return yield* verifyAccessToken(token, requiredScope);
    });

  const verifyAccessToken = (token: string, requiredScope: Scope) =>
    Effect.gen(function* () {
      const current = now();
      const rows = yield* database
        .select({
          scope: authAccessTokens.scope,
          grantId: authGrants.id,
          clientId: authGrants.clientId,
          userId: authGrants.userId,
        })
        .from(authAccessTokens)
        .innerJoin(authGrants, eq(authGrants.id, authAccessTokens.grantId))
        .where(
          and(
            eq(authAccessTokens.tokenHash, yield* hashToken(token)),
            gt(authAccessTokens.expiresAt, current),
            gt(authGrants.expiresAt, current),
          ),
        )
        .limit(1)
        .pipe(Effect.orDie);
      const row = rows[0];
      if (row === undefined)
        return yield* bearerChallenge(401, "invalid_token", {
          description: "The access token is invalid, expired, or revoked",
        });
      const scope = storedScope(row.scope);
      if (!scope.includes(requiredScope))
        return yield* bearerChallenge(403, "insufficient_scope", { scope: requiredScope });
      yield* database
        .update(authGrants)
        .set({ lastUsedAt: current })
        .where(eq(authGrants.id, row.grantId))
        .pipe(Effect.orDie);
      return { userId: row.userId, clientId: row.clientId, grantId: row.grantId, scope };
    });

  const isAccessToken = (token: string) => token.startsWith(accessTokenPrefix);

  const register = Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter;

    const route = <R>(
      method: "GET" | "POST" | "PUT" | "DELETE",
      path: HttpRouter.PathInput,
      handler: (
        request: HttpServerRequest.HttpServerRequest,
      ) => Effect.Effect<HttpServerResponse.HttpServerResponse, OAuthReject, R>,
    ) => router.add(method, path, (request) => handle(handler(request)));
    const preflight = (path: HttpRouter.PathInput) =>
      router.add("OPTIONS", path, () =>
        Effect.succeed(HttpServerResponse.empty({ status: 204, headers: cors })),
      );

    // ---- Discovery (RFC 8414, RFC 7517) ----

    yield* preflight("/.well-known/oauth-authorization-server");
    yield* route("GET", "/.well-known/oauth-authorization-server", (request) =>
      Effect.sync(() => {
        const issuer = options.issuer(request);
        return HttpServerResponse.jsonUnsafe(
          {
            issuer,
            device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
            token_endpoint: `${issuer}/oauth/token`,
            revocation_endpoint: `${issuer}/oauth/revoke`,
            registration_endpoint: `${issuer}/oauth/register`,
            userinfo_endpoint: `${issuer}/oauth/userinfo`,
            jwks_uri: `${issuer}/oauth/jwks`,
            scopes_supported: scopes,
            response_types_supported: [],
            grant_types_supported: [deviceCodeGrantType, "refresh_token"],
            token_endpoint_auth_methods_supported: [
              "client_secret_basic",
              "client_secret_post",
              "none",
            ],
            revocation_endpoint_auth_methods_supported: [
              "client_secret_basic",
              "client_secret_post",
              "none",
            ],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            claims_supported: ["iss", "sub", "aud", "exp", "iat", "email", "email_verified"],
          },
          { headers: { "cache-control": "public, max-age=3600" } },
        );
      }),
    );

    yield* preflight("/oauth/jwks");
    yield* route("GET", "/oauth/jwks", () =>
      Effect.gen(function* () {
        const key = yield* options.signingKey;
        return HttpServerResponse.jsonUnsafe(
          { keys: key.publicJwk === undefined ? [] : [key.publicJwk] },
          { headers: { "cache-control": "public, max-age=3600" } },
        );
      }),
    );

    // ---- Dynamic client registration (RFC 7591, RFC 7592) ----

    yield* preflight("/oauth/register");
    yield* route("POST", "/oauth/register", (request) =>
      Effect.gen(function* () {
        const ip = requestIp(request);
        if (ip !== null && (yield* rateLimited(`register:${ip}`, 20, 60 * 60)))
          return yield* oauthError(
            "temporarily_unavailable",
            "Too many registrations; try again later",
            429,
            { "retry-after": "3600" },
          );
        const metadata = yield* validateMetadata(yield* readJsonObject(request));
        yield* cleanup;
        const clientId = `mgc_${randomHex()}`;
        const clientSecret = randomToken("mgcs_");
        const registrationToken = randomToken("mgrat_");
        const rows = yield* database
          .insert(authClients)
          .values({
            id: clientId,
            secretHash: yield* hashToken(clientSecret),
            registrationTokenHash: yield* hashToken(registrationToken),
            name: metadata.name,
            softwareId: metadata.softwareId,
            softwareVersion: metadata.softwareVersion,
            tokenEndpointAuthMethod: metadata.tokenEndpointAuthMethod,
            scope: formatScope(metadata.scope),
            createdAt: now(),
            lastUsedAt: now(),
            createdIp: ip,
          })
          .returning()
          .pipe(Effect.orDie);
        return json(
          {
            ...clientMetadata(rows[0]!, options.issuer(request)),
            client_secret: clientSecret,
            registration_access_token: registrationToken,
          },
          201,
        );
      }),
    );

    /** RFC 7592 §2: the registration access token authorizes managing one client. */
    const registeredClient = (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const clientId = (yield* HttpRouter.params).client_id ?? "";
        const token = bearerToken(request);
        if (token === undefined) return yield* bearerChallenge(401);
        if (token === null) return yield* bearerChallenge(400, "invalid_request");
        const rows = yield* database
          .select()
          .from(authClients)
          .where(eq(authClients.id, clientId))
          .limit(1)
          .pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined || !equalHashes(row.registrationTokenHash, yield* hashToken(token)))
          return yield* bearerChallenge(401, "invalid_token");
        return row;
      });

    yield* preflight("/oauth/register/:client_id");
    yield* route("GET", "/oauth/register/:client_id", (request) =>
      registeredClient(request).pipe(
        Effect.map((row) => json(clientMetadata(row, options.issuer(request)))),
      ),
    );
    yield* route("PUT", "/oauth/register/:client_id", (request) =>
      Effect.gen(function* () {
        const row = yield* registeredClient(request);
        const body = yield* readJsonObject(request);
        if (body.client_id !== row.id)
          return yield* invalidRequest("client_id must match the client being updated");
        for (const field of [
          "registration_access_token",
          "registration_client_uri",
          "client_secret_expires_at",
          "client_id_issued_at",
        ])
          if (field in body) return yield* invalidRequest(`${field} must not be sent`);
        if (body.client_secret !== undefined) {
          if (
            typeof body.client_secret !== "string" ||
            !equalHashes(row.secretHash, yield* hashToken(body.client_secret))
          )
            return yield* invalidRequest("client_secret does not match");
        }
        const metadata = yield* validateMetadata(body);
        const updated = yield* database
          .update(authClients)
          .set({
            name: metadata.name,
            softwareId: metadata.softwareId,
            softwareVersion: metadata.softwareVersion,
            tokenEndpointAuthMethod: metadata.tokenEndpointAuthMethod,
            scope: formatScope(metadata.scope),
            lastUsedAt: now(),
          })
          .where(eq(authClients.id, row.id))
          .returning()
          .pipe(Effect.orDie);
        return json(clientMetadata(updated[0]!, options.issuer(request)));
      }),
    );
    yield* route("DELETE", "/oauth/register/:client_id", (request) =>
      Effect.gen(function* () {
        const row = yield* registeredClient(request);
        yield* deleteClient(row.id);
        return HttpServerResponse.empty({ status: 204, headers: noStore });
      }),
    );

    // ---- Device authorization (RFC 8628 §3.1) ----

    yield* preflight("/oauth/device_authorization");
    yield* route("POST", "/oauth/device_authorization", (request) =>
      Effect.gen(function* () {
        const form = yield* readForm(request);
        const client = yield* authenticateClient(request, form);
        const requested = form.has("scope")
          ? parseScope(form.get("scope")!)
          : client.verified
            ? (["openid", "email"] satisfies ReadonlyArray<Scope>)
            : client.scope;
        if (requested === undefined || requested.length === 0)
          return yield* oauthError("invalid_scope", `Supported scopes: ${formatScope(scopes)}`);
        if (!isSubset(requested, client.scope))
          return yield* oauthError("invalid_scope", "The client may not request this scope");

        const deviceCode = randomToken();
        const deviceCodeHash = yield* hashToken(deviceCode);
        const current = now();
        let userCode: string | undefined;
        for (let attempt = 0; attempt < 5 && userCode === undefined; attempt++) {
          const candidate = generateUserCode();
          const inserted = yield* database
            .insert(authDeviceAuthorizations)
            .values({
              deviceCodeHash,
              userCode: candidate,
              clientId: client.id,
              scope: formatScope(requested),
              status: "pending",
              intervalSeconds: pollIntervalSeconds,
              expiresAt: new Date(current.getTime() + deviceCodeLifetimeSeconds * 1000),
              createdAt: current,
              requestIp: requestIp(request),
              requestCountry: request.headers["cf-ipcountry"] ?? null,
            })
            .onConflictDoNothing({ target: authDeviceAuthorizations.userCode })
            .returning({ userCode: authDeviceAuthorizations.userCode })
            .pipe(Effect.orDie);
          if (inserted.length > 0) userCode = candidate;
        }
        if (userCode === undefined) return yield* Effect.die("Could not allocate a user code");

        const verificationUri = `${options.issuer(request)}/device`;
        const formatted = formatUserCode(userCode);
        return json({
          device_code: deviceCode,
          user_code: formatted,
          verification_uri: verificationUri,
          verification_uri_complete: `${verificationUri}?user_code=${formatted}`,
          expires_in: deviceCodeLifetimeSeconds,
          interval: pollIntervalSeconds,
        });
      }),
    );

    // ---- Token endpoint (RFC 6749 §3.2, RFC 8628 §3.4, RFC 6749 §6) ----

    const deviceCodeGrant = (issuer: string, client: Client, form: ReadonlyMap<string, string>) =>
      Effect.gen(function* () {
        const deviceCode = form.get("device_code");
        if (deviceCode === undefined) return yield* invalidRequest("device_code is required");
        const deviceCodeHash = yield* hashToken(deviceCode);
        const rows = yield* database
          .select()
          .from(authDeviceAuthorizations)
          .where(eq(authDeviceAuthorizations.deviceCodeHash, deviceCodeHash))
          .limit(1)
          .pipe(Effect.orDie);
        const authorization = rows[0];
        if (authorization === undefined || authorization.clientId !== client.id)
          return yield* oauthError("invalid_grant", "Unknown or already used device code");
        const current = now();
        const remove = database
          .delete(authDeviceAuthorizations)
          .where(eq(authDeviceAuthorizations.deviceCodeHash, deviceCodeHash))
          .pipe(Effect.orDie);
        if (authorization.expiresAt <= current) {
          yield* remove;
          return yield* oauthError("expired_token", "The device code has expired");
        }
        if (authorization.status === "denied") {
          yield* remove;
          return yield* oauthError("access_denied", "The user denied the request");
        }
        if (authorization.status === "pending") {
          const tooSoon =
            authorization.lastPolledAt !== null &&
            current.getTime() - authorization.lastPolledAt.getTime() <
              authorization.intervalSeconds * 1000;
          yield* database
            .update(authDeviceAuthorizations)
            .set({
              lastPolledAt: current,
              ...(tooSoon ? { intervalSeconds: authorization.intervalSeconds + 5 } : {}),
            })
            .where(eq(authDeviceAuthorizations.deviceCodeHash, deviceCodeHash))
            .pipe(Effect.orDie);
          return yield* tooSoon
            ? oauthError("slow_down", "Polling too frequently; increase the interval by 5 seconds")
            : oauthError("authorization_pending", "The user has not approved the request yet");
        }

        const scope = storedScope(authorization.scope);
        const response = yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              // Deleting the approved row is the single-use gate for concurrent polls.
              const claimed = yield* transaction
                .delete(authDeviceAuthorizations)
                .where(
                  and(
                    eq(authDeviceAuthorizations.deviceCodeHash, deviceCodeHash),
                    eq(authDeviceAuthorizations.status, "approved"),
                  ),
                )
                .returning({ userId: authDeviceAuthorizations.userId });
              const userId = claimed[0]?.userId;
              if (userId === undefined || userId === null) return undefined;
              const grant = {
                id: randomHex(),
                clientId: client.id,
                userId,
                scope: formatScope(scope),
                createdAt: current,
                lastUsedAt: current,
                expiresAt: new Date(
                  current.getTime() +
                    (scope.includes("offline_access")
                      ? refreshTokenLifetimeSeconds
                      : accessTokenLifetimeSeconds) *
                      1000,
                ),
              };
              yield* transaction.insert(authGrants).values(grant);
              return yield* issueTokens(transaction, issuer, grant, scope, scope);
            }),
          )
          .pipe(Effect.orDie);
        if (response === undefined)
          return yield* oauthError("invalid_grant", "Unknown or already used device code");
        return json(response);
      });

    const refreshTokenGrant = (issuer: string, client: Client, form: ReadonlyMap<string, string>) =>
      Effect.gen(function* () {
        const refreshToken = form.get("refresh_token");
        if (refreshToken === undefined) return yield* invalidRequest("refresh_token is required");
        const tokenHash = yield* hashToken(refreshToken);
        const current = now();
        const rows = yield* database
          .select({
            rotatedAt: authRefreshTokens.rotatedAt,
            expiresAt: authRefreshTokens.expiresAt,
            grant: authGrants,
          })
          .from(authRefreshTokens)
          .innerJoin(authGrants, eq(authGrants.id, authRefreshTokens.grantId))
          .where(eq(authRefreshTokens.tokenHash, tokenHash))
          .limit(1)
          .pipe(Effect.orDie);
        const row = rows[0];
        const invalid = oauthError("invalid_grant", "The refresh token is invalid or revoked");
        if (row === undefined || row.grant.clientId !== client.id) return yield* invalid;
        if (row.rotatedAt !== null) {
          // RFC 9700 §4.14.2: a replayed refresh token means it leaked; end the whole grant.
          yield* database
            .delete(authGrants)
            .where(eq(authGrants.id, row.grant.id))
            .pipe(Effect.orDie);
          return yield* invalid;
        }
        if (row.expiresAt <= current || row.grant.expiresAt <= current) return yield* invalid;

        const grantScope = storedScope(row.grant.scope);
        let accessScope = grantScope;
        if (form.has("scope")) {
          const requested = parseScope(form.get("scope")!);
          if (requested === undefined || !isSubset(requested, grantScope))
            return yield* oauthError("invalid_scope", "A refresh may not widen the granted scope");
          accessScope = requested;
        }

        const response = yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const rotated = yield* transaction
                .update(authRefreshTokens)
                .set({ rotatedAt: current })
                .where(
                  and(
                    eq(authRefreshTokens.tokenHash, tokenHash),
                    isNull(authRefreshTokens.rotatedAt),
                  ),
                )
                .returning({ grantId: authRefreshTokens.grantId });
              if (rotated.length === 0) return undefined;
              yield* transaction
                .update(authGrants)
                .set({
                  lastUsedAt: current,
                  expiresAt: new Date(current.getTime() + refreshTokenLifetimeSeconds * 1000),
                })
                .where(eq(authGrants.id, row.grant.id));
              return yield* issueTokens(transaction, issuer, row.grant, grantScope, accessScope);
            }),
          )
          .pipe(Effect.orDie);
        if (response === undefined) return yield* invalid;
        return json(response);
      });

    yield* preflight("/oauth/token");
    yield* route("POST", "/oauth/token", (request) =>
      Effect.gen(function* () {
        const form = yield* readForm(request);
        const grantType = form.get("grant_type");
        if (grantType === undefined) return yield* invalidRequest("grant_type is required");
        if (grantType !== deviceCodeGrantType && grantType !== "refresh_token")
          return yield* oauthError("unsupported_grant_type");
        const client = yield* authenticateClient(request, form);
        const issuer = options.issuer(request);
        return yield* grantType === deviceCodeGrantType
          ? deviceCodeGrant(issuer, client, form)
          : refreshTokenGrant(issuer, client, form);
      }),
    );

    // ---- Revocation (RFC 7009) ----

    yield* preflight("/oauth/revoke");
    yield* route("POST", "/oauth/revoke", (request) =>
      Effect.gen(function* () {
        const form = yield* readForm(request);
        const client = yield* authenticateClient(request, form);
        const token = form.get("token");
        if (token === undefined) return yield* invalidRequest("token is required");
        const tokenHash = yield* hashToken(token);
        const ok = HttpServerResponse.empty({ status: 200, headers: noStore });

        const access = yield* database
          .select({ clientId: authGrants.clientId })
          .from(authAccessTokens)
          .innerJoin(authGrants, eq(authGrants.id, authAccessTokens.grantId))
          .where(eq(authAccessTokens.tokenHash, tokenHash))
          .limit(1)
          .pipe(Effect.orDie);
        if (access[0] !== undefined) {
          if (access[0].clientId !== client.id)
            return yield* invalidRequest("The token was not issued to this client");
          yield* database
            .delete(authAccessTokens)
            .where(eq(authAccessTokens.tokenHash, tokenHash))
            .pipe(Effect.orDie);
          return ok;
        }

        const refresh = yield* database
          .select({ grantId: authGrants.id, clientId: authGrants.clientId })
          .from(authRefreshTokens)
          .innerJoin(authGrants, eq(authGrants.id, authRefreshTokens.grantId))
          .where(eq(authRefreshTokens.tokenHash, tokenHash))
          .limit(1)
          .pipe(Effect.orDie);
        if (refresh[0] !== undefined) {
          if (refresh[0].clientId !== client.id)
            return yield* invalidRequest("The token was not issued to this client");
          // Revoking a refresh token ends the grant and every token issued from it.
          yield* database
            .delete(authGrants)
            .where(eq(authGrants.id, refresh[0].grantId))
            .pipe(Effect.orDie);
        }
        // Unknown tokens are not an error (RFC 7009 §2.2).
        return ok;
      }),
    );

    // ---- UserInfo (OpenID Connect Core §5.3) ----

    const userInfo = (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const authorization = yield* authenticateBearer(request, "openid");
        const users = yield* database
          .select({ id: accountUsers.id, email: accountUsers.email })
          .from(accountUsers)
          .where(eq(accountUsers.id, authorization.userId))
          .limit(1)
          .pipe(Effect.orDie);
        const user = users[0];
        if (user === undefined) return yield* bearerChallenge(401, "invalid_token");
        return json({
          sub: user.id,
          ...(authorization.scope.includes("email")
            ? { email: user.email, email_verified: false }
            : {}),
        });
      });
    yield* preflight("/oauth/userinfo");
    yield* route("GET", "/oauth/userinfo", userInfo);
    yield* route("POST", "/oauth/userinfo", userInfo);
  });

  // ---- The website's own endpoints for the verification and account pages ----

  /** A pending device authorization, as shown on the verification page. */
  const findPending = (code: string) =>
    Effect.gen(function* () {
      const rows = yield* database
        .select()
        .from(authDeviceAuthorizations)
        .where(
          and(
            eq(authDeviceAuthorizations.userCode, code),
            eq(authDeviceAuthorizations.status, "pending"),
            gt(authDeviceAuthorizations.expiresAt, now()),
          ),
        )
        .limit(1)
        .pipe(Effect.orDie);
      return rows[0];
    });

  const describeClient = (clientId: string) =>
    Effect.gen(function* () {
      const builtIn = Object.hasOwn(publicClients, clientId) ? publicClients[clientId] : undefined;
      if (builtIn !== undefined) return { id: clientId, name: builtIn.name, verified: true };
      const rows = yield* database
        .select({ name: authClients.name })
        .from(authClients)
        .where(eq(authClients.id, clientId))
        .limit(1)
        .pipe(Effect.orDie);
      const row = rows[0];
      return row === undefined ? undefined : { id: clientId, name: row.name, verified: false };
    });

  const device = {
    lookup: (userId: string, input: string) =>
      Effect.gen(function* () {
        if (yield* rateLimited(`device-lookup:${userId}`, 20, 10 * 60))
          return { error: "rate_limited" as const };
        const code = normalizeUserCode(input);
        const authorization = code === undefined ? undefined : yield* findPending(code);
        if (authorization === undefined) return { error: "not_found" as const };
        const client = yield* describeClient(authorization.clientId);
        if (client === undefined) return { error: "not_found" as const };
        return {
          userCode: formatUserCode(authorization.userCode),
          client,
          scope: storedScope(authorization.scope),
          requestedAt: authorization.createdAt.getTime(),
          expiresAt: authorization.expiresAt.getTime(),
          requestIp: authorization.requestIp,
          requestCountry: authorization.requestCountry,
        };
      }),
    decide: (userId: string, input: string, decision: "approved" | "denied") =>
      Effect.gen(function* () {
        const code = normalizeUserCode(input);
        if (code === undefined) return false;
        const updated = yield* database
          .update(authDeviceAuthorizations)
          .set({ status: decision, userId })
          .where(
            and(
              eq(authDeviceAuthorizations.userCode, code),
              eq(authDeviceAuthorizations.status, "pending"),
              gt(authDeviceAuthorizations.expiresAt, now()),
            ),
          )
          .returning({ userCode: authDeviceAuthorizations.userCode })
          .pipe(Effect.orDie);
        return updated.length > 0;
      }),
  };

  const grants = {
    /** The user's grants that can read credentials, newest first. */
    list: (userId: string) =>
      Effect.gen(function* () {
        const rows = yield* database
          .select()
          .from(authGrants)
          .where(and(eq(authGrants.userId, userId), gt(authGrants.expiresAt, now())))
          .pipe(Effect.orDie);
        const result = [];
        for (const row of rows) {
          const scope = storedScope(row.scope);
          if (!scope.includes("credentials")) continue;
          const client = yield* describeClient(row.clientId);
          if (client === undefined) continue;
          result.push({
            id: row.id,
            client,
            scope,
            createdAt: row.createdAt.getTime(),
            lastUsedAt: row.lastUsedAt.getTime(),
          });
        }
        return result.sort((a, b) => b.createdAt - a.createdAt);
      }),
    revoke: (userId: string, grantId: string) =>
      database
        .delete(authGrants)
        .where(and(eq(authGrants.id, grantId), eq(authGrants.userId, userId)))
        .pipe(Effect.orDie, Effect.asVoid),
  };

  return { register, authenticateBearer, isAccessToken, device, grants };
};

const randomHex = () => crypto.randomUUID().replaceAll("-", "");

export * as OAuthServer from "./OAuthServer.ts";
