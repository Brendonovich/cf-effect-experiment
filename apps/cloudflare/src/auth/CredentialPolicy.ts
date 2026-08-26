import { CurrentUser, ProjectNotFound } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";

import * as Database from "../database/Database.ts";
import { projects, teamMemberships } from "../database/DatabaseSchema.ts";
import * as ProjectPolicy from "../project/ProjectPolicy.ts";
import { canManageProjectCredentials } from "../team/TeamAccess.ts";

export class Service extends Context.Service<
  Service,
  {
    readonly canView: (projectId: string) => Policy.Policy<ProjectNotFound, CurrentUser>;
    readonly canEdit: (projectId: string) => Policy.Policy<ProjectNotFound, CurrentUser>;
    readonly canManage: (
      projectId: string,
    ) => Policy.Policy<ProjectNotFound | HttpApiError.Forbidden, CurrentUser>;
  }
>()("macrograph/cloudflare/CredentialPolicy") {}

export const layer = Layer.effect(Service)(
  Effect.gen(function* () {
    const database = yield* Database.Service;
    const projectPolicy = yield* ProjectPolicy.Service;
    return {
      canView: projectPolicy.canView,
      canEdit: projectPolicy.canEdit,
      canManage: (projectId: string) =>
        Policy.policy(() =>
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const rows = yield* database
              .select({ createdBy: projects.createdBy, role: teamMemberships.role })
              .from(projects)
              .innerJoin(
                teamMemberships,
                and(
                  eq(teamMemberships.teamId, projects.teamId),
                  eq(teamMemberships.userId, user.id),
                ),
              )
              .where(eq(projects.id, projectId))
              .limit(1)
              .pipe(Effect.orDie);
            const row = rows[0];
            if (row === undefined) return yield* new ProjectNotFound();
            return canManageProjectCredentials(row.role, row.createdBy, user.id);
          }),
        ).pipe(Effect.catchTag("PolicyDenied", () => new HttpApiError.Forbidden())),
    };
  }),
);
