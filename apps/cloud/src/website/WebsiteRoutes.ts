import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { Data, Effect, Layer } from "effect";
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http";

import type * as Analytics from "./Analytics.ts";

import { requestOrigin } from "../api/HttpOrigin.ts";
import * as OAuthProviders from "../auth/OAuthProviders.ts";
import {
  accountUsers,
  deviceCodeSessions,
  oauthApps,
  oauthCredentials,
  oauthSessions,
  type OAuthToken,
  serverRegistrationSessions,
} from "../database/AccountDatabaseSchema.ts";
import * as Database from "../database/Database.ts";
import * as Jwt from "./Jwt.ts";
import * as Password from "./Password.ts";
import * as Releases from "./Releases.ts";
import * as Session from "./Session.ts";

/** Public origins of the website, canonical first. */
const websiteOrigins = [
  "https://www.macrograph.app",
  "https://macrograph.app",
  "https://macrograph.brendonovich.dev",
];

/** The canonical Cloud origin that may approve server registrations and log out of the website. */
export const cloudOrigin = "https://cloud.macrograph.app";

const deviceCodeLifetimeMs = 10 * 60 * 1000;
const userAccessTokenLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const oauthStateLifetimeSeconds = 60 * 60;
const maxShareBytes = 10 * 1024 * 1024;

export interface ShareStore {
  readonly get: (id: string) => Effect.Effect<string | null>;
  readonly put: (id: string, value: string) => Effect.Effect<void>;
}

export interface Options {
  /** HMAC key for OAuth `state` values. */
  readonly stateKey: Effect.Effect<Jwt.SigningKey>;
  /** RSA key for the JWTs issued to registered MacroGraph servers. */
  readonly serverKey: Effect.Effect<Jwt.SigningKey | undefined>;
  /** Origin whose `/auth/proxy` is registered as each OAuth provider's redirect URI. */
  readonly authRedirectOrigin: string;
  readonly shares: ShareStore;
  readonly capture: Analytics.Capture;
  readonly fetch?: typeof fetch;
}

class Reject extends Data.TaggedError("Reject")<{
  readonly response: HttpServerResponse.HttpServerResponse;
}> {}

const reject = (status: number) =>
  Effect.fail(new Reject({ response: HttpServerResponse.empty({ status }) }));

const rejectJson = (status: number, body: unknown) =>
  Effect.fail(new Reject({ response: HttpServerResponse.jsonUnsafe(body, { status }) }));

const json = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status });

const handle = <R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, Reject, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchTag("Reject", (rejection) => Effect.succeed(rejection.response)),
    Effect.catchCause((cause) =>
      Effect.logError("Website request failed", cause).pipe(
        Effect.as(HttpServerResponse.empty({ status: 500 })),
      ),
    ),
  );

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = (request: HttpServerRequest.HttpServerRequest) =>
  request.json.pipe(
    Effect.flatMap((body) => (isRecord(body) ? Effect.succeed(body) : reject(400))),
    Effect.catchTag("HttpServerError", () => reject(400)),
  );

const isSecure = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(requestOrigin(request)).protocol === "https:";

const sameOrigin = (request: HttpServerRequest.HttpServerRequest) => {
  const origin = request.headers.origin;
  return origin !== undefined && URL.canParse(origin)
    ? new URL(origin).origin === requestOrigin(request)
    : false;
};

const requestUrl = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.url, requestOrigin(request));

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const randomHex = () => crypto.randomUUID().replaceAll("-", "");

const generateUserCode = () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const limit = 256 - (256 % alphabet.length);
  let code = "";
  while (code.length < 8)
    for (const byte of crypto.getRandomValues(new Uint8Array(16)))
      if (byte < limit && code.length < 8) code += alphabet[byte % alphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
};

const userCodePattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

const userCodeFrom = (body: Readonly<Record<string, unknown>>) =>
  typeof body.userCode === "string" && body.userCode.length <= 10 ? body.userCode : undefined;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const marshalCredential = (row: typeof oauthCredentials.$inferSelect) => ({
  provider: row.providerId,
  id: row.providerUserId,
  displayName: row.displayName,
  token: {
    access_token: row.token.access_token,
    expires_in: row.token.expires_in,
    ...(row.token.refresh_token === undefined ? {} : { refresh_token: row.token.refresh_token }),
    token_type: row.token.token_type,
    issuedAt: row.issuedAt.getTime(),
  },
});

const isLocalOrigin = (origin: URL) =>
  origin.hostname === "localhost" || origin.hostname === "127.0.0.1";

type OAuthState =
  | { readonly env: "desktop"; readonly port: number }
  | { readonly env: "web"; readonly targetOrigin: string }
  | { readonly env: "credentials"; readonly targetOrigin: string; readonly userId: string };

