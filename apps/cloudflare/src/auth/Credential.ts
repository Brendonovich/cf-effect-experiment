import { CurrentUser, ProjectNotFound } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { Credential } from "@macrograph/module";
import { RuntimeContext as AlchemyRuntimeContext } from "alchemy";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";

import { requestOrigin } from "../api/HttpOrigin.ts";
import { oauthCredentials, type OAuthToken } from "../database/AccountDatabaseSchema.ts";
import * as Database from "../database/Database.ts";
import { projects } from "../database/DatabaseSchema.ts";
import ProjectEditorDO from "../editor/ProjectEditorDO.ts";
import * as Authentication from "./Authentication.ts";
import * as CredentialPolicy from "./CredentialPolicy.ts";
import * as OAuthProviders from "./OAuthProviders.ts";

const OAuthState = Schema.Struct({
  userId: Schema.String,
  projectId: Schema.String,
  provider: Schema.String,
  redirectUri: Schema.String,
  expiresAt: Schema.Number,
  nonce: Schema.String,
});
type OAuthState = typeof OAuthState.Type;

const bytes = new TextEncoder();
const base64Url = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const fromBase64Url = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

const summary = (
  row: typeof oauthCredentials.$inferSelect,
  provider: OAuthProviders.Provider | undefined,
): Credential.Summary => ({
  provider: row.providerId,
  id: row.providerUserId,
  displayName: row.displayName,
  status: "available",
  scopes: row.token.scope?.split(" ").filter((scope) => scope !== "") ?? provider?.scopes ?? [],
  metadata: provider === undefined ? {} : { clientId: provider.clientId },
});

