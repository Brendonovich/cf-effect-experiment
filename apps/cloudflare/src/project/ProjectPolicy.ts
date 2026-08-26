import { CurrentUser, ProjectNotFound } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";

import * as Database from "../database/Database.ts";
import { projectMembers, projects, teamMemberships } from "../database/DatabaseSchema.ts";
import { canAccessProject, canAdministerTeam, canMutateProject } from "../team/TeamAccess.ts";

export class Service extends Context.Service<
  Service,
  {
    readonly canView: (projectId: string) => Policy.Policy<ProjectNotFound, CurrentUser>;
    readonly canEdit: (projectId: string) => Policy.Policy<ProjectNotFound, CurrentUser>;
    readonly canManage: (
      projectId: string,
    ) => Policy.Policy<ProjectNotFound | HttpApiError.Forbidden, CurrentUser>;
  }
>()("macrograph/cloudflare/ProjectPolicy") {}

export const layer = Layer.effect(Service)(
  Effect.gen(function* () {
    const database = yield* Database.Service;

    const resolve = (projectId: string) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const rows = yield* database
          .select({ project: projects, role: teamMemberships.role, grant: projectMembers.userId })
          .from(projects)
          .innerJoin(
            teamMemberships,
            and(eq(teamMemberships.teamId, projects.teamId), eq(teamMemberships.userId, user.id)),
          )
          .leftJoin(
            projectMembers,
            and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, user.id)),
          )
          .where(eq(projects.id, projectId))
          .limit(1)
          .pipe(Effect.orDie);
        const row = rows[0];
        if (row === undefined) return yield* new ProjectNotFound();
        return { project: row.project, role: row.role, hasGrant: row.grant !== null };
      });

    return {
      canView: (projectId: string) =>
        Policy.policy(() =>
          resolve(projectId).pipe(
            Effect.map((authorization) =>
              canAccessProject(
                authorization.role,
                authorization.project.access,
                authorization.hasGrant,
              ),
            ),
          ),
        ).pipe(Effect.mapError(() => new ProjectNotFound())),
      canEdit: (projectId: string) =>
        Policy.policy(() =>
          resolve(projectId).pipe(
            Effect.map((authorization) => canMutateProject(authorization.role)),
          ),
        ).pipe(Effect.mapError(() => new ProjectNotFound())),
      canManage: (projectId: string) =>
        Policy.policy(() =>
          resolve(projectId).pipe(
            Effect.map((authorization) => canAdministerTeam(authorization.role)),
          ),
        ).pipe(Effect.catchTag("PolicyDenied", () => new HttpApiError.Forbidden())),
    };
  }),
);
