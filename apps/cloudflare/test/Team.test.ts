import type * as SqlConnection from "effect/unstable/sql/SqlConnection";

import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import { CurrentUser } from "@macrograph/cloud-api";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Effect, Exit, Layer, Stream } from "effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { vi } from "vitest";

import * as Database from "../src/database/Database.ts";
import * as Team from "../src/team/Team.ts";
import * as TeamPolicy from "../src/team/TeamPolicy.ts";

vi.mock("../src/editor/ProjectEditorDO.ts", async () => {
  const { Effect } = await import("effect");
  return {
    default: Effect.succeed({
      getByName: () => {
        throw new Error("Unexpected project editor access");
      },
    }),
  };
});

const createdAt = "2026-08-27T00:00:00.000Z";
const owner = [["team", "owner", "owner", createdAt]];

const testLayer = (
  queries: ReadonlyArray<{
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
    readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  }>,
) => {
  const database = Layer.effect(Database.Service)(
    Effect.gen(function* () {
      let index = 0;
      yield* Effect.addFinalizer((exit) =>
        Effect.sync(() => {
          if (Exit.isSuccess(exit)) assert.strictEqual(index, queries.length);
        }),
      );
      const unsupported = () => Effect.die("Unexpected SQL operation");
      const execute: SqlConnection.Connection["executeValues"] = (sql, params) =>
        Effect.sync(() => {
          const query = queries[index++];
          if (query === undefined) throw new Error(`Unexpected query: ${sql}`);
          assert.include(sql, query.sql);
          assert.deepStrictEqual(params, query.params);
          return query.rows;
        });
      const connection: SqlConnection.Connection = {
        execute: (sql, params) => execute(sql, params).pipe(Effect.as([])),
        executeRaw: execute,
        executeUnprepared: unsupported,
        executeValuesUnprepared: unsupported,
        executeStream: () => Stream.die("Unexpected SQL stream"),
        executeValues: execute,
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

  return Team.layer.pipe(
    Layer.provide(Layer.mergeAll(database, TeamPolicy.layer.pipe(Layer.provide(database)))),
  );
};

describe("Team email membership", () => {
  it.effect("lists emails while retaining members whose email has not been populated", () =>
    Effect.gen(function* () {
      const team = yield* Team.Service;
      assert.deepStrictEqual(yield* team.listMembers("team"), {
        members: [
          { userId: "owner", email: "owner@example.com", role: "owner", createdAt },
          { userId: "legacy", email: null, role: "viewer", createdAt },
        ],
      });
    }).pipe(
      Effect.provideService(CurrentUser, { id: "owner", sessionId: undefined }),
      Effect.provide(
        testLayer([
          { sql: 'from "team_memberships"', params: ["team", "owner", 1], rows: owner },
          {
            sql: 'inner join "users"',
            params: ["team"],
            rows: [
              ["owner", "owner@example.com", "owner", createdAt],
              ["legacy", null, "viewer", createdAt],
            ],
          },
        ]),
      ),
    ),
  );

  for (const role of ["member", "viewer"] as const) {
    it.effect(`resolves a trimmed, case-insensitive email to a user ID for the ${role} role`, () =>
      Effect.gen(function* () {
        const team = yield* Team.Service;
        assert.deepStrictEqual(yield* team.addMember("team", "  Member@Example.COM  ", role), {
          member: { userId: "target", email: "member@example.com", role, createdAt },
        });
      }).pipe(
        Effect.provideService(CurrentUser, { id: "owner", sessionId: undefined }),
        Effect.provide(
          testLayer([
            { sql: 'from "team_memberships"', params: ["team", "owner", 1], rows: owner },
            {
              sql: 'where "users"."email" =',
              params: ["member@example.com", 1],
              rows: [["target"]],
            },
            { sql: 'from "team_memberships"', params: ["team", "owner", 1], rows: owner },
            { sql: 'from "team_memberships"', params: ["team", "owner", 1], rows: owner },
            {
              sql: 'from "team_memberships"',
              params: ["team", "target", 1],
              rows: [["team", "target", "member", createdAt]],
            },
            {
              sql: 'from "users"',
              params: ["target", 1],
              rows: [["target", "member@example.com"]],
            },
            {
              sql: 'from "team_memberships"',
              params: ["team", "target", 1],
              rows: [["team", "target", "member", createdAt]],
            },
            {
              sql: 'insert into "team_memberships"',
              params: ["team", "target", role, createdAt, role],
              rows: [],
            },
            { sql: 'from "projects"', params: ["team"], rows: [] },
          ]),
        ),
      ),
    );
  }

  it.effect("returns UserNotFound without writing a membership for an unknown email", () =>
    Effect.gen(function* () {
      const team = yield* Team.Service;
      const error = yield* Effect.flip(team.addMember("team", "missing@example.com", "member"));
      assert.strictEqual(error._tag, "UserNotFound");
    }).pipe(
      Effect.provideService(CurrentUser, { id: "owner", sessionId: undefined }),
      Effect.provide(
        testLayer([
          { sql: 'from "team_memberships"', params: ["team", "owner", 1], rows: owner },
          { sql: 'where "users"."email" =', params: ["missing@example.com", 1], rows: [] },
        ]),
      ),
    ),
  );

  it.effect("denies non-owners before looking up an email", () =>
    Effect.gen(function* () {
      const team = yield* Team.Service;
      const error = yield* Effect.flip(team.addMember("team", "member@example.com", "member"));
      assert.strictEqual(error._tag, "Forbidden");
    }).pipe(
      Effect.provideService(CurrentUser, { id: "viewer", sessionId: undefined }),
      Effect.provide(
        testLayer([
          {
            sql: 'from "team_memberships"',
            params: ["team", "viewer", 1],
            rows: [["team", "viewer", "viewer", createdAt]],
          },
        ]),
      ),
    ),
  );

  it.effect("cannot change an owner's role through their email", () =>
    Effect.gen(function* () {
      const team = yield* Team.Service;
      const error = yield* Effect.flip(team.addMember("team", "owner@example.com", "viewer"));
      assert.strictEqual(error._tag, "Forbidden");
    }).pipe(
      Effect.provideService(CurrentUser, { id: "owner", sessionId: undefined }),
      Effect.provide(
        testLayer([
          { sql: 'from "team_memberships"', params: ["team", "owner", 1], rows: owner },
          { sql: 'where "users"."email" =', params: ["owner@example.com", 1], rows: [["owner"]] },
          { sql: 'from "team_memberships"', params: ["team", "owner", 1], rows: owner },
          { sql: 'from "team_memberships"', params: ["team", "owner", 1], rows: owner },
          { sql: 'from "team_memberships"', params: ["team", "owner", 1], rows: owner },
        ]),
      ),
    ),
  );
});
