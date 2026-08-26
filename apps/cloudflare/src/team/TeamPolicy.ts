import { CurrentUser, TeamNotFound } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";

import * as Database from "../database/Database.ts";
import { teamMemberships, type TeamRole } from "../database/DatabaseSchema.ts";
import { canAdministerTeam, canRemoveMember, canSetMemberRole } from "./TeamAccess.ts";

export class Service extends Context.Service<
  Service,
  {
    readonly canView: (teamId: string) => Policy.Policy<TeamNotFound, CurrentUser>;
    readonly canManage: (
      teamId: string,
    ) => Policy.Policy<TeamNotFound | HttpApiError.Forbidden, CurrentUser>;
    readonly canSetMemberRole: (
      teamId: string,
      targetUserId: string,
      nextRole: Exclude<TeamRole, "owner">,
    ) => Policy.Policy<TeamNotFound | HttpApiError.Forbidden, CurrentUser>;
    readonly canRemoveMember: (
      teamId: string,
      targetUserId: string,
    ) => Policy.Policy<TeamNotFound | HttpApiError.Forbidden, CurrentUser>;
  }
>()("macrograph/cloudflare/TeamPolicy") {}

export const layer = Layer.effect(Service)(
  Effect.gen(function* () {
    const database = yield* Database.Service;

    const resolveActor = (teamId: string) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const rows = yield* database
          .select()
          .from(teamMemberships)
          .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, user.id)))
          .limit(1)
          .pipe(Effect.orDie);
        const membership = rows[0];
        if (membership === undefined) return yield* new TeamNotFound();
        return membership;
      });

    return {
      canView: (teamId: string) => resolveActor(teamId).pipe(Effect.asVoid),
      canManage: (teamId: string) =>
        Policy.policy(() =>
          resolveActor(teamId).pipe(Effect.map((actor) => canAdministerTeam(actor.role))),
        ).pipe(Effect.catchTag("PolicyDenied", () => new HttpApiError.Forbidden())),
      canSetMemberRole: (
        teamId: string,
        targetUserId: string,
        nextRole: Exclude<TeamRole, "owner">,
      ) =>
        Policy.policy(() =>
          Effect.gen(function* () {
            const actor = yield* resolveActor(teamId);
            const targets = yield* database
              .select()
              .from(teamMemberships)
              .where(
                and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, targetUserId)),
              )
              .limit(1)
              .pipe(Effect.orDie);
            return canSetMemberRole(actor.role, targets[0]?.role, nextRole);
          }),
        ).pipe(Effect.catchTag("PolicyDenied", () => new HttpApiError.Forbidden())),
      canRemoveMember: (teamId: string, targetUserId: string) =>
        Policy.policy(() =>
          Effect.gen(function* () {
            const actor = yield* resolveActor(teamId);
            const targets = yield* database
              .select()
              .from(teamMemberships)
              .where(
                and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, targetUserId)),
              )
              .limit(1)
              .pipe(Effect.orDie);
            return canRemoveMember(actor.role, targets[0]?.role);
          }),
        ).pipe(Effect.catchTag("PolicyDenied", () => new HttpApiError.Forbidden())),
    };
  }),
);
