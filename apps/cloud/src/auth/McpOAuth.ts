import { and, eq, gt } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as Database from "../database/Database.ts";
import {
  oauthAccessTokens,
  oauthAuthorizationCodes,
  oauthClients,
} from "../database/DatabaseSchema.ts";
import * as McpOAuthConfig from "./McpOAuthConfig.ts";

const noStoreHeaders = { "cache-control": "no-store", pragma: "no-cache" };
const authorizationCodeLifetimeMs = 10 * 60 * 1000;
const accessTokenLifetimeSeconds = 30 * 24 * 60 * 60;

const json = (body: unknown, status = 200) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: noStoreHeaders });

const oauthError = (error: string, description: string, status = 400) =>
  json({ error, error_description: description }, status);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const randomSecret = (prefix: string) => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${prefix}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const sha256 = (value: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

const hashSecret = (value: string) =>
  sha256(value).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );

const pkceChallenge = (verifier: string) =>
  sha256(verifier).pipe(
    Effect.map((digest) =>
      btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, ""),
    ),
  );

const isLoopback = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

const validRedirectUri = (value: string) => {
  if (value.length > 2_048 || !URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.hash !== "" || url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopback(url.hostname)))
    return true;
  return !["http:", "file:", "data:", "javascript:", "about:", "blob:"].includes(url.protocol);
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

interface AuthorizationRequest {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly resource: string;
  readonly scope: string;
  readonly state: string | undefined;
}

interface AuthorizationRedirectError {
  readonly redirectUri: string;
  readonly state: string | undefined;
  readonly error: "invalid_request" | "invalid_scope" | "unsupported_response_type";
}

const redirectWith = (
  redirectUri: string,
  values: Readonly<Record<string, string | undefined>>,
) => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) url.searchParams.set(key, value);
  return HttpServerResponse.redirect(url);
};

