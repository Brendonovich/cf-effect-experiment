import { CurrentUser, ProjectNotFound } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { Credential } from "@macrograph/plugin";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";

import * as Database from "../database/Database.ts";
import { projects } from "../database/DatabaseSchema.ts";
import ProjectEditorDO from "../editor/ProjectEditorDO.ts";
import * as Authentication from "./Authentication.ts";
import * as CredentialPolicy from "./CredentialPolicy.ts";

export const make = Effect.gen(function* () {
  const authentication = yield* Authentication.Service;
  const database = yield* Database.Service;
  const credentialPolicy = yield* CredentialPolicy.Service;
  const projectEditors = yield* ProjectEditorDO;

  return {
    list: (projectId: string) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const rows = yield* database
          .select()
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1)
          .pipe(Effect.orDie);
        const project = rows[0];
        if (project === undefined) return yield* new ProjectNotFound();
        if (project.createdBy !== user.id)
          return Credential.unavailable(
            "not-connected",
            "Credentials are scoped to the project creator.",
          );
        if (user.sessionId === undefined)
          return Credential.unavailable(
            "not-connected",
            "Credentials require an authenticated browser session.",
          );
        return yield* authentication.cloudAuth(user.sessionId).credentialCatalog();
      }).pipe(Policy.withPolicy(credentialPolicy.canView(projectId))),
    refetch: (projectId: string) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const rows = yield* database
          .select()
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1)
          .pipe(Effect.orDie);
        const project = rows[0];
        if (project === undefined) return yield* new ProjectNotFound();
        if (user.sessionId === undefined) return yield* new HttpApiError.Forbidden();
        const catalog = yield* authentication.cloudAuth(user.sessionId).refetchCredentials();
        yield* projectEditors.getByName(project.id).credentialsChanged();
        return catalog;
      }).pipe(
        Policy.withPolicy(credentialPolicy.canManage(projectId)),
        Policy.withPolicy(credentialPolicy.canEdit(projectId)),
      ),
  };
});

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "macrograph/cloudflare/Credential",
) {}

export const layer = Layer.effect(Service)(make);
