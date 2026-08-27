import type { ProjectAccess, TeamRole } from "../database/DatabaseSchema.ts";

export const canAccessProject = (role: TeamRole, access: ProjectAccess, hasGrant: boolean) =>
  role === "owner" || access === "team" || hasGrant;

export const canAdministerTeam = (role: TeamRole) => role === "owner";

export const canMutateProject = (role: TeamRole) => role === "owner" || role === "member";

export const canManageProjectCredentials = (
  role: TeamRole,
  projectCreatorId: string,
  userId: string,
) => canMutateProject(role) && projectCreatorId === userId;

export const canSetMemberRole = (
  actorRole: TeamRole,
  targetRole: TeamRole | undefined,
  nextRole: Exclude<TeamRole, "owner">,
) =>
  actorRole === "owner" &&
  targetRole !== "owner" &&
  (nextRole === "member" || nextRole === "viewer");

export const canRemoveMember = (actorRole: TeamRole, targetRole: TeamRole | undefined) =>
  targetRole !== undefined && targetRole !== "owner" && actorRole === "owner";
