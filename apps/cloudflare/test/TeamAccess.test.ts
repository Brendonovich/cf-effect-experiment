import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  canAccessProject,
  canAdministerTeam,
  canRemoveMember,
  canSetMemberRole,
} from "../src/TeamAccess.ts";

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

  it.effect("prevents admin escalation and owner modification", () =>
    Effect.sync(() => {
      assert.isTrue(canSetMemberRole("owner", "member", "admin"));
      assert.isFalse(canSetMemberRole("owner", "owner", "member"));
      assert.isTrue(canSetMemberRole("admin", "member", "member"));
      assert.isFalse(canSetMemberRole("admin", "member", "admin"));
      assert.isFalse(canSetMemberRole("admin", "admin", "member"));
      assert.isFalse(canSetMemberRole("member", "member", "member"));
    }),
  );

  it.effect("protects owners and admins from unauthorized removal", () =>
    Effect.sync(() => {
      assert.isTrue(canRemoveMember("owner", "admin"));
      assert.isTrue(canRemoveMember("admin", "member"));
      assert.isFalse(canRemoveMember("admin", "admin"));
      assert.isFalse(canRemoveMember("owner", "owner"));
      assert.isFalse(canRemoveMember("member", "member"));
    }),
  );
});
