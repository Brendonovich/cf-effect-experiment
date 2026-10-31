/**
 * Restricts preview deployments to allowed macrograph.app accounts. A preview sends visitors to
 * production's `/auth/preview`, which signs a short-lived grant for the signed-in account with the
 * production OAuth signing key and redirects back. The preview verifies it against production's
 * JWKS and keeps its own cookie.
 */
import { Effect } from "effect";
import { type HttpServerRequest, HttpServerResponse } from "effect/http";

import * as Jwt from "./Jwt.ts";

/** The website that signs grants. Previews trust only its keys. */
export const authOrigin = "https://macrograph.app";

export const startPath = "/auth/preview";
export const callbackPath = "/auth/preview/callback";
export const cookieName = "macrograph_preview";

const grantType = "preview-grant+jwt";
const grantLifetimeSeconds = 60;
const cookieLifetimeSeconds = 7 * 24 * 60 * 60;

/** Origins grants may be sent to: preview WebsiteWorkers on their workers.dev URLs. */
export const isPreviewOrigin = (origin: string) => {
  if (!URL.canParse(origin)) return false;
  const url = new URL(origin);
  return (
    url.origin === origin &&
    url.protocol === "https:" &&
    /^macrograph-websiteworker-pr\d+-[a-z0-9]+\.brendonovich\.workers\.dev$/.test(url.hostname)
  );
};

/** A same-origin path to return to, or `/`. */
export const safeNext = (next: string | null) =>
  next !== null && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/";

/** Where a preview sends visitors without a valid cookie. */
export const startUrl = (previewOrigin: string, next: string) =>
  `${authOrigin}${startPath}?${new URLSearchParams({ origin: previewOrigin, next })}`;

/** Signs a grant for `userId` that only `previewOrigin` accepts, and returns its callback URL. */
export const grant = (options: {
  readonly signingKey: Jwt.SigningKey;
  readonly issuer: string;
  readonly previewOrigin: string;
  readonly userId: string;
  readonly next: string;
}) =>
  Jwt.sign(
    options.signingKey,
    {
      iss: options.issuer,
      aud: options.previewOrigin,
      sub: options.userId,
      exp: Math.floor(Date.now() / 1000) + grantLifetimeSeconds,
    },
    { typ: grantType },
  ).pipe(
    Effect.map(
      (token) =>
        `${options.previewOrigin}${callbackPath}?${new URLSearchParams({ token, next: options.next })}`,
    ),
  );

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const tokenType = (token: string) => {
  try {
    const header: unknown = JSON.parse(
      new TextDecoder().decode(Jwt.base64UrlDecode(token.split(".")[0] ?? "")),
    );
    return isRecord(header) ? header.typ : undefined;
  } catch {
    return undefined;
  }
};

export interface GateOptions {
  /** Account IDs allowed in. Empty lets nobody in. */
  readonly allowedUsers: ReadonlySet<string>;
  /** HMAC key for the preview's own cookie. */
  readonly cookieKey: Effect.Effect<Jwt.SigningKey>;
  readonly fetch?: typeof fetch;
}

/**
 * Returns a gate that answers requests from visitors who aren't allowed in, and `undefined` for
 * those who are. `url` must be the request's real URL, never forwarded headers.
 */
export const makeGate = (options: GateOptions) => {
  const fetchJwks = Effect.tryPromise(async () => {
    const response = await (options.fetch ?? fetch)(`${authOrigin}/oauth/jwks`);
    if (!response.ok) throw new Error(`JWKS request failed with ${response.status}`);
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error("Malformed JWKS");
    return body.keys.filter(
      (key): key is { readonly n: string; readonly e: string } =>
        isRecord(key) && typeof key.n === "string" && typeof key.e === "string",
    );
  });

  /** The allowed account a production grant was issued to for `origin`. */
  const verifyGrant = (token: string, origin: string) =>
    Effect.gen(function* () {
      if (tokenType(token) !== grantType) return undefined;
      const keys = yield* fetchJwks;
      for (const jwk of keys) {
        const claims = yield* Jwt.verify(yield* Jwt.rsaPublicKey(jwk), token);
        if (claims === undefined) continue;
        return claims.iss === authOrigin &&
          claims.aud === origin &&
          typeof claims.exp === "number" &&
          typeof claims.sub === "string" &&
          options.allowedUsers.has(claims.sub)
          ? claims.sub
          : undefined;
      }
      return undefined;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Preview grant verification failed", cause).pipe(Effect.as(undefined)),
      ),
    );

  const cookieUser = (value: string | undefined) =>
    Effect.gen(function* () {
      if (value === undefined) return undefined;
      const claims = yield* Jwt.verify(yield* options.cookieKey, value);
      return claims !== undefined &&
        claims.purpose === "preview" &&
        typeof claims.sub === "string" &&
        options.allowedUsers.has(claims.sub)
        ? claims.sub
        : undefined;
    });

  return (request: HttpServerRequest.HttpServerRequest, url: URL) =>
    Effect.gen(function* (): Effect.fn.Return<HttpServerResponse.HttpServerResponse | undefined> {
      if (url.pathname === callbackPath) {
        const token = url.searchParams.get("token");
        const userId = token === null ? undefined : yield* verifyGrant(token, url.origin);
        if (userId === undefined) return HttpServerResponse.text("Forbidden", { status: 403 });
        const cookie = yield* Jwt.sign(yield* options.cookieKey, {
          purpose: "preview",
          sub: userId,
          exp: Math.floor(Date.now() / 1000) + cookieLifetimeSeconds,
        });
        return HttpServerResponse.redirect(safeNext(url.searchParams.get("next"))).pipe(
          HttpServerResponse.setCookieUnsafe(cookieName, cookie, {
            path: "/",
            sameSite: "lax",
            secure: true,
            httpOnly: true,
            maxAge: `${cookieLifetimeSeconds} seconds`,
          }),
        );
      }
      if ((yield* cookieUser(request.cookies[cookieName])) !== undefined) return undefined;
      if (request.method !== "GET" && request.method !== "HEAD")
        return HttpServerResponse.text("Unauthorized", { status: 401 });
      return HttpServerResponse.redirect(startUrl(url.origin, `${url.pathname}${url.search}`));
    });
};