const parseOAuthState = (value: Readonly<Record<string, unknown>>): OAuthState | undefined => {
  if (value.env === "desktop")
    return typeof value.port === "number" &&
      Number.isInteger(value.port) &&
      value.port > 0 &&
      value.port < 65_536
      ? { env: "desktop", port: value.port }
      : undefined;
  if (typeof value.targetOrigin !== "string" || !URL.canParse(value.targetOrigin)) return undefined;
  const targetOrigin = new URL(value.targetOrigin).origin;
  if (value.env === "web") return { env: "web", targetOrigin };
  if (value.env === "credentials" && typeof value.userId === "string")
    return { env: "credentials", targetOrigin, userId: value.userId };
  return undefined;
};

const responderPage = (script: string, attributes: Readonly<Record<string, string>>) =>
  HttpServerResponse.html(
    `<!doctype html><script ${Object.entries(attributes)
      .map(([name, value]) => `data-${name}="${escapeHtml(value)}"`)
      .join(" ")}>${script}</script>`,
  );

// Posts the token to the opener for the original browser playground.
const webResponderScript = `const token = document.currentScript.getAttribute("data-token");
const targetOrigin = document.currentScript.getAttribute("data-target-origin");
window.opener.postMessage(JSON.parse(token), targetOrigin);
window.close();`;

// Hands the provider's callback parameters back to the account page, which completes the exchange.
const credentialsResponderScript = `const targetOrigin = document.currentScript.getAttribute("data-target-origin");
window.opener.postMessage(location.search, targetOrigin);
window.close();`;

