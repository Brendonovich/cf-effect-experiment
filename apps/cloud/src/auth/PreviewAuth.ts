import {
  PreviewIdentity,
  sessionCookieName,
  sessionSecurity,
  type PreviewTokenRequest,
} from "@macrograph/cloud-api";
import { Config, Context, Effect, Layer, Schema } from "effect";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";

import { requestOrigin } from "../api/HttpOrigin.ts";
import * as Database from "../database/Database.ts";
import { projects, teamMemberships, teams, users } from "../database/DatabaseSchema.ts";
import * as Authentication from "./Authentication.ts";
import PreviewAuthGrantDO from "./PreviewAuthGrantDO.ts";

export const productionOrigin = "https://cloud.macrograph.app";
export const canonicalEmail = "brendan@brendonovich.dev";
export const previewTeamId = "00000000-0000-4000-8000-000000000001";
export const previewProjectId = "00000000-0000-4000-8000-000000000002";

const previewHostname = /^macrograph-cloudworker-pr\d+-[a-z0-9]{16}\.brendonovich\.workers\.dev$/;

export const parsePreviewRedirectUri = (value: string) => {
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !previewHostname.test(url.hostname) ||
    url.pathname !== "/preview-auth/callback" ||
    url.search !== "" ||
    url.hash !== ""
  )
    return undefined;
  return url;
};

export const isPreviewOrigin = (value: string) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    previewHostname.test(url.hostname) &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
};

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

export const pkceChallenge = (verifier: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).pipe(
    Effect.map((digest) => base64Url(new Uint8Array(digest))),
  );

export const make = Effect.gen(function* () {
  const stage = yield* Config.string("ALCHEMY_STAGE");
  const authentication = yield* Authentication.Service;
  const database = yield* Database.Service;
  const grants = (yield* PreviewAuthGrantDO).getByName("preview-auth-grants-v1");

  const noStore = HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(
      HttpServerResponse.setHeaders(response, {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      }),
    ),
  );

  const requireProduction = Effect.fnUntraced(function* (
    request: HttpServerRequest.HttpServerRequest,
  ) {
    if (stage !== "production" || requestOrigin(request) !== productionOrigin)
      return yield* new HttpApiError.Forbidden();
    yield* noStore;
  });

  const requirePreview = Effect.fnUntraced(function* (
    request: HttpServerRequest.HttpServerRequest,
  ) {
    const origin = requestOrigin(request);
    if (!/^pr\d+$/.test(stage) || !isPreviewOrigin(origin) || request.headers.origin !== origin)
      return yield* new HttpApiError.Forbidden();
    yield* noStore;
    return origin;
  });

  const provision = (identity: typeof PreviewIdentity.Type) =>
    database
      .transaction((transaction) =>
        Effect.gen(function* () {
          const now = new Date().toISOString();
          yield* transaction
            .insert(users)
            .values({ id: identity.userId, email: identity.email, createdAt: now })
            .onConflictDoUpdate({ target: users.id, set: { email: identity.email } });
          yield* transaction
            .insert(teams)
            .values({
              id: previewTeamId,
              name: "Personal",
              kind: "personal",
              personalOwnerUserId: identity.userId,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing({ target: teams.id });
          yield* transaction
            .insert(teamMemberships)
            .values({
              teamId: previewTeamId,
              userId: identity.userId,
              role: "owner",
              createdAt: now,
            })
            .onConflictDoNothing({ target: [teamMemberships.teamId, teamMemberships.userId] });
          yield* transaction
            .insert(projects)
            .values({
              id: previewProjectId,
              teamId: previewTeamId,
              createdBy: identity.userId,
              access: "team",
              name: "Preview Project",
              currentDeploymentId: null,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing({ target: projects.id });
        }),
      )
      .pipe(Effect.orDie);

  return {
    authorize: (
      query: { redirectUri: string; codeChallenge: string; state: string },
      request: HttpServerRequest.HttpServerRequest,
    ) =>
      Effect.gen(function* () {
        yield* requireProduction(request);
        const redirect = parsePreviewRedirectUri(query.redirectUri);
        if (redirect === undefined) return yield* new HttpApiError.BadRequest();
        const sessionId = request.cookies[sessionCookieName];
        if (sessionId === undefined) return yield* new HttpApiError.Unauthorized();
        const status = yield* authentication.cloudAuth(sessionId).status();
        if (status.state !== "connected" || status.email.trim().toLowerCase() !== canonicalEmail)
          return yield* new HttpApiError.Unauthorized();
        const code = yield* grants.issue({
          redirectUri: query.redirectUri,
          codeChallenge: query.codeChallenge,
          userId: status.userId,
          email: canonicalEmail,
        });
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", query.state);
        return HttpServerResponse.redirect(redirect);
      }),
    token: (
      payload: typeof PreviewTokenRequest.Type,
      request: HttpServerRequest.HttpServerRequest,
    ) =>
      Effect.gen(function* () {
        yield* requireProduction(request);
        if (parsePreviewRedirectUri(payload.redirectUri) === undefined)
          return yield* new HttpApiError.BadRequest();
        const challenge = yield* pkceChallenge(payload.codeVerifier);
        const grant = yield* grants.consume(payload.code, payload.redirectUri, challenge);
        if (grant === undefined || grant.email !== canonicalEmail)
          return yield* new HttpApiError.Unauthorized();
        return { userId: grant.userId, email: grant.email };
      }),
    exchange: (
      payload: typeof PreviewTokenRequest.Type,
      request: HttpServerRequest.HttpServerRequest,
    ) =>
      Effect.gen(function* () {
        const previewOrigin = yield* requirePreview(request);
        const redirect = parsePreviewRedirectUri(payload.redirectUri);
        if (redirect === undefined || redirect.origin !== previewOrigin)
          return yield* new HttpApiError.BadRequest();
        const response = yield* Effect.tryPromise(() =>
          fetch(`${productionOrigin}/api/preview-auth/token`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }),
        ).pipe(Effect.catch(() => Effect.fail(new HttpApiError.Unauthorized())));
        if (!response.ok) return yield* new HttpApiError.Unauthorized();
        const identity = yield* Effect.tryPromise(() => response.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(PreviewIdentity)),
          Effect.catch(() => Effect.fail(new HttpApiError.Unauthorized())),
        );
        if (identity.email !== canonicalEmail) return yield* new HttpApiError.Unauthorized();
        yield* provision(identity);
        const previousSessionId = request.cookies[sessionCookieName];
        if (previousSessionId !== undefined)
          yield* authentication.cloudAuth(previousSessionId).disconnect();
        const sessionId = crypto.randomUUID();
        yield* authentication.cloudAuth(sessionId).establishPreviewIdentity(identity);
        yield* HttpApiBuilder.securitySetCookie(sessionSecurity, sessionId, {
          path: "/",
          sameSite: "lax",
          secure: true,
        });
        return {
          state: "connected" as const,
          ...identity,
          teamId: previewTeamId,
          projectId: previewProjectId,
        };
      }),
  };
});

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "macrograph/cloudflare/PreviewAuth",
) {}

export const layer = Layer.effect(Service)(make);
