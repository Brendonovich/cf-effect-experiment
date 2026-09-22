import type * as SqlConnection from "effect/unstable/sql/SqlConnection";

import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import { CurrentUser } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Effect, Layer, Ref, Stream } from "effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as Database from "../src/database/Database.ts";
import * as ProjectPolicy from "../src/project/ProjectPolicy.ts";
import * as TeamPolicy from "../src/team/TeamPolicy.ts";

// Keep the real Drizzle query builders and row mapping; stub only SQL execution.
const databaseLayer = (
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  expectedParams: ReadonlyArray<unknown>,
) =>
  Layer.effect(Database.Service)(
    Effect.gen(function* () {
      const unsupported = () => Effect.die("Unexpected SQL operation");
      const connection: SqlConnection.Connection = {
        execute: unsupported,
        executeRaw: unsupported,
        executeUnprepared: unsupported,
        executeValuesUnprepared: unsupported,
        executeStream: () => Stream.die("Unexpected SQL stream"),
        executeValues: (_sql, params) =>
          Effect.sync(() => {
            assert.deepStrictEqual(params, expectedParams);
            return rows;
          }),
      };
      const sql = yield* SqlClient.make({
        acquirer: Effect.succeed(connection),
        compiler: PgClient.makeCompiler(),
        spanAttributes: [],
      });
      const client: PgClient.PgClient = Object.assign(sql, {
        [PgClient.TypeId]: PgClient.TypeId,
        config: {},
        json: () => {
          throw new Error("Unexpected SQL JSON parameter");
        },
        listen: () => Stream.die("Unexpected SQL listener"),
        notify: unsupported,
      });
      return yield* PgDrizzle.makeWithDefaults().pipe(
        Effect.provideService(PgClient.PgClient, client),
      );
    }),
  ).pipe(Layer.provide(Reactivity.layer));

describe("ProjectPolicy.layer", () => {
  for (const role of ["owner", "member", "viewer"] as const) {
    for (const { access, grant, canView, canEdit } of [
      { access: "team", grant: false, canView: true, canEdit: role !== "viewer" },
      { access: "restricted", grant: true, canView: true, canEdit: role !== "viewer" },
      {
        access: "restricted",
        grant: false,
        canView: role === "owner",
        canEdit: role === "owner",
      },
    ] as const) {
      it.effect(`${role}: ${access} project ${grant ? "with" : "without"} a grant`, () =>
        Effect.gen(function* () {
          const policy = yield* ProjectPolicy.Service;
          for (const [guard, allowed, errorTag] of [
            [policy.canView("project"), canView, "ProjectNotFound"],
            [policy.canEdit("project"), canEdit, "ProjectNotFound"],
            [policy.canManage("project"), role === "owner", "Forbidden"],
          ] as const) {
            const executed = yield* Ref.make(false);
            const protectedEffect = Ref.set(executed, true).pipe(Policy.withPolicy(guard));
            if (allowed) {
              yield* protectedEffect;
            } else {
              const error = yield* Effect.flip(protectedEffect);
              assert.strictEqual(error._tag, errorTag);
            }
            assert.strictEqual(yield* Ref.get(executed), allowed);
          }
        }).pipe(
          Effect.provideService(CurrentUser, { id: role, sessionId: undefined }),
          Effect.provide(
            ProjectPolicy.layer.pipe(
              Layer.provide(
                databaseLayer(
                  [
                    [
                      "project",
                      "team",
                      "creator",
                      access,
                      "Project",
                      null,
                      "2026-08-27T00:00:00.000Z",
                      "2026-08-27T00:00:00.000Z",
                      role,
                      grant ? role : null,
                    ],
                  ],
                  [role, role, "project", 1],
                ),
              ),
            ),
          ),
        ),
      );
    }
  }

  it.effect("conceals projects when the project/membership join returns no row", () =>
    Effect.gen(function* () {
      const policy = yield* ProjectPolicy.Service;
      for (const guard of [
        policy.canView("project"),
        policy.canEdit("project"),
        policy.canManage("project"),
      ]) {
        const error = yield* Effect.flip(guard);
        assert.strictEqual(error._tag, "ProjectNotFound");
      }
    }).pipe(
      Effect.provideService(CurrentUser, { id: "outsider", sessionId: undefined }),
      Effect.provide(
        ProjectPolicy.layer.pipe(
          Layer.provide(databaseLayer([], ["outsider", "outsider", "project", 1])),
        ),
      ),
    ),
  );
});

describe("TeamPolicy.layer canEdit", () => {
  for (const role of ["owner", "member", "viewer"] as const) {
    it.effect(`${role === "viewer" ? "denies" : "allows"} ${role} mutations`, () =>
      Effect.gen(function* () {
        const policy = yield* TeamPolicy.Service;
        const executed = yield* Ref.make(false);
        const edit = Ref.set(executed, true).pipe(Policy.withPolicy(policy.canEdit("team")));
        if (role === "viewer") {
          const error = yield* Effect.flip(edit);
          assert.strictEqual(error._tag, "Forbidden");
        } else {
          yield* edit;
        }
        assert.strictEqual(yield* Ref.get(executed), role !== "viewer");
      }).pipe(
        Effect.provideService(CurrentUser, { id: role, sessionId: undefined }),
        Effect.provide(
          TeamPolicy.layer.pipe(
            Layer.provide(
              databaseLayer([["team", role, role, "2026-08-27T00:00:00.000Z"]], ["team", role, 1]),
            ),
          ),
        ),
      ),
    );
  }

  it.effect("conceals teams from non-members", () =>
    Effect.gen(function* () {
      const policy = yield* TeamPolicy.Service;
      const error = yield* Effect.flip(policy.canEdit("team"));
      assert.strictEqual(error._tag, "TeamNotFound");
    }).pipe(
      Effect.provideService(CurrentUser, { id: "outsider", sessionId: undefined }),
      Effect.provide(
        TeamPolicy.layer.pipe(Layer.provide(databaseLayer([], ["team", "outsider", 1]))),
      ),
    ),
  );
});
