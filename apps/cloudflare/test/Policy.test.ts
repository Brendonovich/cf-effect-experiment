import { assert, describe, it } from "@effect/vitest";
import { CurrentUser, ProjectNotFound, TeamNotFound } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { Effect, Layer, Ref } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";

import * as CredentialPolicy from "../src/auth/CredentialPolicy.ts";
import * as DeploymentPolicy from "../src/deployment/DeploymentPolicy.ts";
import * as EventPolicy from "../src/execution/EventPolicy.ts";
import * as ProjectPolicy from "../src/project/ProjectPolicy.ts";
import * as TeamPolicy from "../src/team/TeamPolicy.ts";

describe("Policy", () => {
  it.effect("allows the protected effect when its predicate succeeds", () =>
    Effect.gen(function* () {
      const value = yield* Effect.succeed("protected").pipe(
        Policy.withPolicy(Policy.policy(() => Effect.succeed(true))),
      );

      assert.strictEqual(value, "protected");
    }),
  );

  it.effect("denies access before running protected side effects", () =>
    Effect.gen(function* () {
      const executed = yield* Ref.make(false);
      const denial = yield* Effect.flip(
        Ref.set(executed, true).pipe(Policy.withPolicy(Policy.policy(() => Effect.succeed(false)))),
      );

      assert.strictEqual(denial._tag, "PolicyDenied");
      assert.isFalse(yield* Ref.get(executed));
    }),
  );

  it.effect("preserves predicate and protected-effect failures", () =>
    Effect.gen(function* () {
      const predicateFailure = yield* Effect.flip(
        Effect.succeed("protected").pipe(
          Policy.withPolicy(Policy.policy(() => Effect.fail("predicate failed"))),
        ),
      );
      const operationFailure = yield* Effect.flip(
        Effect.fail("operation failed").pipe(
          Policy.withPolicy(Policy.policy(() => Effect.succeed(true))),
        ),
      );

      assert.strictEqual(predicateFailure, "predicate failed");
      assert.strictEqual(operationFailure, "operation failed");
    }),
  );

  it.effect("resolves the current user each time a contextual policy runs", () =>
    Effect.gen(function* () {
      const guard = Policy.policy(() => Effect.map(CurrentUser, (user) => user.id === "alice"));
      const protectedEffect = Effect.succeed("protected").pipe(Policy.withPolicy(guard));

      const allowed = yield* protectedEffect.pipe(
        Effect.provideService(CurrentUser, { id: "alice", sessionId: undefined }),
      );
      const denied = yield* Effect.flip(
        protectedEffect.pipe(
          Effect.provideService(CurrentUser, { id: "bob", sessionId: undefined }),
        ),
      );

      assert.strictEqual(allowed, "protected");
      assert.strictEqual(denied._tag, "PolicyDenied");
    }),
  );

  it.effect("preserves project concealment and administrative denial errors", () =>
    Effect.gen(function* () {
      const credentialPolicy = yield* CredentialPolicy.Service;
      const projectPolicy = yield* ProjectPolicy.Service;
      const teamPolicy = yield* TeamPolicy.Service;
      const accessDenial = yield* Effect.flip(
        Effect.void.pipe(Policy.withPolicy(projectPolicy.canView("project"))),
      );
      const projectDenial = yield* Effect.flip(
        Effect.void.pipe(Policy.withPolicy(projectPolicy.canEdit("project"))),
      );
      const teamDenial = yield* Effect.flip(
        Effect.void.pipe(Policy.withPolicy(teamPolicy.canManage("team"))),
      );
      const roleDenial = yield* Effect.flip(
        Effect.void.pipe(
          Policy.withPolicy(teamPolicy.canSetMemberRole("team", "target", "member")),
        ),
      );
      const credentialDenial = yield* Effect.flip(
        Effect.void.pipe(Policy.withPolicy(credentialPolicy.canManage("project"))),
      );

      assert.strictEqual(accessDenial._tag, "ProjectNotFound");
      assert.strictEqual(projectDenial._tag, "ProjectNotFound");
      assert.strictEqual(teamDenial._tag, "Forbidden");
      assert.strictEqual(roleDenial._tag, "Forbidden");
      assert.strictEqual(credentialDenial._tag, "Forbidden");
    }).pipe(
      Effect.provideService(CurrentUser, { id: "creator", sessionId: undefined }),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(CredentialPolicy.Service, {
            canView: () => new ProjectNotFound(),
            canEdit: () => new ProjectNotFound(),
            canManage: () => new HttpApiError.Forbidden(),
          }),
          Layer.succeed(TeamPolicy.Service, {
            canView: () => Effect.void,
            canEdit: () => new HttpApiError.Forbidden(),
            canManage: () => new HttpApiError.Forbidden(),
            canSetMemberRole: () => new HttpApiError.Forbidden(),
            canRemoveMember: () => new HttpApiError.Forbidden(),
          }),
          Layer.succeed(ProjectPolicy.Service, {
            canView: () => new ProjectNotFound(),
            canEdit: () => new ProjectNotFound(),
            canManage: () => Effect.void,
          }),
        ),
      ),
    ),
  );

  it.effect("evaluates resource policy guards against each request's current user", () =>
    Effect.gen(function* () {
      const teamPolicy = yield* TeamPolicy.Service;
      const credentialPolicy = yield* CredentialPolicy.Service;
      const viewTeam = Effect.succeed("team").pipe(Policy.withPolicy(teamPolicy.canView("team")));
      const manageTeam = Effect.succeed("team").pipe(
        Policy.withPolicy(teamPolicy.canManage("team")),
      );
      const setRole = Effect.succeed("role").pipe(
        Policy.withPolicy(teamPolicy.canSetMemberRole("team", "target", "member")),
      );
      const removeMember = Effect.succeed("removed").pipe(
        Policy.withPolicy(teamPolicy.canRemoveMember("team", "target")),
      );
      const manageCredentials = Effect.succeed("credentials").pipe(
        Policy.withPolicy(credentialPolicy.canManage("project")),
      );

      for (const protectedEffect of [manageTeam, setRole, removeMember, manageCredentials]) {
        yield* protectedEffect.pipe(
          Effect.provideService(CurrentUser, { id: "alice", sessionId: undefined }),
        );

        const denial = yield* Effect.flip(
          protectedEffect.pipe(
            Effect.provideService(CurrentUser, { id: "bob", sessionId: undefined }),
          ),
        );

        assert.strictEqual(denial._tag, "Forbidden");
      }

      yield* viewTeam.pipe(
        Effect.provideService(CurrentUser, { id: "alice", sessionId: undefined }),
      );
      const hiddenTeam = yield* Effect.flip(
        viewTeam.pipe(Effect.provideService(CurrentUser, { id: "bob", sessionId: undefined })),
      );
      const missingTeam = yield* Effect.flip(
        Effect.void.pipe(
          Policy.withPolicy(teamPolicy.canManage("missing")),
          Effect.provideService(CurrentUser, { id: "alice", sessionId: undefined }),
        ),
      );
      const missingProject = yield* Effect.flip(
        Effect.void.pipe(
          Policy.withPolicy(credentialPolicy.canManage("missing")),
          Effect.provideService(CurrentUser, { id: "alice", sessionId: undefined }),
        ),
      );

      assert.strictEqual(hiddenTeam._tag, "TeamNotFound");
      assert.strictEqual(missingTeam._tag, "TeamNotFound");
      assert.strictEqual(missingProject._tag, "ProjectNotFound");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(TeamPolicy.Service, {
            canEdit: () => Effect.void,
            canView: (teamId) =>
              Policy.policy(() =>
                Effect.map(CurrentUser, (user) => user.id === "alice" && teamId === "team"),
              ).pipe(Effect.mapError(() => new TeamNotFound())),
            canManage: (teamId) =>
              teamId === "missing"
                ? new TeamNotFound()
                : Policy.policy(() => Effect.map(CurrentUser, (user) => user.id === "alice")).pipe(
                    Effect.mapError(() => new HttpApiError.Forbidden()),
                  ),
            canSetMemberRole: (teamId, targetUserId, nextRole) =>
              Policy.policy(() =>
                Effect.map(
                  CurrentUser,
                  (user) =>
                    user.id === "alice" &&
                    teamId === "team" &&
                    targetUserId === "target" &&
                    nextRole === "member",
                ),
              ).pipe(Effect.mapError(() => new HttpApiError.Forbidden())),
            canRemoveMember: (teamId, targetUserId) =>
              Policy.policy(() =>
                Effect.map(
                  CurrentUser,
                  (user) => user.id === "alice" && teamId === "team" && targetUserId === "target",
                ),
              ).pipe(Effect.mapError(() => new HttpApiError.Forbidden())),
          }),
          Layer.succeed(CredentialPolicy.Service, {
            canView: () => Effect.void,
            canEdit: () => Effect.void,
            canManage: (projectId) =>
              projectId === "missing"
                ? new ProjectNotFound()
                : Policy.policy(() => Effect.map(CurrentUser, (user) => user.id === "alice")).pipe(
                    Effect.mapError(() => new HttpApiError.Forbidden()),
                  ),
          }),
        ),
      ),
    ),
  );

  it.effect("allows domain policy layers to be overridden", () =>
    Effect.gen(function* () {
      const projectPolicy = yield* ProjectPolicy.Service;
      const value = yield* Effect.succeed("protected").pipe(
        Policy.withPolicy(projectPolicy.canEdit("project")),
      );

      assert.strictEqual(value, "protected");
    }).pipe(
      Effect.provideService(CurrentUser, { id: "creator", sessionId: undefined }),
      Effect.provide(
        Layer.succeed(ProjectPolicy.Service, {
          canView: () => Effect.void,
          canEdit: () => Effect.void,
          canManage: () => Effect.void,
        }),
      ),
    ),
  );

  it.effect("derives deployment and event policies from the injected project policy", () =>
    Effect.gen(function* () {
      const deploymentPolicy = yield* DeploymentPolicy.Service;
      const eventPolicy = yield* EventPolicy.Service;
      const deploymentDenial = yield* Effect.flip(
        Effect.succeed("deployment").pipe(Policy.withPolicy(deploymentPolicy.canEdit("project"))),
      );
      const eventDenial = yield* Effect.flip(
        Effect.succeed("event").pipe(Policy.withPolicy(eventPolicy.canView("denied"))),
      );
      const viewed = yield* Effect.succeed("protected").pipe(
        Policy.withPolicy(deploymentPolicy.canView("project")),
      );

      assert.strictEqual(deploymentDenial._tag, "ProjectNotFound");
      assert.strictEqual(eventDenial._tag, "ProjectNotFound");
      assert.strictEqual(viewed, "protected");
    }).pipe(
      Effect.provideService(CurrentUser, { id: "creator", sessionId: undefined }),
      Effect.provide(
        Layer.mergeAll(DeploymentPolicy.layer, EventPolicy.layer).pipe(
          Layer.provide(
            Layer.succeed(ProjectPolicy.Service, {
              canView: (projectId) =>
                projectId === "project" ? Effect.void : new ProjectNotFound(),
              canEdit: () => new ProjectNotFound(),
              canManage: () => Effect.void,
            }),
          ),
        ),
      ),
    ),
  );
});
