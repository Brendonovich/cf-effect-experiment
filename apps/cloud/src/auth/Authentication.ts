import { Authentication, CurrentUser } from "@macrograph/cloud-api";
import { ApiCaller, ApiKey, type ProjectMcp } from "@macrograph/project-api";
import { and, eq, gt, ne } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { HttpEffect, HttpServerRequest } from "effect/http";
import { HttpApiError } from "effect/http-api";

import { hasTrustedOrigin, requestOrigin } from "../api/HttpOrigin.ts";
import * as Database from "../database/Database.ts";
import { apiKeys, oauthAccessTokens, users } from "../database/DatabaseSchema.ts";
import * as Session from "../website/Session.ts";
import * as McpOAuthConfig from "./McpOAuthConfig.ts";

export interface SessionUser {
  readonly id: string;
  readonly email: string;
}

export const make = Effect.gen(function* () {
  const database = yield* Database.Service;
  const sessions = yield* Session.make;

  /** Mirrors the account into Cloud's users table, writing only when it is new or changed. */
  const ensureUser = (user: SessionUser) => {
    const email = user.email.trim().toLowerCase();
    return database
      .insert(users)
      .values({ id: user.id, email, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: users.id, set: { email }, setWhere: ne(users.email, email) })
      .pipe(Effect.orDie, Effect.asVoid);
  };

  /**
   * The user signed in to the MacroGraph website, which shares Cloud's origin. Like the website,
   * renewed sessions get a refreshed cookie so active Cloud users stay signed in.
   */
  const sessionUser = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* (): Effect.fn.Return<SessionUser | undefined> {
      const sessionId = request.cookies[Session.cookieName];
      if (!sessionId) return undefined;
      const validated = yield* sessions.validate(sessionId);
      if (validated === undefined) return undefined;
      if (validated.session.fresh) {
        const secure = new URL(requestOrigin(request)).protocol === "https:";
        const context = yield* Effect.context<never>();
        HttpEffect.appendPreResponseHandlerUnsafe(context, (_request, response) =>
          Effect.succeed(Session.refreshCookie(validated.session.id, secure)(response)),
        );
      }
      return validated.user;
    });

  const authenticateSession = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      if (!hasTrustedOrigin(request)) return yield* new HttpApiError.Unauthorized();
      const user = yield* sessionUser(request);
      if (user === undefined) return yield* new HttpApiError.Unauthorized();
      yield* ensureUser(user);
      return { userId: user.id };
    });

  const issueApiKey = (name: string, request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const { userId } = yield* authenticateSession(request);
      const { key, keyHash } = yield* ApiKey.generate;
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      yield* database
        .insert(apiKeys)
        .values({ id, userId, name, keyHash, createdAt })
        .pipe(Effect.orDie);
      return { id, name, key, createdAt };
    });

  const revokeApiKey = (apiKeyId: string, request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const { userId } = yield* authenticateSession(request);
      yield* database
        .delete(apiKeys)
        .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
        .pipe(Effect.orDie);
    });

  const authenticateBearer = (): Effect.Effect<
    ProjectMcp.Principal,
    HttpApiError.Unauthorized,
    HttpServerRequest.HttpServerRequest
  > =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const key = ApiKey.fromAuthorization(request.headers.authorization);
      if (key === undefined) return yield* new HttpApiError.Unauthorized();
      const keyHash = yield* ApiKey.hash(key);
      const rows = yield* database
        .select({ id: apiKeys.id, name: apiKeys.name, userId: apiKeys.userId, email: users.email })
        .from(apiKeys)
        .leftJoin(users, eq(users.id, apiKeys.userId))
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1)
        .pipe(Effect.orDie);
      const row = rows[0];
      if (row === undefined) return yield* new HttpApiError.Unauthorized();
      return {
        user: { id: row.userId },
        caller: ApiCaller.forApiKey({ id: row.id, name: row.name }, row.email),
      };
    });

  const authenticateMcpBearer = (): Effect.Effect<
    ProjectMcp.Principal,
    HttpApiError.Unauthorized,
    HttpServerRequest.HttpServerRequest
  > =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? "");
      if (match === null) return yield* new HttpApiError.Unauthorized();
      const keyHash = yield* ApiKey.hash(match[1]);
      const oauthRows = yield* database
        .select({ userId: oauthAccessTokens.userId, email: users.email })
        .from(oauthAccessTokens)
        .leftJoin(users, eq(users.id, oauthAccessTokens.userId))
        .where(
          and(
            eq(oauthAccessTokens.tokenHash, keyHash),
            eq(oauthAccessTokens.resource, McpOAuthConfig.resource()),
            eq(oauthAccessTokens.scope, McpOAuthConfig.scope),
            gt(oauthAccessTokens.expiresAt, new Date().toISOString()),
          ),
        )
        .limit(1)
        .pipe(Effect.orDie);
      const oauthUser = oauthRows[0];
      if (oauthUser !== undefined)
        return {
          user: { id: oauthUser.userId },
          caller: { ...ApiCaller.anonymous, email: oauthUser.email },
        };
      return yield* authenticateBearer();
    });

  return {
    sessionUser,
    ensureUser,
    issueApiKey,
    revokeApiKey,
    authenticateSession,
    authenticateBearer,
    authenticateMcpBearer,
    sessionStatus: (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const user = yield* sessionUser(request);
        if (user === undefined) return { state: "disconnected" as const };
        yield* ensureUser(user);
        return { state: "connected" as const, userId: user.id, email: user.email };
      }),
  };
});

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "macrograph/cloudflare/Authentication",
) {}

export const layer = Layer.effect(Service)(make);

export const middleware = Layer.effect(Authentication)(
  Effect.gen(function* () {
    const authentication = yield* Service;
    return {
      bearer: (effect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.headers.authorization !== undefined) {
            const { user, caller } = yield* authentication.authenticateBearer();
            return yield* effect.pipe(
              Effect.provideService(CurrentUser, user),
              Effect.provideService(ApiCaller.Current, caller),
            );
          }
          if (request.method !== "GET" && request.method !== "HEAD" && !hasTrustedOrigin(request))
            return yield* new HttpApiError.Unauthorized();
          const user = yield* authentication.sessionUser(request);
          if (user === undefined) return yield* new HttpApiError.Unauthorized();
          yield* authentication.ensureUser(user);
          return yield* effect.pipe(Effect.provideService(CurrentUser, { id: user.id }));
        }),
    };
  }),
);