const consentPage = (authorization: AuthorizationRequest) => {
  const hidden = Object.entries({
    client_id: authorization.clientId,
    redirect_uri: authorization.redirectUri,
    code_challenge: authorization.codeChallenge,
    code_challenge_method: "S256",
    resource: authorization.resource,
    scope: authorization.scope,
    state: authorization.state,
    response_type: "code",
  })
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("");
  return HttpServerResponse.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Authorize MacroGraph</title><style>body{color-scheme:dark;background:#111;color:#eee;font:16px system-ui;display:grid;min-height:100vh;place-items:center;margin:0}.card{max-width:28rem;padding:2rem;border:1px solid #333;border-radius:12px;background:#181818}h1{font-size:1.4rem}p{color:#bbb;line-height:1.5}.actions{display:flex;gap:.75rem;margin-top:1.5rem}button{padding:.65rem 1rem;border-radius:6px;border:1px solid #555;font:inherit;cursor:pointer}.allow{background:#eee;color:#111;border-color:#eee}</style></head>
<body><main class="card"><h1>Connect ${escapeHtml(authorization.clientName)}?</h1><p>This lets the client use MacroGraph Cloud MCP as you, including reading and changing projects you can access.</p>
<form method="post" action="/oauth/authorize">${hidden}<div class="actions"><button name="decision" value="deny">Cancel</button><button class="allow" name="decision" value="allow">Allow</button></div></form></main></body></html>`);
};

export const layer = <RateLimitError, RateLimitRequirements>(options: {
  readonly authenticateSession: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<{ readonly userId: string; readonly sessionId: string }, unknown, never>;
  readonly limitRegistration: (
    key: string,
  ) => Effect.Effect<{ readonly success: boolean }, RateLimitError, RateLimitRequirements>;
}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const database = yield* Database.Service;

      const parseAuthorization = (params: URLSearchParams) =>
        Effect.gen(function* () {
          const clientId = params.get("client_id");
          const redirectUri = params.get("redirect_uri");
          if (clientId === null || redirectUri === null) return undefined;
          const clients = yield* database
            .select({ name: oauthClients.name, redirectUris: oauthClients.redirectUris })
            .from(oauthClients)
            .where(eq(oauthClients.id, clientId))
            .limit(1)
            .pipe(Effect.orDie);
          const client = clients[0];
          if (client === undefined || !client.redirectUris.includes(redirectUri)) return undefined;

          const state = params.get("state") ?? undefined;
          if (params.get("response_type") !== "code")
            return {
              redirectUri,
              state,
              error: "unsupported_response_type",
            } satisfies AuthorizationRedirectError;
          const codeChallenge = params.get("code_challenge");
          const codeChallengeMethod = params.get("code_challenge_method");
          const requestedResource = params.get("resource");
          const requestedScope = params.get("scope") ?? McpOAuthConfig.scope;
          if (
            codeChallenge === null ||
            !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
            codeChallengeMethod !== "S256" ||
            requestedResource !== McpOAuthConfig.resource()
          )
            return {
              redirectUri,
              state,
              error: "invalid_request",
            } satisfies AuthorizationRedirectError;
          if (requestedScope !== McpOAuthConfig.scope)
            return {
              redirectUri,
              state,
              error: "invalid_scope",
            } satisfies AuthorizationRedirectError;
          return {
            clientId,
            clientName: client.name,
            redirectUri,
            codeChallenge,
            resource: requestedResource,
            scope: requestedScope,
            state,
          } satisfies AuthorizationRequest;
        });

      yield* router.add(
        "GET",
        "/.well-known/oauth-protected-resource/api/mcp",
        json({
          resource: McpOAuthConfig.resource(),
          authorization_servers: [McpOAuthConfig.issuer()],
          scopes_supported: [McpOAuthConfig.scope],
          resource_name: "MacroGraph Cloud MCP",
        }),
      );
      yield* router.add(
        "GET",
        "/.well-known/oauth-protected-resource",
        json({
          resource: McpOAuthConfig.resource(),
          authorization_servers: [McpOAuthConfig.issuer()],
          scopes_supported: [McpOAuthConfig.scope],
          resource_name: "MacroGraph Cloud MCP",
        }),
      );
      yield* router.add(
        "GET",
        "/.well-known/oauth-authorization-server",
        json({
          issuer: McpOAuthConfig.issuer(),
          authorization_endpoint: `${McpOAuthConfig.issuer()}/oauth/authorize`,
          token_endpoint: `${McpOAuthConfig.issuer()}/oauth/token`,
          registration_endpoint: `${McpOAuthConfig.issuer()}/oauth/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: [McpOAuthConfig.scope],
        }),
      );
      yield* router.add("POST", "/oauth/register", (request) =>
        Effect.gen(function* () {
          const rateLimitKey = request.headers["cf-connecting-ip"] ?? "unknown";
          const rateLimit = yield* options.limitRegistration(rateLimitKey).pipe(Effect.orDie);
          if (!rateLimit.success)
            return oauthError("temporarily_unavailable", "Registration rate limit exceeded", 429);
          const body = yield* request.json.pipe(Effect.catch(() => Effect.succeed(null)));
          if (!isRecord(body))
            return oauthError("invalid_client_metadata", "Expected a JSON object");
          const redirectUris = body.redirect_uris;
          const clientName = body.client_name;
          if (
            !Array.isArray(redirectUris) ||
            redirectUris.length === 0 ||
            redirectUris.length > 10 ||
            !redirectUris.every(
              (uri): uri is string => typeof uri === "string" && validRedirectUri(uri),
            ) ||
            (clientName !== undefined &&
              (typeof clientName !== "string" || clientName.length > 200)) ||
            (body.token_endpoint_auth_method !== undefined &&
              body.token_endpoint_auth_method !== "none") ||
            (body.grant_types !== undefined &&
              (!Array.isArray(body.grant_types) ||
                body.grant_types.length !== 1 ||
                body.grant_types[0] !== "authorization_code")) ||
            (body.response_types !== undefined &&
              (!Array.isArray(body.response_types) ||
                body.response_types.length !== 1 ||
                body.response_types[0] !== "code"))
          )
            return oauthError("invalid_client_metadata", "Unsupported client metadata");
          const clientId = crypto.randomUUID();
          const createdAt = new Date().toISOString();
          const name =
            typeof clientName === "string" && clientName.trim() !== ""
              ? clientName.trim()
              : "MCP client";
          yield* database
            .insert(oauthClients)
            .values({ id: clientId, name, redirectUris, createdAt })
            .pipe(Effect.orDie);
          return json(
            {
              client_id: clientId,
              client_id_issued_at: Math.floor(new Date(createdAt).getTime() / 1000),
              client_name: name,
              redirect_uris: redirectUris,
              token_endpoint_auth_method: "none",
              grant_types: ["authorization_code"],
              response_types: ["code"],
            },
            201,
          );
        }),
      );
      yield* router.add("GET", "/oauth/authorize", (request) =>
        Effect.gen(function* () {
          const url = new URL(request.url, McpOAuthConfig.issuer());
          const authorization = yield* parseAuthorization(url.searchParams);
          if (authorization === undefined)
            return HttpServerResponse.text("Invalid OAuth authorization request", { status: 400 });
          if ("error" in authorization)
            return redirectWith(authorization.redirectUri, {
              error: authorization.error,
              state: authorization.state,
            });
          const session = yield* Effect.option(options.authenticateSession(request));
          if (Option.isNone(session)) {
            const next = `${url.pathname}${url.search}`;
            return HttpServerResponse.redirect(`/sign-in?next=${encodeURIComponent(next)}`);
          }
          return consentPage(authorization);
        }),
      );
      yield* router.add("POST", "/oauth/authorize", (request) =>
        Effect.gen(function* () {
          const text = yield* request.text.pipe(Effect.catch(() => Effect.succeed("")));
          const params = new URLSearchParams(text);
          const authorization = yield* parseAuthorization(params);
          if (authorization === undefined)
            return HttpServerResponse.text("Invalid OAuth authorization request", { status: 400 });
          if ("error" in authorization)
            return redirectWith(authorization.redirectUri, {
              error: authorization.error,
              state: authorization.state,
            });
          const session = yield* options.authenticateSession(request).pipe(Effect.option);
          if (Option.isNone(session))
            return HttpServerResponse.text("Sign in required", { status: 401 });
          if (params.get("decision") !== "allow")
            return redirectWith(authorization.redirectUri, {
              error: "access_denied",
              state: authorization.state,
            });
          const code = randomSecret("mgc_");
          const codeHash = yield* hashSecret(code);
          yield* database
            .insert(oauthAuthorizationCodes)
            .values({
              codeHash,
              clientId: authorization.clientId,
              userId: session.value.userId,
              redirectUri: authorization.redirectUri,
              codeChallenge: authorization.codeChallenge,
              resource: authorization.resource,
              scope: authorization.scope,
              expiresAt: new Date(new Date().getTime() + authorizationCodeLifetimeMs).toISOString(),
            })
            .pipe(Effect.orDie);
          return redirectWith(authorization.redirectUri, { code, state: authorization.state });
        }),
      );
      yield* router.add("POST", "/oauth/token", (request) =>
        Effect.gen(function* () {
          const text = yield* request.text.pipe(Effect.catch(() => Effect.succeed("")));
          const params = new URLSearchParams(text);
          const code = params.get("code");
          const clientId = params.get("client_id");
          const redirectUri = params.get("redirect_uri");
          const verifier = params.get("code_verifier");
          const requestedResource = params.get("resource");
          if (
            params.get("grant_type") !== "authorization_code" ||
            code === null ||
            clientId === null ||
            redirectUri === null ||
            verifier === null ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
            requestedResource !== McpOAuthConfig.resource()
          )
            return oauthError("invalid_request", "Invalid authorization code request");
          const codeHash = yield* hashSecret(code);
          const challenge = yield* pkceChallenge(verifier);
          const codes = yield* database
            .delete(oauthAuthorizationCodes)
            .where(
              and(
                eq(oauthAuthorizationCodes.codeHash, codeHash),
                eq(oauthAuthorizationCodes.clientId, clientId),
                eq(oauthAuthorizationCodes.redirectUri, redirectUri),
                eq(oauthAuthorizationCodes.codeChallenge, challenge),
                eq(oauthAuthorizationCodes.resource, requestedResource),
                eq(oauthAuthorizationCodes.scope, McpOAuthConfig.scope),
                gt(oauthAuthorizationCodes.expiresAt, new Date().toISOString()),
              ),
            )
            .returning({
              userId: oauthAuthorizationCodes.userId,
              scope: oauthAuthorizationCodes.scope,
            })
            .pipe(Effect.orDie);
          const authorizationCode = codes[0];
          if (authorizationCode === undefined)
            return oauthError("invalid_grant", "Authorization code is invalid or expired");
          const accessToken = randomSecret("mgo_");
          const tokenHash = yield* hashSecret(accessToken);
          const createdAt = new Date().toISOString();
          yield* database
            .insert(oauthAccessTokens)
            .values({
              tokenHash,
              clientId,
              userId: authorizationCode.userId,
              resource: requestedResource,
              scope: authorizationCode.scope,
              createdAt,
              expiresAt: new Date(
                new Date(createdAt).getTime() + accessTokenLifetimeSeconds * 1000,
              ).toISOString(),
            })
            .pipe(Effect.orDie);
          return json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: accessTokenLifetimeSeconds,
            scope: authorizationCode.scope,
          });
        }),
      );
    }),
  );