export const layer = (options: Options) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const database = yield* Database.Service;
      const providers = yield* OAuthProviders.Service;
      const sessions = yield* Session.make;
      const proxyRedirectUri = `${options.authRedirectOrigin}/auth/proxy`;

      /**
       * The request's origin when it is a known website origin. OAuth callbacks and verification
       * links use this, so a spoofed forwarded host can never redirect authorization codes away.
       */
      const publicOrigin = (request: HttpServerRequest.HttpServerRequest) => {
        const origin = requestOrigin(request);
        return websiteOrigins.includes(origin) ||
          origin === options.authRedirectOrigin ||
          isLocalOrigin(new URL(origin))
          ? origin
          : websiteOrigins[0];
      };

      type AuthData =
        | { readonly source: "session"; readonly userId: string }
        | { readonly source: "userAccessToken"; readonly userId: string }
        | { readonly source: "serverJwt"; readonly userId: string; readonly oauthAppId: string };

      const verifyServerJwt = (token: string) =>
        Effect.gen(function* () {
          const key = yield* options.serverKey;
          if (key === undefined) return yield* reject(500);
          const claims = yield* Jwt.verify(key, token);
          if (
            claims === undefined ||
            typeof claims.oauthAppId !== "string" ||
            typeof claims.ownerId !== "string"
          )
            return yield* reject(400);
          return { oauthAppId: claims.oauthAppId, ownerId: claims.ownerId };
        });

      /** Mirrors the original website's API authentication. */
      const authenticate = (request: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* (): Effect.fn.Return<AuthData | undefined, Reject> {
          const authorization = request.headers.authorization;
          let sessionId: string | undefined;
          if (authorization !== undefined) {
            if (!authorization.startsWith("Bearer ")) return yield* reject(400);
            const token = authorization.slice("Bearer ".length);
            if (request.headers["client-id"] !== undefined) {
              if (token.startsWith("mgu_")) {
                const rows = yield* database
                  .select({ userId: oauthSessions.userId })
                  .from(oauthSessions)
                  .where(eq(oauthSessions.accessToken, token))
                  .limit(1)
                  .pipe(Effect.orDie);
                const row = rows[0];
                return row === undefined
                  ? undefined
                  : { source: "userAccessToken", userId: row.userId };
              }
              const jwt = yield* verifyServerJwt(token);
              return { source: "serverJwt", userId: jwt.ownerId, oauthAppId: jwt.oauthAppId };
            }
            // The desktop app sends its website session ID as a bearer token.
            sessionId = token;
          } else {
            sessionId = request.cookies[Session.cookieName];
            if (sessionId === undefined) return undefined;
            if (request.method !== "GET" && !sameOrigin(request)) return yield* reject(400);
          }
          const validated = yield* sessions.validate(sessionId);
          return validated === undefined
            ? undefined
            : { source: "session", userId: validated.user.id };
        });

      const requireAuthentication = (request: HttpServerRequest.HttpServerRequest) =>
        authenticate(request).pipe(
          Effect.flatMap((auth) => (auth === undefined ? reject(403) : Effect.succeed(auth))),
        );

      /** Authenticates the website's own cookie session, rejecting cross-origin writes. */
      const websiteSession = (request: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* () {
          if (request.method !== "GET" && !sameOrigin(request)) return yield* reject(403);
          const sessionId = request.cookies[Session.cookieName];
          if (sessionId === undefined) return yield* reject(401);
          const validated = yield* sessions.validate(sessionId);
          if (validated === undefined) return yield* reject(401);
          return validated;
        });

      const withRefreshedCookie = (
        request: HttpServerRequest.HttpServerRequest,
        validated: Session.Validated,
        response: HttpServerResponse.HttpServerResponse,
      ) =>
        validated.session.fresh
          ? Session.refreshCookie(validated.session.id, isSecure(request))(response)
          : response;

      const providerFor = (providerId: string | undefined) => {
        const provider = providerId === undefined ? undefined : providers.get(providerId);
        return provider === undefined ? reject(400) : Effect.succeed(provider);
      };

      const signOAuthState = (provider: string, callbackOrigin: string, state: OAuthState) =>
        Effect.gen(function* () {
          const key = yield* options.stateKey;
          return yield* Jwt.sign(key, {
            ...state,
            provider,
            redirect_uri: `${callbackOrigin}/auth/${provider}/callback`,
            exp: Math.floor(Date.now() / 1000) + oauthStateLifetimeSeconds,
          });
        });

      const verifyOAuthState = (value: string | null) =>
        Effect.gen(function* () {
          if (value === null) return yield* reject(400);
          const claims = yield* Jwt.verify(yield* options.stateKey, value);
          if (
            claims === undefined ||
            typeof claims.provider !== "string" ||
            typeof claims.redirect_uri !== "string"
          )
            return yield* reject(400);
          const state = parseOAuthState(claims);
          if (state === undefined) return yield* reject(400);
          return { ...state, provider: claims.provider, redirectUri: claims.redirect_uri };
        });

      const exchangeCode = (provider: OAuthProviders.Provider, code: string | null) =>
        code === null
          ? reject(400)
          : providers.exchange(provider, code, proxyRedirectUri).pipe(
              Effect.map(
                (token): OAuthToken => ({
                  access_token: token.access_token,
                  expires_in: token.expires_in,
                  ...(token.refresh_token === undefined
                    ? {}
                    : { refresh_token: token.refresh_token }),
                  token_type: token.token_type,
                  ...(token.scope === undefined ? {} : { scope: token.scope }),
                }),
              ),
              Effect.catchTag("OAuthProviderError", () => reject(400)),
            );

      const authorizationUrl = (provider: OAuthProviders.Provider, state: string) =>
        providers.authorizeUrl(provider, proxyRedirectUri, state);

      // ---- Original public API, used by desktop, servers, and the old playground ----

      yield* router.add("GET", "/api/user", (request) =>
        handle(
          Effect.gen(function* () {
            const auth = yield* authenticate(request);
            if (auth === undefined) return json(null);
            const rows = yield* database
              .select({ id: accountUsers.id, email: accountUsers.email })
              .from(accountUsers)
              .where(eq(accountUsers.id, auth.userId))
              .limit(1)
              .pipe(Effect.orDie);
            return json(rows[0] ?? null);
          }),
        ),
      );

      yield* router.add("GET", "/api/credentials", (request) =>
        handle(
          Effect.gen(function* () {
            const auth = yield* requireAuthentication(request);
            if (auth.source === "userAccessToken") return yield* reject(401);
            const rows = yield* database
              .select()
              .from(oauthCredentials)
              .where(eq(oauthCredentials.userId, auth.userId))
              .pipe(Effect.orDie);
            return json(rows.map(marshalCredential));
          }),
        ),
      );

      yield* router.add("POST", "/api/credentials/:providerId/:providerUserId/refresh", (request) =>
        handle(
          Effect.gen(function* () {
            const params = yield* HttpRouter.params;
            const provider = yield* providerFor(params.providerId);
            const providerUserId = params.providerUserId ?? "";
            const auth = yield* requireAuthentication(request);
            if (auth.source === "userAccessToken") return yield* reject(401);
            const where = and(
              eq(oauthCredentials.providerId, provider.id),
              eq(oauthCredentials.userId, auth.userId),
              eq(oauthCredentials.providerUserId, providerUserId),
            );
            const rows = yield* database
              .select()
              .from(oauthCredentials)
              .where(where)
              .limit(1)
              .pipe(Effect.orDie);
            const row = rows[0];
            if (row === undefined) return yield* reject(404);
            const refreshToken = row.token.refresh_token;
            if (refreshToken === undefined) return json(marshalCredential(row));
            const token = yield* providers.refresh(provider, refreshToken).pipe(Effect.orDie);
            if (token === undefined) return json(marshalCredential(row));
            const issuedAt = new Date();
            yield* database
              .update(oauthCredentials)
              .set({ token, issuedAt })
              .where(where)
              .pipe(Effect.orDie);
            yield* options.capture(auth.userId, {
              event: "credential refreshed",
              providerId: provider.id,
              providerUserId,
            });
            return json(marshalCredential({ ...row, token, issuedAt }));
          }),
        ),
      );

      yield* router.add("POST", "/api/login/device/code", (request) =>
        handle(
          Effect.gen(function* () {
            const auth = yield* requireAuthentication(request);
            if (auth.source !== "serverJwt") return yield* reject(401);
            const deviceCode = randomHex();
            const userCode = generateUserCode();
            yield* database
              .insert(deviceCodeSessions)
              .values({ appId: auth.oauthAppId, userCode, deviceCode })
              .pipe(Effect.orDie);
            const verificationUri = `${publicOrigin(request)}/login/device`;
            return json({
              user_code: userCode,
              device_code: deviceCode,
              expires_in: 15 * 60,
              verification_uri: verificationUri,
              verification_uri_complete: `${verificationUri}?userCode=${encodeURIComponent(userCode)}`,
            });
          }),
        ),
      );

      yield* router.add("POST", "/api/login/oauth/access_token", (request) =>
        handle(
          Effect.gen(function* () {
            const params = requestUrl(request).searchParams;
            const deviceCode = params.get("device_code");
            if (
              deviceCode === null ||
              params.get("grant_type") !== "urn:ietf:params:oauth:grant-type:device_code"
            )
              return yield* rejectJson(400, { _tag: "HttpApiDecodeError" });
            const deviceFlowError = (code: string) =>
              rejectJson(400, { code, _tag: "DeviceFlowError" });
            const rows = yield* database
              .select()
              .from(deviceCodeSessions)
              .where(eq(deviceCodeSessions.deviceCode, deviceCode))
              .limit(1)
              .pipe(Effect.orDie);
            const session = rows[0];
            if (session === undefined) return yield* deviceFlowError("incorrect_device_code");
            if (session.createdAt.getTime() < Date.now() - deviceCodeLifetimeMs)
              return yield* deviceFlowError("expired_token");
            if (session.userId === null) return yield* deviceFlowError("authorization_pending");
            const userId = session.userId;
            const accessToken = `mgu_${randomHex()}`;
            const refreshToken = `mgr_${randomHex()}`;
            const granted = yield* database
              .transaction((transaction) =>
                Effect.gen(function* () {
                  // Deleting the claimed session is the single-use gate for concurrent polls.
                  const claimed = yield* transaction
                    .delete(deviceCodeSessions)
                    .where(
                      and(
                        eq(deviceCodeSessions.deviceCode, deviceCode),
                        isNotNull(deviceCodeSessions.userId),
                      ),
                    )
                    .returning({ deviceCode: deviceCodeSessions.deviceCode });
                  if (claimed.length === 0) return false;
                  yield* transaction.insert(oauthSessions).values({
                    appId: session.appId,
                    userId,
                    accessToken,
                    refreshToken,
                    expires: new Date(Date.now() + userAccessTokenLifetimeMs),
                  });
                  return true;
                }),
              )
              .pipe(Effect.orDie);
            if (!granted) return yield* deviceFlowError("incorrect_device_code");
            return json({
              userId,
              access_token: accessToken,
              refresh_token: refreshToken,
              token_type: "Bearer",
            });
          }),
        ),
      );

      yield* router.add("POST", "/api/server/registration/start", (request) =>
        handle(
          Effect.gen(function* () {
            const id = randomHex();
            const userCode = generateUserCode();
            yield* database
              .insert(serverRegistrationSessions)
              .values({ id, userCode })
              .pipe(Effect.orDie);
            const verificationUri = `${publicOrigin(request)}/server-registration`;
            return json({
              id,
              userCode,
              verification_uri: verificationUri,
              verification_uri_complete: `${verificationUri}?userCode=${encodeURIComponent(userCode)}`,
            });
          }),
        ),
      );

      yield* router.add("POST", "/api/server/registration", (request) =>
        handle(
          Effect.gen(function* () {
            const body = yield* readJson(request);
            if (typeof body.id !== "string")
              return yield* rejectJson(400, { _tag: "HttpApiDecodeError" });
            const id = body.id;
            const registrationError = (code: string) =>
              rejectJson(400, { code, _tag: "ServerRegistrationError" });
            const rows = yield* database
              .select()
              .from(serverRegistrationSessions)
              .where(eq(serverRegistrationSessions.id, id))
              .limit(1)
              .pipe(Effect.orDie);
            const session = rows[0];
            if (session === undefined) return yield* registrationError("incorrect_id");
            if (session.userId === null) return yield* registrationError("authorization_pending");
            const ownerId = session.userId;
            const key = yield* options.serverKey;
            if (key === undefined) return yield* reject(500);
            const registered = yield* database
              .transaction((transaction) =>
                Effect.gen(function* () {
                  const claimed = yield* transaction
                    .delete(serverRegistrationSessions)
                    .where(
                      and(
                        eq(serverRegistrationSessions.id, id),
                        isNotNull(serverRegistrationSessions.userId),
                      ),
                    )
                    .returning({ id: serverRegistrationSessions.id });
                  if (claimed.length === 0) return false;
                  yield* transaction.insert(oauthApps).values({ type: "server", id, ownerId });
                  return true;
                }),
              )
              .pipe(Effect.orDie);
            if (!registered) return yield* registrationError("incorrect_id");
            const token = yield* Jwt.sign(key, {
              oauthAppId: id,
              ownerId,
              iat: Math.floor(Date.now() / 1000),
            });
            return json({ token });
          }),
        ),
      );

      yield* router.add("GET", "/api/server/registration", (request) =>
        handle(
          Effect.gen(function* () {
            const auth = yield* requireAuthentication(request);
            if (auth.source !== "serverJwt") return yield* reject(401);
            const rows = yield* database
              .select({ ownerId: oauthApps.ownerId })
              .from(oauthApps)
              .where(and(eq(oauthApps.id, auth.oauthAppId), eq(oauthApps.type, "server")))
              .limit(1)
              .pipe(Effect.orDie);
            const registration = rows[0];
            if (registration === undefined) return yield* reject(404);
            return json({ ownerId: registration.ownerId });
          }),
        ),
      );

      yield* router.add("GET", "/api/desktop/download/latest/:target", () =>
        handle(
          Effect.gen(function* () {
            const { target } = yield* HttpRouter.params;
            const url = yield* Releases.downloadUrl(target ?? "", options.fetch).pipe(Effect.orDie);
            if (url === undefined) return yield* reject(404);
            return HttpServerResponse.redirect(url, {
              headers: { "cdn-cache-control": `public, max-age=${60 * 60 * 24}` },
            });
          }),
        ),
      );

      // ---- Cross-origin session bridge for cloud.macrograph.app ----

      const cloudCors = (
        request: HttpServerRequest.HttpServerRequest,
        run: () => Effect.Effect<HttpServerResponse.HttpServerResponse, Reject>,
      ) =>
        Effect.gen(function* () {
          const allowedOrigin = request.headers.origin === cloudOrigin;
          const withHeaders = (response: HttpServerResponse.HttpServerResponse) =>
            HttpServerResponse.setHeaders(response, {
              "cache-control": "no-store",
              vary: "Origin",
              ...(allowedOrigin
                ? {
                    "access-control-allow-origin": cloudOrigin,
                    "access-control-allow-credentials": "true",
                  }
                : {}),
            });
          const response = yield* handle(
            Effect.gen(function* () {
              if (request.method !== "POST" && request.method !== "OPTIONS")
                return HttpServerResponse.empty({
                  status: 405,
                  headers: { allow: "POST, OPTIONS" },
                });
              if (!allowedOrigin) return yield* reject(403);
              if (request.method === "OPTIONS") {
                const requestedHeaders = request.headers["access-control-request-headers"];
                if (
                  request.headers["access-control-request-method"] !== "POST" ||
                  (requestedHeaders !== undefined &&
                    requestedHeaders !== "" &&
                    !requestedHeaders
                      .split(",")
                      .every((name) => name.trim().toLowerCase() === "content-type"))
                )
                  return yield* reject(403);
                return HttpServerResponse.empty({
                  status: 204,
                  headers: {
                    "access-control-allow-methods": "POST",
                    "access-control-allow-headers": "Content-Type",
                  },
                });
              }
              if (
                request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
                "application/json"
              )
                return yield* reject(400);
              return yield* run();
            }),
          );
          return withHeaders(response);
        });

      yield* router.add("*", "/api/cloud-login", (request) =>
        cloudCors(request, () =>
          Effect.gen(function* () {
            const sessionId = request.cookies[Session.cookieName];
            if (!sessionId) return yield* reject(401);
            const validated = yield* sessions.validate(sessionId);
            if (validated === undefined) return yield* reject(401);
            const body = yield* readJson(request);
            const userCode = body.userCode;
            if (typeof userCode !== "string" || !userCodePattern.test(userCode))
              return yield* reject(400);
            // Claim once, with expiry checked by the database in the same statement.
            const claimed = yield* database
              .update(serverRegistrationSessions)
              .set({ userId: validated.user.id })
              .where(
                and(
                  eq(serverRegistrationSessions.userCode, userCode),
                  isNull(serverRegistrationSessions.userId),
                  gt(serverRegistrationSessions.createdAt, sql`now() - interval '10 minutes'`),
                ),
              )
              .returning({ id: serverRegistrationSessions.id })
              .pipe(Effect.orDie);
            return withRefreshedCookie(
              request,
              validated,
              HttpServerResponse.empty({ status: claimed.length === 1 ? 204 : 409 }),
            );
          }),
        ),
      );

      yield* router.add("*", "/api/cloud-logout", (request) =>
        cloudCors(request, () =>
          Effect.gen(function* () {
            const sessionId = request.cookies[Session.cookieName];
            // Invalidate even expired sessions.
            if (sessionId) yield* sessions.invalidate(sessionId);
            return Session.clearCookies(true)(HttpServerResponse.empty({ status: 204 }));
          }),
        ),
      );

      // ---- OAuth flows for desktop, the old playground, and account credentials ----

      yield* router.add("GET", "/auth/:provider/login", (request) =>
        handle(
          Effect.gen(function* () {
            const provider = yield* providerFor((yield* HttpRouter.params).provider);
            const encoded = requestUrl(request).searchParams.get("state");
            if (encoded === null) return yield* reject(400);
            const decoded = yield* Effect.try({
              try: (): unknown => JSON.parse(atob(encoded)),
              catch: () => new Reject({ response: HttpServerResponse.empty({ status: 400 }) }),
            });
            const state = isRecord(decoded) ? parseOAuthState(decoded) : undefined;
            if (state === undefined || state.env === "credentials") return yield* reject(400);
            if (state.env === "web") {
              const origin = new URL(state.targetOrigin);
              const allowed =
                state.targetOrigin === publicOrigin(request) ||
                websiteOrigins.includes(state.targetOrigin) ||
                isLocalOrigin(origin);
              // Tokens are posted to the opener, so only MacroGraph origins may receive them.
              if (!allowed) return yield* reject(400);
            }
            const signed = yield* signOAuthState(provider.id, publicOrigin(request), state);
            return HttpServerResponse.redirect(authorizationUrl(provider, signed));
          }),
        ),
      );

      // The single redirect URI registered with providers; routes back to the originating callback.
      yield* router.add("GET", "/auth/proxy", (request) =>
        handle(
          Effect.gen(function* () {
            const url = requestUrl(request);
            const state = yield* verifyOAuthState(url.searchParams.get("state"));
            return HttpServerResponse.redirect(`${state.redirectUri}${url.search}`);
          }),
        ),
      );

      yield* router.add("GET", "/auth/:provider/callback", (request) =>
        handle(
          Effect.gen(function* () {
            const provider = yield* providerFor((yield* HttpRouter.params).provider);
            const params = requestUrl(request).searchParams;
            const state = yield* verifyOAuthState(params.get("state"));
            if (state.provider !== provider.id) return yield* reject(400);
            switch (state.env) {
              case "desktop": {
                const token = yield* exchangeCode(provider, params.get("code"));
                return HttpServerResponse.redirect(
                  `http://localhost:${state.port}?token=${btoa(JSON.stringify(token))}`,
                );
              }
              case "web": {
                const token = yield* exchangeCode(provider, params.get("code"));
                return responderPage(webResponderScript, {
                  token: JSON.stringify(token),
                  "target-origin": state.targetOrigin,
                });
              }
              case "credentials":
                return responderPage(credentialsResponderScript, {
                  "target-origin": state.targetOrigin,
                });
            }
          }),
        ),
      );

      const refreshCors = {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
        "access-control-allow-headers": "Content-Type, Authorization",
      };

      yield* router.add("OPTIONS", "/auth/:provider/refresh", () =>
        Effect.succeed(HttpServerResponse.empty({ status: 204, headers: refreshCors })),
      );

      yield* router.add("POST", "/auth/:provider/refresh", (request) =>
        handle(
          Effect.gen(function* () {
            const provider = yield* providerFor((yield* HttpRouter.params).provider);
            const body = yield* readJson(request);
            if (typeof body.refreshToken !== "string") return yield* reject(400);
            const refresh: Effect.Effect<OAuthToken | undefined, OAuthProviders.ProviderError> =
              providers.refresh(provider, body.refreshToken);
            const token = yield* refresh.pipe(Effect.catch(() => reject(400)));
            return json(token ?? null);
          }),
        ).pipe(Effect.map((response) => HttpServerResponse.setHeaders(response, refreshCors))),
      );

      // ---- JSON endpoints backing the static website ----

      yield* router.add("GET", "/api/website/session", (request) =>
        handle(
          Effect.gen(function* () {
            const sessionId = request.cookies[Session.cookieName];
            if (sessionId === undefined) return json(null);
            const validated = yield* sessions.validate(sessionId);
            if (validated === undefined)
              return Session.clearSessionCookie(isSecure(request))(json(null));
            return withRefreshedCookie(
              request,
              validated,
              json({ user: validated.user, session: { id: validated.session.id } }),
            );
          }),
        ),
      );

      const credentialsFrom = (body: Readonly<Record<string, unknown>>) =>
        typeof body.email === "string" &&
        emailPattern.test(body.email) &&
        typeof body.password === "string" &&
        body.password.length >= 8 &&
        body.password.length <= 1024
          ? { email: body.email, password: body.password }
          : undefined;

      const startSession = (request: HttpServerRequest.HttpServerRequest, userId: string) =>
        sessions
          .create(userId)
          .pipe(
            Effect.map((sessionId) =>
              Session.setCookies(sessionId, isSecure(request))(json({ success: true, userId })),
            ),
          );

      yield* router.add("POST", "/api/website/login", (request) =>
        handle(
          Effect.gen(function* () {
            if (!sameOrigin(request)) return yield* reject(403);
            const invalid = json({ success: false, error: "Invalid credentials" });
            const credentials = credentialsFrom(yield* readJson(request));
            if (credentials === undefined) return invalid;
            const users = yield* database
              .select()
              .from(accountUsers)
              .where(eq(accountUsers.email, credentials.email))
              .limit(1)
              .pipe(Effect.orDie);
            const user = users[0];
            if (user === undefined) return invalid;
            if (!(yield* Password.verify(user.hashedPassword, credentials.password)))
              return invalid;
            yield* options.capture(user.id, { event: "user logged in" });
            return yield* startSession(request, user.id);
          }),
        ),
      );

      yield* router.add("POST", "/api/website/signup", (request) =>
        handle(
          Effect.gen(function* () {
            if (!sameOrigin(request)) return yield* reject(403);
            const body = yield* readJson(request);
            const credentials = credentialsFrom(body);
            if (credentials === undefined)
              return json({
                success: false,
                error:
                  typeof body.email === "string" && emailPattern.test(body.email)
                    ? "Password must be at least 8 characters"
                    : "Invalid email",
              });
            const hashedPassword = yield* Password.hash(credentials.password);
            const userId = Session.generateId(15);
            const inserted = yield* database
              .insert(accountUsers)
              .values({ id: userId, email: credentials.email, hashedPassword })
              .onConflictDoNothing({ target: accountUsers.email })
              .returning({ id: accountUsers.id })
              .pipe(Effect.orDie);
            if (inserted.length === 0)
              return json({ success: false, error: "An account with this email already exists" });
            yield* options.capture(userId, { event: "user signed up", email: credentials.email });
            return yield* startSession(request, userId);
          }),
        ),
      );

      yield* router.add("POST", "/api/website/logout", (request) =>
        handle(
          Effect.gen(function* () {
            if (!sameOrigin(request)) return yield* reject(403);
            const sessionId = request.cookies[Session.cookieName];
            if (sessionId !== undefined) yield* sessions.invalidate(sessionId);
            return Session.clearCookies(isSecure(request))(
              HttpServerResponse.empty({ status: 204 }),
            );
          }),
        ),
      );

      yield* router.add("GET", "/api/website/credentials", (request) =>
        handle(
          Effect.gen(function* () {
            const { user } = yield* websiteSession(request);
            const rows = yield* database
              .select({
                providerId: oauthCredentials.providerId,
                providerUserId: oauthCredentials.providerUserId,
                displayName: oauthCredentials.displayName,
              })
              .from(oauthCredentials)
              .where(eq(oauthCredentials.userId, user.id))
              .pipe(Effect.orDie);
            return json(rows);
          }),
        ),
      );

      yield* router.add("GET", "/api/website/credentials/:provider/authorize", (request) =>
        handle(
          Effect.gen(function* () {
            const { user } = yield* websiteSession(request);
            const provider = yield* providerFor((yield* HttpRouter.params).provider);
            const origin = publicOrigin(request);
            const state = yield* signOAuthState(provider.id, origin, {
              env: "credentials",
              targetOrigin: origin,
              userId: user.id,
            });
            return json({ url: authorizationUrl(provider, state) });
          }),
        ),
      );

      yield* router.add("POST", "/api/website/credentials/:provider", (request) =>
        handle(
          Effect.gen(function* () {
            const { user } = yield* websiteSession(request);
            const provider = yield* providerFor((yield* HttpRouter.params).provider);
            const body = yield* readJson(request);
            if (typeof body.search !== "string") return yield* reject(400);
            const params = new URLSearchParams(body.search);
            const state = yield* verifyOAuthState(params.get("state"));
            if (
              state.env !== "credentials" ||
              state.userId !== user.id ||
              state.provider !== provider.id
            )
              return yield* reject(403);
            const token = yield* exchangeCode(provider, params.get("code"));
            const identity = yield* providers
              .user(provider, token.access_token)
              .pipe(Effect.catchTag("OAuthProviderError", () => reject(400)));
            const issuedAt = new Date();
            yield* database
              .insert(oauthCredentials)
              .values({
                providerId: provider.id,
                providerUserId: identity.id,
                userId: user.id,
                token,
                issuedAt,
                displayName: identity.displayName,
              })
              .onConflictDoUpdate({
                target: [
                  oauthCredentials.providerId,
                  oauthCredentials.userId,
                  oauthCredentials.providerUserId,
                ],
                set: { token, issuedAt, displayName: identity.displayName },
              })
              .pipe(Effect.orDie);
            yield* options.capture(user.id, {
              event: "credential connected",
              providerId: provider.id,
              providerUserId: identity.id,
            });
            return json({ user: identity });
          }),
        ),
      );

      yield* router.add("DELETE", "/api/website/credentials/:provider/:providerUserId", (request) =>
        handle(
          Effect.gen(function* () {
            const { user } = yield* websiteSession(request);
            const params = yield* HttpRouter.params;
            yield* database
              .delete(oauthCredentials)
              .where(
                and(
                  eq(oauthCredentials.providerId, params.provider ?? ""),
                  eq(oauthCredentials.providerUserId, params.providerUserId ?? ""),
                  eq(oauthCredentials.userId, user.id),
                ),
              )
              .pipe(Effect.orDie);
            return HttpServerResponse.empty({ status: 204 });
          }),
        ),
      );

      yield* router.add("GET", "/api/website/servers", (request) =>
        handle(
          Effect.gen(function* () {
            const { user } = yield* websiteSession(request);
            const rows = yield* database
              .select({ id: oauthApps.id, type: oauthApps.type })
              .from(oauthApps)
              .where(eq(oauthApps.ownerId, user.id))
              .pipe(Effect.orDie);
            return json(rows);
          }),
        ),
      );

      const userCodeRoutes = (
        path: string,
        table: typeof deviceCodeSessions | typeof serverRegistrationSessions,
      ) =>
        Effect.gen(function* () {
          yield* router.add("POST", `/api/website/${path}/verify`, (request) =>
            handle(
              Effect.gen(function* () {
                if (!sameOrigin(request)) return yield* reject(403);
                const userCode = userCodeFrom(yield* readJson(request));
                if (userCode === undefined) return json(false);
                const rows = yield* database
                  .select({ userCode: table.userCode })
                  .from(table)
                  .where(eq(table.userCode, userCode))
                  .limit(1)
                  .pipe(Effect.orDie);
                return json(rows.length > 0);
              }),
            ),
          );
          yield* router.add("POST", `/api/website/${path}/grant`, (request) =>
            handle(
              Effect.gen(function* () {
                const { user } = yield* websiteSession(request);
                const userCode = userCodeFrom(yield* readJson(request));
                if (userCode === undefined) return json({ error: "Device session not found" });
                const result = yield* database
                  .transaction((transaction) =>
                    Effect.gen(function* () {
                      const rows = yield* transaction
                        .select({ userId: table.userId })
                        .from(table)
                        .where(eq(table.userCode, userCode))
                        .limit(1);
                      const session = rows[0];
                      if (session === undefined) return { error: "Device session not found" };
                      if (session.userId !== null) return { error: "Device already claimed" };
                      yield* transaction
                        .update(table)
                        .set({ userId: user.id })
                        .where(and(eq(table.userCode, userCode), isNull(table.userId)));
                      return null;
                    }),
                  )
                  .pipe(Effect.orDie);
                return json(result);
              }),
            ),
          );
        });

      yield* userCodeRoutes("device", deviceCodeSessions);
      yield* userCodeRoutes("server-registration", serverRegistrationSessions);

      yield* router.add("POST", "/api/website/playground", (request) =>
        handle(
          Effect.gen(function* () {
            if (!sameOrigin(request)) return yield* reject(403);
            const body = yield* readJson(request);
            if (typeof body.project !== "string" || body.project.length > maxShareBytes)
              return yield* reject(400);
            const id = crypto.randomUUID();
            yield* options.shares.put(id, body.project);
            return json({ id });
          }),
        ),
      );

      yield* router.add("GET", "/api/website/playground/:id", () =>
        handle(
          Effect.gen(function* () {
            const { id } = yield* HttpRouter.params;
            if (id === undefined || !/^[0-9a-f-]{36}$/.test(id)) return json(null);
            return json(yield* options.shares.get(id));
          }),
        ),
      );
    }),
  );
