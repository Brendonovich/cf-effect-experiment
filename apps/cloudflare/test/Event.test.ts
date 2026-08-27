import type * as SqlConnection from "effect/unstable/sql/SqlConnection";

import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import { CurrentUser, ProjectNotFound } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Effect, Layer, Option, Stream } from "effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { Service as WorkerOperations } from "../src/worker/CloudWorkerOperations.ts";

import * as Database from "../src/database/Database.ts";
import { deploymentObjectKey } from "../src/deployment/DeploymentObjectKey.ts";
import * as Event from "../src/execution/Event.ts";
import * as EventPolicy from "../src/execution/EventPolicy.ts";
import * as ProjectPolicy from "../src/project/ProjectPolicy.ts";

// Keep real Drizzle builders and row mapping; stub only SQL execution.
const databaseLayer = (
  execute: (sql: string, params: ReadonlyArray<unknown>) => ReadonlyArray<ReadonlyArray<unknown>>,
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
        executeValues: (sql, params) => Effect.sync(() => execute(sql, params)),
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

const eventSql = (kind: "event" | "ingress") => {
  const table = kind === "event" ? "project_events" : "project_ingress_events";
  const ids = kind === "event" ? '"ingress_event_id", "provider_event_id"' : '"id", "event_id"';
  return `select "plugin_id", "event_type", "event_payload", ${ids}, "trace_context" from "${table}" where (("${table}"."project_id" = $1) and ("${table}"."id" = $2)) limit $3`;
};

// Deployment column/table names still use the persisted revision terminology.
const deploymentSql =
  'select "project_revisions"."id", "project_revisions"."r2_key" from "projects" inner join "project_revisions" on (("project_revisions"."id" = "projects"."current_revision_id") and ("project_revisions"."project_id" = "projects"."id")) where "projects"."id" = $1 limit $2';

describe("Event.make replay", () => {
  for (const kind of ["event", "ingress"] as const) {
    for (const ingressEventId of kind === "event" ? ["captured-ingress", null] : ["captured-id"]) {
      for (const providerEventId of ["provider-id", null]) {
        it.effect(
          `${kind}: forwards captured input with ingress ${ingressEventId} and provider ${providerEventId}`,
          () =>
            Effect.gen(function* () {
              // Noncanonical JSON and a payload over 256 KiB catch parsing/reencoding and truncation.
              const payload = `{\n "number": 1.00, "escaped": "\\u0041", "body": "${"x".repeat(300_000)}"\n}`;
              const dispatched: Array<Parameters<WorkerOperations["replayEvent"]>[0]> = [];
              const originalTrace = {
                traceId: "0123456789abcdef0123456789abcdef",
                spanId: "0123456789abcdef",
                sampled: providerEventId !== null,
                startedAt: "2026-08-27T12:00:00.000Z",
              };
              const authorized: Array<string> = [];
              let queries = 0;
              const event = yield* Event.make({
                replayEvent: (input) =>
                  Effect.gen(function* () {
                    const span = yield* Effect.currentSpan;
                    assert.strictEqual(span.name, "Event.replay");
                    assert.strictEqual(
                      Option.getOrUndefined(span.parent)?.spanId,
                      originalTrace.spanId,
                    );
                    assert.deepStrictEqual(input.traceContext, {
                      traceId: span.traceId,
                      spanId: span.spanId,
                      sampled: span.sampled,
                    });
                    dispatched.push(input);
                  }).pipe(Effect.orDie),
              }).pipe(
                Effect.provideService(EventPolicy.Service, {
                  canView: () => Effect.die("Replay must require edit permission"),
                  canEdit: (projectId) =>
                    Effect.sync(() => {
                      authorized.push(projectId);
                    }),
                }),
                Effect.provide(
                  databaseLayer((sql, params) => {
                    const replayNumber = Math.floor(queries / 2) + 1;
                    assert.strictEqual(authorized.length, replayNumber);
                    if (queries++ % 2 === 0) {
                      assert.strictEqual(sql, eventSql(replayNumber === 1 ? kind : "event"));
                      assert.deepStrictEqual(params, [
                        "project",
                        replayNumber === 1 ? "captured-id" : dispatched[0]!.projectEventId,
                        1,
                      ]);
                      return [
                        [
                          "captured-plugin",
                          "captured-type",
                          payload,
                          ingressEventId,
                          providerEventId,
                          replayNumber === 1 ? originalTrace : dispatched[0]!.eventTraceContext,
                        ],
                      ];
                    }
                    assert.strictEqual(sql, deploymentSql);
                    assert.deepStrictEqual(params, ["project", 1]);
                    const deploymentId = `current-deployment-${replayNumber}`;
                    return [[deploymentId, deploymentObjectKey("project", deploymentId)]];
                  }),
                ),
              );

              const ids = new Set<string>();
              const spanIds = new Set<string>();
              for (const replayNumber of [1, 2]) {
                const parentSpan = yield* Effect.currentSpan;
                const result = yield* event.replay(
                  "project",
                  replayNumber === 1 ? "captured-id" : dispatched[0]!.projectEventId,
                  replayNumber === 1 ? kind : "event",
                );
                const input = dispatched[replayNumber - 1];
                assert.isDefined(input);
                assert.deepStrictEqual(result, {
                  executionId: input.executionId,
                  projectEventId: input.projectEventId,
                  deploymentId: `current-deployment-${replayNumber}`,
                });
                assert.deepStrictEqual(input, {
                  executionId: result.executionId,
                  projectEventId: result.projectEventId,
                  projectId: "project",
                  deploymentId: result.deploymentId,
                  r2Key: deploymentObjectKey("project", result.deploymentId),
                  source: "replay",
                  pluginId: "captured-plugin",
                  eventType: "captured-type",
                  event: payload,
                  ...(ingressEventId === null ? {} : { ingressEventId }),
                  ...(providerEventId === null ? {} : { providerEventId }),
                  traceContext: input.traceContext,
                  eventTraceContext: originalTrace,
                });
                assert.match(input.traceContext?.traceId ?? "", /^[0-9a-f]{32}$/);
                assert.isDefined(input.traceContext);
                assert.notStrictEqual(input.traceContext.traceId, parentSpan.traceId);
                assert.strictEqual(input.traceContext.traceId, originalTrace.traceId);
                assert.notStrictEqual(input.traceContext.spanId, originalTrace.spanId);
                assert.isFalse(spanIds.has(input.traceContext.spanId));
                spanIds.add(input.traceContext.spanId);
                assert.match(input.traceContext?.spanId ?? "", /^[0-9a-f]{16}$/);
                assert.isBoolean(input.traceContext?.sampled);
                assert.strictEqual(input.traceContext.sampled, originalTrace.sampled);
                for (const id of [result.executionId, result.projectEventId]) {
                  assert.match(
                    id,
                    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
                  );
                  assert.notStrictEqual(id, "captured-id");
                  assert.isFalse(ids.has(id));
                  ids.add(id);
                }
              }
              assert.strictEqual(queries, 4);
              assert.strictEqual(dispatched.length, 2);
              assert.deepStrictEqual(authorized, ["project", "project"]);
            }).pipe(
              Effect.withSpan("Replay request"),
              Effect.provideService(CurrentUser, { id: "editor", sessionId: undefined }),
            ),
        );
      }
    }

    it.effect(`${kind}: missing historical trace context starts a new replay trace`, () =>
      Effect.gen(function* () {
        const requestSpan = yield* Effect.currentSpan;
        let dispatched = false;
        const event = yield* Event.make({
          replayEvent: (input) =>
            Effect.gen(function* () {
              const span = yield* Effect.currentSpan;
              assert.isTrue(Option.isNone(span.parent));
              assert.notStrictEqual(span.traceId, requestSpan.traceId);
              assert.deepStrictEqual(input.traceContext, {
                traceId: span.traceId,
                spanId: span.spanId,
                sampled: span.sampled,
              });
              assert.isDefined(input.eventTraceContext);
              assert.deepStrictEqual(input.eventTraceContext, {
                ...input.traceContext,
                startedAt: input.eventTraceContext.startedAt,
              });
              assert.match(input.eventTraceContext.startedAt, /^\d{4}-\d{2}-\d{2}T/);
              dispatched = true;
            }).pipe(Effect.orDie),
        }).pipe(
          Effect.provideService(EventPolicy.Service, {
            canView: () => Effect.die("Replay must require edit permission"),
            canEdit: () => Effect.void,
          }),
          Effect.provide(
            databaseLayer((sql) => {
              if (sql === eventSql(kind)) return [["plugin", "type", "{}", null, null, null]];
              assert.strictEqual(sql, deploymentSql);
              return [["deployment", deploymentObjectKey("project", "deployment")]];
            }),
          ),
        );
        yield* event.replay("project", "historical-event", kind);
        assert.isTrue(dispatched);
      }).pipe(
        Effect.withSpan("Replay request"),
        Effect.provideService(CurrentUser, { id: "editor", sessionId: undefined }),
      ),
    );

    for (const missing of ["event", "deployment"] as const) {
      it.effect(`${kind}: missing ${missing} fails without dispatch`, () =>
        Effect.gen(function* () {
          let queries = 0;
          let dispatches = 0;
          const event = yield* Event.make({
            replayEvent: () =>
              Effect.sync(() => {
                dispatches++;
              }),
          }).pipe(
            Effect.provideService(EventPolicy.Service, {
              canView: () => Effect.die("Replay must require edit permission"),
              canEdit: () => Effect.void,
            }),
            Effect.provide(
              databaseLayer((sql, params) => {
                if (queries++ === 0) {
                  assert.strictEqual(sql, eventSql(kind));
                  assert.deepStrictEqual(params, [
                    "requested-project",
                    "other-project-or-missing-event",
                    1,
                  ]);
                  return missing === "event" ? [] : [["plugin", "type", "{}", null, null, null]];
                }
                assert.strictEqual(queries, 2);
                assert.strictEqual(sql, deploymentSql);
                assert.deepStrictEqual(params, ["requested-project", 1]);
                return [];
              }),
            ),
          );
          const error = yield* Effect.flip(
            event.replay("requested-project", "other-project-or-missing-event", kind),
          );
          assert.strictEqual(
            error._tag,
            missing === "event" ? "EventNotFound" : "DeploymentNotFound",
          );
          assert.strictEqual(queries, missing === "event" ? 1 : 2);
          assert.strictEqual(dispatches, 0);
        }).pipe(Effect.provideService(CurrentUser, { id: "editor", sessionId: undefined })),
      );
    }

    it.effect(`${kind}: denied edit permission prevents queries even when view is allowed`, () =>
      Effect.gen(function* () {
        let queries = 0;
        let dispatches = 0;
        const denied = new ProjectNotFound();
        const authorized: Array<string> = [];
        const event = yield* Event.make({
          replayEvent: () =>
            Effect.sync(() => {
              dispatches++;
            }),
        }).pipe(
          Effect.provideService(EventPolicy.Service, {
            canView: () => Effect.void,
            canEdit: (projectId) =>
              Effect.gen(function* () {
                authorized.push(projectId);
                return yield* denied;
              }),
          }),
          Effect.provide(
            databaseLayer(() => {
              queries++;
              return [];
            }),
          ),
        );
        const error = yield* Effect.flip(event.replay("project", "captured-id", kind));
        assert.strictEqual(error, denied);
        assert.deepStrictEqual(authorized, ["project"]);
        assert.strictEqual(queries, 0);
        assert.strictEqual(dispatches, 0);
      }).pipe(Effect.provideService(CurrentUser, { id: "viewer", sessionId: undefined })),
    );
  }
});

describe("EventPolicy.layer", () => {
  for (const allowed of [true, false]) {
    it.effect(`delegates ${allowed ? "allowed" : "denied"} edits to ProjectPolicy.canEdit`, () =>
      Effect.gen(function* () {
        const denied = new ProjectNotFound();
        const checked: Array<string> = [];
        const canView = () => Effect.void;
        const canEdit = (projectId: string) =>
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            assert.strictEqual(user.id, "current-user");
            checked.push(projectId);
            if (!allowed) return yield* denied;
          });
        const policy = yield* EventPolicy.Service.pipe(
          Effect.provide(
            EventPolicy.layer.pipe(
              Layer.provide(
                Layer.succeed(ProjectPolicy.Service, {
                  canView,
                  canEdit,
                  canManage: () => Effect.die("Unexpected manage policy"),
                }),
              ),
            ),
          ),
        );
        assert.strictEqual(policy.canView, canView);
        assert.strictEqual(policy.canEdit, canEdit);
        yield* policy.canView("project");
        let executed = false;
        const edit = Effect.sync(() => {
          executed = true;
        }).pipe(Policy.withPolicy(policy.canEdit("project")));
        if (allowed) yield* edit;
        else assert.strictEqual(yield* Effect.flip(edit), denied);
        assert.strictEqual(executed, allowed);
        assert.deepStrictEqual(checked, ["project"]);
      }).pipe(Effect.provideService(CurrentUser, { id: "current-user", sessionId: undefined })),
    );
  }
});
