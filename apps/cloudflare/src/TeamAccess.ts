import type { ProjectAccess, TeamRole } from "./AppDatabaseSchema.ts";

export const canAccessProject = (role: TeamRole, access: ProjectAccess, hasGrant: boolean) =>
  role !== "member" || access === "team" || hasGrant;

export const canAdministerTeam = (role: TeamRole) => role === "owner" || role === "admin";

export const canSetMemberRole = (
  actorRole: TeamRole,
  targetRole: TeamRole | undefined,
  nextRole: Exclude<TeamRole, "owner">,
) =>
  actorRole === "owner"
    ? targetRole !== "owner"
    : actorRole === "admin" &&
      targetRole !== "owner" &&
      targetRole !== "admin" &&
      nextRole === "member";

export const canRemoveMember = (actorRole: TeamRole, targetRole: TeamRole | undefined) =>
  targetRole !== undefined &&
  targetRole !== "owner" &&
  (actorRole === "owner" || (actorRole === "admin" && targetRole === "member"));
