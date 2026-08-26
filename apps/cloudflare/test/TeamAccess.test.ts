import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  canAccessProject,
  canAdministerTeam,
  canManageProjectCredentials,
  canMutateProject,
  canRemoveMember,
  canSetMemberRole,
} from "../src/team/TeamAccess.ts";

describe("TeamAccess", () => {
  it.effect("applies team and restricted project access", () =>
    Effect.sync(() => {
      assert.isTrue(canAccessProject("member", "team", false));
      assert.isFalse(canAccessProject("member", "restricted", false));
      assert.isTrue(canAccessProject("member", "restricted", true));
      assert.isTrue(canAccessProject("admin", "restricted", false));
      assert.isTrue(canAccessProject("owner", "restricted", false));
    }),
  );

  it.effect("limits administration to owners and admins", () =>
    Effect.sync(() => {
      assert.isTrue(canAdministerTeam("owner"));
      assert.isTrue(canAdministerTeam("admin"));
      assert.isFalse(canAdministerTeam("member"));
    }),
  );

  it.effect("limits editor mutations to owners and admins", () =>
    Effect.sync(() => {
      assert.isTrue(canMutateProject("owner"));
      assert.isTrue(canMutateProject("admin"));
      assert.isFalse(canMutateProject("member"));
    }),
  );

  it.effect("scopes project credentials to an administrative project creator", () =>
    Effect.sync(() => {
      assert.isTrue(canManageProjectCredentials("owner", "creator", "creator"));
      assert.isTrue(canManageProjectCredentials("admin", "creator", "creator"));
      assert.isFalse(canManageProjectCredentials("member", "creator", "creator"));
      assert.isFalse(canManageProjectCredentials("admin", "creator", "collaborator"));
      assert.isFalse(canManageProjectCredentials("owner", "creator", "collaborator"));
    }),
  );

  it.effect("prevents admin escalation and owner modification", () =>
    Effect.sync(() => {
      assert.isTrue(canSetMemberRole("owner", "member", "admin"));
      assert.isFalse(canSetMemberRole("owner", "owner", "member"));
      assert.isTrue(canSetMemberRole("admin", "member", "member"));
      assert.isFalse(canSetMemberRole("admin", "member", "admin"));
      assert.isFalse(canSetMemberRole("admin", "admin", "member"));
      assert.isFalse(canSetMemberRole("member", "member", "member"));
      assert.isTrue(canSetMemberRole("owner", undefined, "admin"));
      assert.isTrue(canSetMemberRole("admin", undefined, "member"));
      assert.isFalse(canSetMemberRole("admin", undefined, "admin"));
      assert.isFalse(canSetMemberRole("member", undefined, "member"));
    }),
  );

  it.effect("protects owners and admins from unauthorized removal", () =>
    Effect.sync(() => {
      assert.isTrue(canRemoveMember("owner", "admin"));
      assert.isTrue(canRemoveMember("admin", "member"));
      assert.isFalse(canRemoveMember("admin", "admin"));
      assert.isFalse(canRemoveMember("owner", "owner"));
      assert.isFalse(canRemoveMember("member", "member"));
      assert.isFalse(canRemoveMember("owner", undefined));
      assert.isFalse(canRemoveMember("admin", undefined));
    }),
  );
});
