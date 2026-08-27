import { CurrentUser, TeamNotFound, UserNotFound } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";

import * as Database from "../database/Database.ts";
import {
  projectMembers,
  projects,
  teamMemberships,
  teams,
  users,
  type TeamRole,
} from "../database/DatabaseSchema.ts";
import ProjectEditorDO from "../editor/ProjectEditorDO.ts";
import * as TeamPolicy from "./TeamPolicy.ts";

export const make = Effect.gen(function* () {
  const database = yield* Database.Service;
  const teamPolicy = yield* TeamPolicy.Service;
  const projectEditors = yield* ProjectEditorDO;

  const getMembership = (teamId: string, userId: string) =>
    Effect.gen(function* () {
      const rows = yield* database
        .select()
        .from(teamMemberships)
        .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)))
        .limit(1)
        .pipe(Effect.orDie);
      return rows[0];
    });

  const requireMembership = (teamId: string, userId: string) =>
    Effect.gen(function* () {
      const membership = yield* getMembership(teamId, userId);
      if (membership === undefined) return yield* new TeamNotFound();
      return membership;
    });

  const validateMembers = (teamId: string, userIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const uniqueUserIds = [...new Set(userIds)];
      if (uniqueUserIds.length === 0) return uniqueUserIds;
      const rows = yield* database
        .select({ userId: teamMemberships.userId })
        .from(teamMemberships)
        .where(
          and(eq(teamMemberships.teamId, teamId), inArray(teamMemberships.userId, uniqueUserIds)),
        )
        .pipe(Effect.orDie);
      if (rows.length !== uniqueUserIds.length) return yield* new HttpApiError.BadRequest();
      return uniqueUserIds;
    });

  const setMember = (teamId: string, userId: string, role: Exclude<TeamRole, "owner">) =>
    Effect.gen(function* () {
      const existingUsers = yield* database
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .pipe(Effect.orDie);
      const user = existingUsers[0];
      if (user === undefined) return yield* new UserNotFound();
      const target = yield* getMembership(teamId, userId);
      const createdAt = target?.createdAt ?? new Date().toISOString();
      yield* database
        .insert(teamMemberships)
        .values({ teamId, userId, role, createdAt })
        .onConflictDoUpdate({
          target: [teamMemberships.teamId, teamMemberships.userId],
          set: { role },
        })
        .pipe(Effect.orDie);
      const teamProjects = yield* database
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.teamId, teamId))
        .pipe(Effect.orDie);
      yield* Effect.forEach(
        teamProjects,
        (project) => projectEditors.getByName(project.id).disconnectUser(userId),
        { discard: true },
      );
      return { member: { userId, email: user.email, role, createdAt } };
    }).pipe(
      Policy.withPolicy(teamPolicy.canSetMemberRole(teamId, userId, role)),
      Policy.withPolicy(teamPolicy.canManage(teamId)),
    );

  return {
    getMembership,
    requireMembership,
    validateMembers,
    setMember,
    list: () =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const rows = yield* database
          .select({
            id: teams.id,
            name: teams.name,
            kind: teams.kind,
            personalOwnerUserId: teams.personalOwnerUserId,
            role: teamMemberships.role,
            createdAt: teams.createdAt,
            updatedAt: teams.updatedAt,
          })
          .from(teamMemberships)
          .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
          .where(eq(teamMemberships.userId, user.id))
          .orderBy(teams.name)
          .pipe(Effect.orDie);
        return { teams: rows };
      }),
    create: (name: string) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser;
        const now = new Date().toISOString();
        const team = {
          id: crypto.randomUUID(),
          name,
          kind: "shared" as const,
          personalOwnerUserId: null,
          createdAt: now,
          updatedAt: now,
        };
        yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              yield* transaction.insert(teams).values(team);
              yield* transaction.insert(teamMemberships).values({
                teamId: team.id,
                userId: user.id,
                role: "owner",
                createdAt: now,
              });
            }),
          )
          .pipe(Effect.orDie);
        return { team: { ...team, role: "owner" as const } };
      }),
    listMembers: (teamId: string) =>
      Effect.gen(function* () {
        const members = yield* database
          .select({
            userId: teamMemberships.userId,
            email: users.email,
            role: teamMemberships.role,
            createdAt: teamMemberships.createdAt,
          })
          .from(teamMemberships)
          .innerJoin(users, eq(users.id, teamMemberships.userId))
          .where(eq(teamMemberships.teamId, teamId))
          .orderBy(teamMemberships.createdAt)
          .pipe(Effect.orDie);
        return { members };
      }).pipe(Policy.withPolicy(teamPolicy.canView(teamId))),
    addMember: (teamId: string, email: string, role: Exclude<TeamRole, "owner">) =>
      Effect.gen(function* () {
        const existingUsers = yield* database
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email.trim().toLowerCase()))
          .limit(1)
          .pipe(Effect.orDie);
        const user = existingUsers[0];
        if (user === undefined) return yield* new UserNotFound();
        return yield* setMember(teamId, user.id, role);
      }).pipe(Policy.withPolicy(teamPolicy.canManage(teamId))),
    removeMember: (teamId: string, userId: string) =>
      Effect.gen(function* () {
        const teamProjects = yield* database
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.teamId, teamId))
          .pipe(Effect.orDie);
        yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              if (teamProjects.length > 0)
                yield* transaction.delete(projectMembers).where(
                  and(
                    eq(projectMembers.userId, userId),
                    inArray(
                      projectMembers.projectId,
                      teamProjects.map((project) => project.id),
                    ),
                  ),
                );
              yield* transaction
                .delete(teamMemberships)
                .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)));
            }),
          )
          .pipe(Effect.orDie);
        yield* Effect.forEach(
          teamProjects,
          (project) => projectEditors.getByName(project.id).disconnectUser(userId),
          { discard: true },
        );
      }).pipe(
        Policy.withPolicy(teamPolicy.canRemoveMember(teamId, userId)),
        Policy.withPolicy(teamPolicy.canManage(teamId)),
      ),
  };
});

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "macrograph/cloudflare/Team",
) {}

export const layer = Layer.effect(Service)(make);