export const make = Effect.gen(function* () {
  const authentication = yield* Authentication.Service;
  const database = yield* Database.Service;
  const credentialPolicy = yield* CredentialPolicy.Service;
  const providers = yield* OAuthProviders.Service;
  const projectEditors = yield* ProjectEditorDO;
  const runtimeContext = yield* AlchemyRuntimeContext;
  const stateKey = Effect.gen(function* () {
    const stateSecret = yield* runtimeContext.get<Redacted.Redacted<string>>(
      "CREDENTIAL_OAUTH_STATE_SECRET",
    );
    if (stateSecret === undefined)
      return yield* Effect.die("Credential OAuth state secret is unavailable");
    return yield* Effect.promise(() =>
      crypto.subtle.importKey(
        "raw",
        bytes.encode(Redacted.value(stateSecret)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      ),
    );
  });

  const projectFor = (projectId: string) =>
    database
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
      .pipe(
        Effect.orDie,
        Effect.flatMap((rows) =>
          rows[0] === undefined ? Effect.fail(new ProjectNotFound()) : Effect.succeed(rows[0]),
        ),
      );

  const rowsFor = (userId: string) =>
    database
      .select()
      .from(oauthCredentials)
      .where(eq(oauthCredentials.userId, userId))
      .pipe(Effect.orDie);

  const catalogFor = (userId: string) =>
    rowsFor(userId).pipe(
      Effect.map((rows) => ({
        _tag: "CredentialCatalogAvailable" as const,
        credentials: rows.map((row) => summary(row, providers.get(row.providerId))),
      })),
    );

  const signState = (state: OAuthState) =>
    Effect.gen(function* () {
      const key = yield* stateKey;
      const payload = base64Url(bytes.encode(JSON.stringify(Schema.encodeSync(OAuthState)(state))));
      const signature = new Uint8Array(
        yield* Effect.promise(() => crypto.subtle.sign("HMAC", key, bytes.encode(payload))),
      );
      return `${payload}.${base64Url(signature)}`;
    });

  const verifyState = (value: string) =>
    Effect.gen(function* () {
      const key = yield* stateKey;
      return yield* Effect.tryPromise({
        try: async () => {
          const [payload, signature] = value.split(".");
          if (payload === undefined || signature === undefined) throw new Error("invalid state");
          const valid = await crypto.subtle.verify(
            "HMAC",
            key,
            fromBase64Url(signature),
            bytes.encode(payload),
          );
          if (!valid) throw new Error("invalid state");
          const state = Schema.decodeUnknownSync(OAuthState)(
            JSON.parse(new TextDecoder().decode(fromBase64Url(payload))),
          );
          if (state.expiresAt <= Date.now()) throw new Error("expired state");
          return state;
        },
        catch: () => new HttpApiError.BadRequest(),
      });
    });

  const notifyProjects = (userId: string, sessionId: string | undefined) =>
    Effect.gen(function* () {
      if (sessionId !== undefined)
        yield* authentication
          .cloudAuth(sessionId)
          .refetchCredentials()
          .pipe(Effect.catchCause(() => Effect.void));
      const owned = yield* database
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.createdBy, userId))
        .pipe(Effect.orDie);
      yield* Effect.forEach(
        owned,
        (project) =>
          projectEditors
            .getByName(project.id)
            .credentialsChanged()
            .pipe(Effect.catchCause(() => Effect.void)),
        { discard: true },
      );
    });

  const requireOwner = (projectId: string) =>
    Effect.gen(function* () {
      const user = yield* CurrentUser;
      const project = yield* projectFor(projectId);
      if (project.createdBy !== user.id) return yield* new HttpApiError.Forbidden();
      return { user, project };
    });

  return {
    publicOrigin: requestOrigin,
    providers: Effect.succeed(providers.list),
    list: (projectId: string) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const project = yield* projectFor(projectId);
        if (project.createdBy !== user.id)
          return Credential.unavailable(
            "not-connected",
            "Credentials are scoped to the project creator.",
          );
        return yield* catalogFor(user.id);
      }).pipe(Policy.withPolicy(credentialPolicy.canView(projectId))),
    refetch: (projectId: string) =>
      requireOwner(projectId).pipe(
        Effect.flatMap(({ user }) => catalogFor(user.id)),
        Policy.withPolicy(credentialPolicy.canManage(projectId)),
        Policy.withPolicy(credentialPolicy.canEdit(projectId)),
      ),
    connect: (projectId: string, providerId: string, origin: string) =>
      requireOwner(projectId).pipe(
        Effect.flatMap(({ user }) => {
          const provider = providers.get(providerId);
          if (provider === undefined) return Effect.fail(new HttpApiError.BadRequest());
          const redirectUri = `${origin}/credential-oauth/callback`;
          return signState({
            userId: user.id,
            projectId,
            provider: provider.id,
            redirectUri,
            expiresAt: Date.now() + 10 * 60 * 1_000,
            nonce: crypto.randomUUID(),
          }).pipe(
            Effect.map((state) => ({
              authorizationUrl: providers.authorizeUrl(provider, redirectUri, state),
            })),
          );
        }),
        Policy.withPolicy(credentialPolicy.canManage(projectId)),
        Policy.withPolicy(credentialPolicy.canEdit(projectId)),
      ),
    complete: (providerId: string, code: string, encodedState: string) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const state = yield* verifyState(encodedState);
        if (state.userId !== user.id || state.provider !== providerId)
          return yield* new HttpApiError.Forbidden();
        yield* requireOwner(state.projectId);
        const provider = providers.get(providerId);
        if (provider === undefined) return yield* new HttpApiError.BadRequest();
        const token = yield* providers
          .exchange(provider, code, state.redirectUri)
          .pipe(Effect.mapError(() => new HttpApiError.BadRequest()));
        const identity = yield* providers
          .user(provider, token.access_token)
          .pipe(Effect.mapError(() => new HttpApiError.BadRequest()));
        const issuedAt = new Date();
        yield* database
          .insert(oauthCredentials)
          .values({
            providerId,
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
        yield* notifyProjects(user.id, user.sessionId);
        return {
          projectId: state.projectId,
          credential: summary(
            {
              providerId,
              providerUserId: identity.id,
              userId: user.id,
              token,
              issuedAt,
              displayName: identity.displayName,
            },
            provider,
          ),
        };
      }),
    remove: (projectId: string, providerId: string, credentialId: string) =>
      requireOwner(projectId).pipe(
        Effect.flatMap(({ user }) =>
          database
            .delete(oauthCredentials)
            .where(
              and(
                eq(oauthCredentials.userId, user.id),
                eq(oauthCredentials.providerId, providerId),
                eq(oauthCredentials.providerUserId, credentialId),
              ),
            )
            .pipe(Effect.orDie, Effect.andThen(notifyProjects(user.id, user.sessionId))),
        ),
        Policy.withPolicy(credentialPolicy.canManage(projectId)),
        Policy.withPolicy(credentialPolicy.canEdit(projectId)),
      ),
    refreshCredential: (userId: string, providerId: string, credentialId: string) =>
      Effect.gen(function* () {
        const matches = yield* database
          .select()
          .from(oauthCredentials)
          .where(
            and(
              eq(oauthCredentials.userId, userId),
              eq(oauthCredentials.providerId, providerId),
              eq(oauthCredentials.providerUserId, credentialId),
            ),
          )
          .limit(1)
          .pipe(Effect.orDie);
        const row = matches[0];
        const provider = providers.get(providerId);
        if (row === undefined || provider === undefined) return undefined;
        const refreshToken = row.token.refresh_token;
        if (refreshToken === undefined) return row;
        const refreshed = yield* providers.refresh(provider, refreshToken);
        if (refreshed === undefined) return row;
        const token: OAuthToken = refreshed;
        const issuedAt = new Date();
        yield* database
          .update(oauthCredentials)
          .set({ token, issuedAt })
          .where(
            and(
              eq(oauthCredentials.userId, userId),
              eq(oauthCredentials.providerId, providerId),
              eq(oauthCredentials.providerUserId, credentialId),
            ),
          )
          .pipe(Effect.orDie);
        return { ...row, token, issuedAt };
      }),
  };
});

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "macrograph/cloudflare/Credential",
) {}

export const layer = Layer.effect(Service)(
  make.pipe(Effect.provide(AlchemyRuntimeContext.phantom)),
);
