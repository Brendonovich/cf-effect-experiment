import { CurrentUser } from "@macrograph/cloud-api";
import { Credential } from "@macrograph/module";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import type { oauthCredentials } from "../database/AccountDatabaseSchema.ts";

import * as Database from "../database/Database.ts";
import { projects } from "../database/DatabaseSchema.ts";
import ProjectEditorDO from "../editor/ProjectEditorDO.ts";
import * as CredentialStore from "./CredentialStore.ts";
import * as OAuthProviders from "./OAuthProviders.ts";

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

/**
 * Cloud's read-only view of account credentials. They are connected and removed on the MacroGraph
 * website; project editors run with their owner's credentials.
 */
export const make = Effect.gen(function* () {
  const database = yield* Database.Service;
  const providers = yield* OAuthProviders.Service;
  const projectEditors = yield* ProjectEditorDO;

  const rowsFor = (userId: string) => CredentialStore.rowsFor(database, userId);
  const transfersFor = (userId: string) =>
    rowsFor(userId).pipe(
      Effect.map((rows) => rows.map((row) => CredentialStore.toTransfer(row, providers))),
    );

  const catalogFor = (userId: string) =>
    rowsFor(userId).pipe(
      Effect.map(
        (rows): Credential.Catalog => ({
          _tag: "CredentialCatalogAvailable",
          credentials: rows.map((row) => summary(row, providers.get(row.providerId))),
        }),
      ),
    );

  const notifyProjects = (userId: string) =>
    Effect.gen(function* () {
      const credentials = yield* transfersFor(userId);
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
            .setCredentials(credentials)
            .pipe(Effect.catchCause(() => Effect.void)),
        { discard: true },
      );
    });

  return {
    list: CurrentUser.pipe(Effect.flatMap((user) => catalogFor(user.id))),
    /** Reloads the catalog and hands the latest credentials to the user's project editors. */
    refetch: CurrentUser.pipe(
      Effect.flatMap((user) => catalogFor(user.id).pipe(Effect.tap(() => notifyProjects(user.id)))),
    ),
    /** Gives a project's editor its owner's current credentials. */
    syncEditor: (projectId: string, ownerId: string) =>
      transfersFor(ownerId).pipe(
        Effect.flatMap((credentials) =>
          projectEditors.getByName(projectId).setCredentials(credentials),
        ),
        Effect.catchCause(() => Effect.void),
      ),
  };
});

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "macrograph/cloudflare/Credential",
) {}

export const layer = Layer.effect(Service)(make);
