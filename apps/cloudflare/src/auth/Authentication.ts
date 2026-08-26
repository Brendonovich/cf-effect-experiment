import {
  Authentication,
  CurrentUser,
  sessionCookieName,
  sessionSecurity,
} from "@macrograph/cloud-api";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";

import { hasTrustedOrigin, requestOrigin } from "../api/HttpOrigin.ts";
import * as Database from "../database/Database.ts";
import { apiKeys, users } from "../database/DatabaseSchema.ts";
import CloudAuthDO from "./CloudAuthDO.ts";

export const make = Effect.gen(function* () {
  const database = yield* Database.Service;
  const cloudAuths = yield* CloudAuthDO;
  const cloudAuth = (sessionId: string) => cloudAuths.getByName(sessionId);

  const authenticatedSession = (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const sessionId = request.cookies[sessionCookieName];
      if (!sessionId || !hasTrustedOrigin(request)) return yield* new HttpApiError.Unauthorized();
      const userId = yield* cloudAuth(sessionId).userId();
      if (userId === undefined) return yield* new HttpApiError.Unauthorized();
      return { userId, sessionId };
    });

  const hashApiKey = (key: string) =>
    Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))).pipe(
      Effect.map((digest) =>
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      ),
    );

  const issueApiKey = (name: string, request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const { userId } = yield* authenticatedSession(request);
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const key = `mg_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      const keyHash = yield* hashApiKey(key);
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
      const { userId } = yield* authenticatedSession(request);
      yield* database
        .delete(apiKeys)
        .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.userId, userId)))
        .pipe(Effect.orDie);
    });

  const authenticateBearer = () =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? "");
      if (match === null) return yield* new HttpApiError.Unauthorized();
      const keyHash = yield* hashApiKey(match[1]);
      const rows = yield* database
        .select({ userId: apiKeys.userId })
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1)
        .pipe(Effect.orDie);
      const userId = rows[0]?.userId;
      if (userId === undefined) return yield* new HttpApiError.Unauthorized();
      return { id: userId, sessionId: undefined };
    });

  const setSessionCookie = (request: HttpServerRequest.HttpServerRequest, sessionId: string) =>
    HttpApiBuilder.securitySetCookie(sessionSecurity, sessionId, {
      path: "/",
      sameSite: "lax",
      secure: new URL(requestOrigin(request)).protocol === "https:",
    });

  return {
    cloudAuth,
    issueApiKey,
    revokeApiKey,
    authenticateBearer,
    sessionStatus: (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const existingSessionId = request.cookies[sessionCookieName] || undefined;
        const sessionId = existingSessionId ?? crypto.randomUUID();
        if (existingSessionId === undefined) yield* setSessionCookie(request, sessionId);
        const status = yield* cloudAuth(sessionId).status();
        if (status.state !== "connected") return status;
        const existingUsers = yield* database
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, status.userId))
          .limit(1)
          .pipe(Effect.orDie);
        return existingUsers[0] === undefined ? { state: "disconnected" as const } : status;
      }),
    startSession: (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        if (!hasTrustedOrigin(request)) return { state: "disconnected" as const };
        const existingSessionId = request.cookies[sessionCookieName] || undefined;
        const sessionId = existingSessionId ?? crypto.randomUUID();
        if (existingSessionId === undefined) yield* setSessionCookie(request, sessionId);
        const status = yield* cloudAuth(sessionId).start();
        if (status.state === "connected")
          yield* database
            .insert(users)
            .values({ id: status.userId, createdAt: new Date().toISOString() })
            .onConflictDoNothing()
            .pipe(Effect.orDie);
        return status;
      }),
    pollSession: (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        const sessionId = request.cookies[sessionCookieName];
        if (!sessionId || !hasTrustedOrigin(request)) return { state: "disconnected" as const };
        const status = yield* cloudAuth(sessionId).poll();
        if (status.state === "connected")
          yield* database
            .insert(users)
            .values({ id: status.userId, createdAt: new Date().toISOString() })
            .onConflictDoNothing()
            .pipe(Effect.orDie);
        return status;
      }),
    disconnectSession: (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        if (!hasTrustedOrigin(request)) return;
        const sessionId = request.cookies[sessionCookieName];
        if (sessionId) yield* cloudAuth(sessionId).disconnect();
        yield* HttpApiBuilder.securitySetCookie(sessionSecurity, "", {
          path: "/",
          sameSite: "lax",
          secure: new URL(requestOrigin(request)).protocol === "https:",
          maxAge: 0,
        });
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
            const user = yield* authentication.authenticateBearer();
            return yield* effect.pipe(Effect.provideService(CurrentUser, user));
          }
          if (request.method !== "GET" && request.method !== "HEAD" && !hasTrustedOrigin(request))
            return yield* new HttpApiError.Unauthorized();
          const sessionId = request.cookies[sessionCookieName];
          if (!sessionId) return yield* new HttpApiError.Unauthorized();
          const userId = yield* authentication.cloudAuth(sessionId).userId();
          if (userId === undefined) return yield* new HttpApiError.Unauthorized();
          return yield* effect.pipe(Effect.provideService(CurrentUser, { id: userId, sessionId }));
        }),
    };
  }),
);
