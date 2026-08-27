import { assert, describe, it } from "@effect/vitest";
import { EditorRpc } from "@macrograph/editor";
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
      assert.isTrue(canAccessProject("viewer", "team", false));
      assert.isFalse(canAccessProject("viewer", "restricted", false));
      assert.isTrue(canAccessProject("viewer", "restricted", true));
      assert.isTrue(canAccessProject("owner", "restricted", false));
    }),
  );

  it.effect("limits administration to owners", () =>
    Effect.sync(() => {
      assert.isTrue(canAdministerTeam("owner"));
      assert.isFalse(canAdministerTeam("viewer"));
      assert.isFalse(canAdministerTeam("member"));
    }),
  );

  it.effect("allows owner and member mutations but not viewer mutations", () =>
    Effect.sync(() => {
      assert.isTrue(canMutateProject("owner"));
      assert.isTrue(canMutateProject("member"));
      assert.isFalse(canMutateProject("viewer"));
    }),
  );

  it.effect("scopes project credentials to a project creator with write access", () =>
    Effect.sync(() => {
      assert.isTrue(canManageProjectCredentials("owner", "creator", "creator"));
      assert.isTrue(canManageProjectCredentials("member", "creator", "creator"));
      assert.isFalse(canManageProjectCredentials("viewer", "creator", "creator"));
      assert.isFalse(canManageProjectCredentials("member", "creator", "collaborator"));
      assert.isFalse(canManageProjectCredentials("owner", "creator", "collaborator"));
    }),
  );

  it.effect("only lets owners assign member and viewer roles without modifying owners", () =>
    Effect.sync(() => {
      assert.isTrue(canSetMemberRole("owner", "member", "viewer"));
      assert.isTrue(canSetMemberRole("owner", "viewer", "member"));
      assert.isFalse(canSetMemberRole("owner", "owner", "member"));
      assert.isFalse(canSetMemberRole("viewer", "member", "member"));
      assert.isFalse(canSetMemberRole("member", "viewer", "member"));
      assert.isFalse(canSetMemberRole("member", "member", "member"));
      assert.isTrue(canSetMemberRole("owner", undefined, "member"));
      assert.isTrue(canSetMemberRole("owner", undefined, "viewer"));
      assert.isFalse(canSetMemberRole("viewer", undefined, "member"));
      assert.isFalse(canSetMemberRole("member", undefined, "member"));
    }),
  );

  it.effect("only lets owners remove non-owner memberships", () =>
    Effect.sync(() => {
      assert.isTrue(canRemoveMember("owner", "member"));
      assert.isTrue(canRemoveMember("owner", "viewer"));
      assert.isFalse(canRemoveMember("member", "viewer"));
      assert.isFalse(canRemoveMember("viewer", "member"));
      assert.isFalse(canRemoveMember("owner", "owner"));
      assert.isFalse(canRemoveMember("member", "member"));
      assert.isFalse(canRemoveMember("owner", undefined));
      assert.isFalse(canRemoveMember("viewer", undefined));
    }),
  );

  it.effect("authorizes all editor RPCs according to team write and credential permissions", () =>
    Effect.gen(function* () {
      for (const role of ["owner", "member", "viewer"] as const) {
        const identity = {
          actor: { type: "CLIENT" as const, id: role },
          connectionId: role,
          displayName: role,
          projectId: "project",
          canEdit: canMutateProject(role),
          canManageCredentials: canManageProjectCredentials(role, "creator", "collaborator"),
        };
        for (const operation of EditorRpc.EditorRpcs.requests.keys()) {
          const credentials = [
            "RefetchCredentials",
            "StartCredentialAuth",
            "PollCredentialAuth",
            "DisconnectCredentialAuth",
          ].includes(operation);
          if (credentials || (role === "viewer" && EditorRpc.requiresWriteAccess(operation))) {
            const error = yield* Effect.flip(EditorRpc.authorize(identity, operation));
            assert.strictEqual(error.operation, operation);
          } else {
            yield* EditorRpc.authorize(identity, operation);
          }
        }
      }
    }),
  );
});
