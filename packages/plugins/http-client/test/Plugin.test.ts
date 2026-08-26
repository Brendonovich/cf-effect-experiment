import { assert, describe, it } from "@effect/vitest";
import {
  ConnectionId,
  GraphId,
  IoId,
  NodeId,
  PackageId,
  type Project,
  SchemaId,
} from "@macrograph/core";
import { Executor } from "@macrograph/execution";
import { DataType, Engine, Plugin, Registration } from "@macrograph/plugin";
import { Array, Cause, Effect, Layer, Result, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import HttpClientDeployment from "../src/Deployment.ts";
import { makeRuntimeClient } from "../src/Engine.ts";
import HttpClientPlugin from "../src/Plugin.ts";
import { localLayer } from "../src/UrlPolicy.ts";

class Start extends Schema.TaggedClass<Start>()("Start", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Start>() }) {}

const TestPlugin = Plugin.make({
  id: "http-client-test",
  engine: TestEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "Start",
      type: "event",
      event: (event) => Effect.succeed(event._tag === "Start"),
      io: () => ({}),
      run: () => Effect.void,
    });
    yield* context.schema.register({
      id: "Record",
      io: (io) => ({ status: io.data.in("status", DataType.Int) }),
      run: ({ io }) =>
        Effect.sync(() => {
          statuses.push(io.status);
        }),
    });
  }),
});

const statuses: Array<number> = [];
const TestDeployment = Engine.deployment(
  TestPlugin,
  TestEngine.toLayer(() => Effect.die("test engine is not hosted")),
);

describe("HTTP client plugin", () => {
  it.effect("registers the five URL-to-status action schemas", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(HttpClientPlugin.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        ["HttpGet", "HttpPost", "HttpPut", "HttpPatch", "HttpDelete"],
      );
      for (const schema of schemas) {
        assert.strictEqual(schema.type, "exec");
        assert.deepStrictEqual(
          schema.dataInputs.map(({ id, name, type, defaultValue }) => ({
            id,
            name,
            type: type._tag,
            defaultValue,
          })),
          [{ id: "url", name: "URL", type: "String", defaultValue: "https://" }],
        );
        assert.deepStrictEqual(
          schema.dataOutputs.map(({ id, name, type }) => ({ id, name, type: type._tag })),
          [{ id: "status", name: "Status Code", type: "Int" }],
        );
        assert.deepStrictEqual(
          schema.executionInputs.map(({ id }) => id),
          ["exec"],
        );
        assert.deepStrictEqual(
          schema.executionOutputs.map(({ id }) => id),
          ["exec"],
        );
      }
    }),
  );

  it.effect("emits status data and continues execution", () =>
    Effect.gen(function* () {
      statuses.length = 0;
      const httpClient = HttpClient.makeWith<
        HttpClientError.HttpClientError,
        never,
        HttpClientError.HttpClientError,
        never
      >(
        (requestEffect) =>
          Effect.map(requestEffect, (request) =>
            HttpClientResponse.fromWeb(request, new Response(undefined, { status: 418 })),
          ),
        Effect.succeed,
      );
      const runtime = yield* makeRuntimeClient().pipe(
        Effect.provide(localLayer),
        Effect.provide(Layer.succeed(HttpClient.HttpClient)(httpClient)),
      );
      const graphId = GraphId.make("http");
      const eventId = NodeId.make("event");
      const requestId = NodeId.make("request");
      const recordId = NodeId.make("record");
      const project: Project.Model = {
        name: "HTTP",
        engines: {},
        constants: {},
        graphs: {
          [graphId]: {
            id: graphId,
            name: "HTTP",
            nodes: {
              [eventId]: {
                id: eventId,
                name: "Start",
                schema: {
                  package: PackageId.make(TestPlugin.id),
                  schema: SchemaId.make("Start"),
                },
                properties: {},
                inputDefaults: {},
                foldPins: false,
                position: { x: 0, y: 0 },
              },
              [requestId]: {
                id: requestId,
                name: "GET",
                schema: {
                  package: PackageId.make(HttpClientPlugin.id),
                  schema: SchemaId.make("HttpGet"),
                },
                properties: {},
                inputDefaults: { url: "http://localhost/status" },
                foldPins: false,
                position: { x: 100, y: 0 },
              },
              [recordId]: {
                id: recordId,
                name: "Record",
                schema: {
                  package: PackageId.make(TestPlugin.id),
                  schema: SchemaId.make("Record"),
                },
                properties: {},
                inputDefaults: {},
                foldPins: false,
                position: { x: 200, y: 0 },
              },
            },
            connections: [
              {
                id: ConnectionId.make("event-request"),
                outNodeId: eventId,
                outIoId: IoId.make("exec"),
                inNodeId: requestId,
                inIoId: IoId.make("exec"),
              },
              {
                id: ConnectionId.make("request-record"),
                outNodeId: requestId,
                outIoId: IoId.make("exec"),
                inNodeId: recordId,
                inIoId: IoId.make("exec"),
              },
              {
                id: ConnectionId.make("status-record"),
                outNodeId: requestId,
                outIoId: IoId.make("status"),
                inNodeId: recordId,
                inIoId: IoId.make("status"),
              },
            ],
          },
        },
      };
      const executor = yield* Executor.make(project, {
        engineClient: (pluginId) => Effect.succeed(pluginId === HttpClientPlugin.id ? runtime : {}),
      });
      yield* executor.plugin(TestPlugin, TestDeployment);
      yield* executor.plugin(HttpClientPlugin, HttpClientDeployment);
      yield* executor.handleEvent(TestPlugin, new Start());

      assert.deepStrictEqual(statuses, [418]);

      yield* executor.loadProject({
        ...project,
        graphs: {
          [graphId]: {
            ...project.graphs[graphId]!,
            nodes: {
              ...project.graphs[graphId]!.nodes,
              [requestId]: {
                ...project.graphs[graphId]!.nodes[requestId]!,
                inputDefaults: { url: "file:///etc/passwd" },
              },
            },
          },
        },
      });
      const failed = yield* Effect.result(executor.handleEvent(TestPlugin, new Start()));
      assert.isTrue(Result.isFailure(failed));
      if (Result.isFailure(failed)) {
        assert.strictEqual(failed.failure._tag, "NodeExecutionError");
        if (failed.failure._tag === "NodeExecutionError") {
          assert.isTrue(Cause.isCause(failed.failure.cause));
          if (Cause.isCause(failed.failure.cause)) {
            assert.isFalse(Cause.hasDies(failed.failure.cause));
            const cause = Cause.findFail(failed.failure.cause);
            assert.isTrue(Result.isSuccess(cause));
            if (Result.isSuccess(cause)) {
              assert.isTrue(Cause.isFailReason(cause.success));
              if (Cause.isFailReason(cause.success)) {
                assert.propertyVal(cause.success.error, "_tag", "HttpClientRequestFailure");
                assert.propertyVal(cause.success.error, "method", "GET");
                assert.propertyVal(cause.success.error, "url", "file:///etc/passwd");
              }
            }
          }
        }
      }
    }),
  );
});
