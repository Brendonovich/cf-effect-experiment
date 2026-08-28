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

const run = (
  registered: Registration.RegisteredSchema,
  inputs: Readonly<Record<string, unknown>> = {},
  engine?: unknown,
) => {
  const outputs = new Map<string, unknown>();
  return registered
    .run({
      input: (ref) => (Object.hasOwn(inputs, ref.id) ? inputs[ref.id] : ref.defaultValue),
      output: (ref, value) => {
        assert.isTrue(DataType.isValue(ref.type, value), ref.id);
        outputs.set(ref.id, value);
      },
      properties: {},
      event: undefined,
      engine,
      execution: {
        projectId: "project",
        graphId: "graph",
        eventNodeId: "event",
        traceId: "execution",
      },
      node: {
        nodeId: "node",
        kind: registered.type,
        executionPath: "event:event",
        traceId: "node",
        withSpan: (_name, effect) => effect,
      },
    })
    .pipe(Effect.as(outputs));
};

describe("HTTP client plugin", () => {
  it.effect("registers seven schemas preserving existing IDs, pins, and defaults", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(HttpClientPlugin.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        [
          "HttpGet",
          "HttpPost",
          "HttpPut",
          "HttpPatch",
          "HttpDelete",
          "URLEncodeComponent",
          "URLDecodeComponent",
        ],
      );
      for (const schema of schemas.filter((schema) => schema.type === "exec")) {
        assert.strictEqual(schema.type, "exec");
        assert.deepStrictEqual(
          schema.dataInputs.map(({ id, name, type, defaultValue }) => ({
            id,
            name,
            type: type._tag,
            defaultValue,
          })),
          [
            { id: "url", name: "URL", type: "String", defaultValue: "https://" },
            { id: "headers", name: "Headers (JSON)", type: "String", defaultValue: "{}" },
            ...(schema.id === "HttpGet"
              ? []
              : [{ id: "body", name: "Body", type: "String" as const, defaultValue: "" }]),
          ],
        );
        assert.deepStrictEqual(
          schema.dataOutputs.map(({ id, name, type }) => ({ id, name, type: type._tag })),
          [
            { id: "status", name: "Status Code", type: "Int" },
            { id: "responseBody", name: "Response Body", type: "String" },
            { id: "contentType", name: "Content Type", type: "String" },
            { id: "responseHeaders", name: "Response Headers (JSON)", type: "String" },
          ],
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
      for (const schema of schemas.filter((schema) => schema.type === "pure")) {
        assert.deepStrictEqual(
          schema.dataInputs.map(({ id, defaultValue }) => ({ id, defaultValue })),
          [{ id: "input", defaultValue: "" }],
        );
        assert.deepStrictEqual(
          schema.dataOutputs.map(({ id }) => id),
          ["output"],
        );
        assert.lengthOf(schema.executionInputs, 0);
        assert.lengthOf(schema.executionOutputs, 0);
      }
    }),
  );

  it.effect("forwards all request pins and emits text, content type, headers, and status", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(HttpClientPlugin.effect);
      const calls: Array<unknown> = [];
      const engine = {
        HttpClientRequestText: (request: unknown) => {
          calls.push(request);
          return Effect.succeed({
            status: 400,
            body: '{"error":"bad"}',
            contentType: "application/json",
            headers: { "content-type": "application/json", "x-test": "ok" },
          });
        },
      };
      for (const schema of schemas.filter((schema) => schema.type === "exec")) {
        const outputs = yield* run(
          schema,
          {
            url: "https://example.com",
            body: "payload",
            headers: '{"Authorization":"Bearer test"}',
          },
          engine,
        );
        assert.deepStrictEqual(calls.at(-1), {
          method: schema.name!.slice(5),
          url: "https://example.com",
          body: schema.id === "HttpGet" ? "" : "payload",
          headers: '{"Authorization":"Bearer test"}',
        });
        assert.deepStrictEqual(Object.fromEntries(outputs), {
          status: 400,
          responseBody: '{"error":"bad"}',
          contentType: "application/json",
          responseHeaders: '{"content-type":"application/json","x-test":"ok"}',
        });
        yield* run(schema, {}, engine);
        assert.deepStrictEqual(calls.at(-1), {
          method: schema.name!.slice(5),
          url: "https://",
          body: "",
          headers: "{}",
        });
      }
    }),
  );

  it.effect("encodes and decodes components with typed failures for malformed input", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(HttpClientPlugin.effect);
      const encode = schemas.find((schema) => schema.id === "URLEncodeComponent")!;
      const decode = schemas.find((schema) => schema.id === "URLDecodeComponent")!;
      for (const input of [
        "",
        "a b+c/d?x=1&y=2#fragment",
        "\u00e9\ud83d\ude80",
        "!'()*-._~",
        "%",
      ]) {
        const encoded = (yield* run(encode, { input })).get("output");
        assert.strictEqual(encoded, encodeURIComponent(input));
        assert.strictEqual((yield* run(decode, { input: encoded })).get("output"), input);
      }
      assert.strictEqual((yield* run(decode, { input: "a+b" })).get("output"), "a+b");
      assert.strictEqual((yield* run(encode)).get("output"), "");
      assert.strictEqual((yield* run(decode)).get("output"), "");
      for (const [schema, inputs, operation] of [
        [encode, ["\ud800", "\udfff"], "encode"],
        [decode, ["%", "%GG", "%C0%AF", "%ED%A0%80", "%E2%82"], "decode"],
      ] as const) {
        for (const input of inputs) {
          const result = yield* Effect.result(run(schema, { input }));
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) {
            assert.propertyVal(result.failure, "_tag", "HttpUrlComponentFailure");
            assert.propertyVal(result.failure, "operation", operation);
          }
        }
      }
    }),
  );

  it.effect(
    "executes saved URL/status-only graphs for every method and propagates typed failures",
    () =>
      Effect.gen(function* () {
        statuses.length = 0;
        const methods: Array<string> = [];
        const httpClient = HttpClient.makeWith<
          HttpClientError.HttpClientError,
          never,
          HttpClientError.HttpClientError,
          never
        >(
          (requestEffect) =>
            Effect.map(requestEffect, (request) => {
              methods.push(request.method);
              assert.strictEqual(request.body._tag, "Empty");
              assert.isUndefined(request.headers["content-type"]);
              assert.isUndefined(request.headers.authorization);
              return HttpClientResponse.fromWeb(request, new Response(undefined, { status: 418 }));
            }),
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
          engineClient: (pluginId) =>
            Effect.succeed(pluginId === HttpClientPlugin.id ? runtime : {}),
        });
        yield* executor.plugin(TestPlugin, TestDeployment);
        yield* executor.plugin(HttpClientPlugin, HttpClientDeployment);
        yield* executor.handleEvent(TestPlugin, new Start());

        assert.deepStrictEqual(statuses, [418]);

        for (const schema of ["HttpPost", "HttpPut", "HttpPatch", "HttpDelete"]) {
          yield* executor.loadProject({
            ...project,
            graphs: {
              [graphId]: {
                ...project.graphs[graphId]!,
                nodes: {
                  ...project.graphs[graphId]!.nodes,
                  [requestId]: {
                    ...project.graphs[graphId]!.nodes[requestId]!,
                    schema: {
                      package: PackageId.make(HttpClientPlugin.id),
                      schema: SchemaId.make(schema),
                    },
                  },
                },
              },
            },
          });
          yield* executor.handleEvent(TestPlugin, new Start());
        }
        assert.deepStrictEqual(statuses, [418, 418, 418, 418, 418]);
        assert.deepStrictEqual(methods, ["GET", "POST", "PUT", "PATCH", "DELETE"]);

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
        assert.lengthOf(statuses, 5);
        assert.lengthOf(methods, 5);
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
