import { assert, describe, it } from "@effect/vitest";
import { GraphId, NodeId, PackageId, Project, SchemaId } from "@macrograph/core";
import { Executor } from "@macrograph/execution";
import { Engine, Plugin } from "@macrograph/plugin";
import { Array, ConfigProvider, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { createServer, type IncomingHttpHeaders } from "node:http";

import { Observability } from "../src/Observability.ts";
import { makeServerConfig } from "../src/ServerConfig.ts";

const TraceRequest = Schema.fromJsonString(
  Schema.Struct({
    resourceSpans: Schema.Array(
      Schema.Struct({
        resource: Schema.Struct({
          attributes: Schema.Array(
            Schema.Struct({
              key: Schema.String,
              value: Schema.Struct({ stringValue: Schema.optional(Schema.String) }),
            }),
          ),
        }),
        scopeSpans: Schema.Array(
          Schema.Struct({
            spans: Schema.Array(
              Schema.Struct({
                name: Schema.String,
                traceId: Schema.String,
                spanId: Schema.String,
                parentSpanId: Schema.optional(Schema.String),
                startTimeUnixNano: Schema.String,
                endTimeUnixNano: Schema.String,
                status: Schema.Struct({ code: Schema.Number }),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
);

describe("Observability", () => {
  it.effect("flushes ended spans as authenticated OTLP JSON on layer scope shutdown", () =>
    Effect.gen(function* () {
      const requests: Array<{
        method: string | undefined;
        url: string | undefined;
        headers: IncomingHttpHeaders;
        body: string;
      }> = [];
      const collector = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createServer((request, response) => {
            let body = "";
            request.setEncoding("utf8");
            request.on("data", (chunk: string) => {
              body += chunk;
            });
            request.on("end", () => {
              requests.push({
                method: request.method,
                url: request.url,
                headers: request.headers,
                body,
              });
              response.writeHead(200, { "content-type": "application/json" });
              response.end("{}");
            });
          }),
        ),
        (server) =>
          Effect.callback<void>((resume) => {
            server.close((error) => resume(error ? Effect.die(error) : Effect.void));
            server.closeAllConnections();
          }),
      );
      yield* Effect.callback<void, Error>((resume) => {
        const onError = (error: Error) => resume(Effect.fail(error));
        collector.once("error", onError);
        collector.listen(0, "127.0.0.1", () => {
          collector.removeListener("error", onError);
          resume(Effect.void);
        });
      });
      const address = collector.address();
      if (address === null || typeof address === "string") {
        return assert.fail("Expected a listening HTTP collector");
      }
      const config = makeServerConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20collector-token,X-Collector-Key=secret",
        OTEL_SERVICE_NAME: "observability-test-server",
      });
      class ChatMessage extends Schema.TaggedClass<ChatMessage>()("channel.chat.message", {}) {}
      class TestEngine extends Engine.make({ events: Array.empty<ChatMessage>() }) {}
      const plugin = Plugin.make({
        id: "twitch",
        engine: TestEngine,
        effect: (registration) =>
          registration.schema.register({
            id: "ChatMessage",
            type: "event",
            event: () => Effect.succeed(true),
            io: () => ({}),
            run: ({ node }) => node.withSpan("test.chat-handler", Effect.void),
          }),
      });
      const deployment = Engine.deployment(
        plugin,
        TestEngine.toLayer(() => Effect.die("not hosted")),
      );
      const graphId = GraphId.make("chat");
      const nodeId = NodeId.make("message");
      const executor = yield* Executor.make({
        ...Project.empty(),
        graphs: {
          [graphId]: {
            id: graphId,
            name: "Chat",
            nodes: {
              [nodeId]: {
                id: nodeId,
                name: "Chat Message",
                schema: { package: PackageId.make("twitch"), schema: SchemaId.make("ChatMessage") },
                properties: {},
                inputDefaults: {},
                foldPins: false,
                position: { x: 0, y: 0 },
              },
            },
            connections: [],
          },
        },
      });
      yield* executor.plugin(plugin, deployment);

      yield* Effect.gen(function* () {
        yield* TestClock.adjust("10 millis").pipe(
          Effect.withSpan("child-operation"),
          Effect.withSpan("server-operation"),
        );
        yield* executor.handleEvent(plugin, new ChatMessage({}));
        yield* executor.handleEvent(plugin, new ChatMessage({}));
        // The one-second export interval has not elapsed, so these spans remain buffered.
        assert.deepStrictEqual(requests, []);
      }).pipe(Effect.provide(Observability.layer(config)));

      assert.strictEqual(requests.length, 1);
      const request = requests[0]!;
      assert.strictEqual(request.method, "POST");
      assert.strictEqual(request.url, "/v1/traces");
      assert.strictEqual(request.headers.authorization, "Bearer collector-token");
      assert.strictEqual(request.headers["x-collector-key"], "secret");
      assert.strictEqual(request.headers["content-type"], "application/json");
      const payload = yield* Schema.decodeUnknownEffect(TraceRequest)(request.body);
      assert.strictEqual(payload.resourceSpans.length, 1);
      const resourceSpans = payload.resourceSpans[0]!;
      assert.deepStrictEqual(
        resourceSpans.resource.attributes.filter((attribute) => attribute.key === "service.name"),
        [{ key: "service.name", value: { stringValue: "observability-test-server" } }],
      );
      assert.strictEqual(resourceSpans.scopeSpans.length, 1);
      const spans = resourceSpans.scopeSpans[0]!.spans;
      assert.deepStrictEqual(
        spans.map((span) => span.name),
        [
          "child-operation",
          "server-operation",
          "Executor.matchEvent",
          "test.chat-handler",
          "Schema.run twitch.ChatMessage",
          "Executor.runNode",
          "Executor.executeEventNode",
          "Executor.handleEvent",
          "Executor.matchEvent",
          "test.chat-handler",
          "Schema.run twitch.ChatMessage",
          "Executor.runNode",
          "Executor.executeEventNode",
          "Executor.handleEvent",
        ],
      );
      for (const span of spans) {
        assert.match(span.traceId, /^[a-f0-9]{32}$/);
        assert.match(span.spanId, /^[a-f0-9]{16}$/);
        assert.match(span.startTimeUnixNano, /^\d+$/);
        assert.match(span.endTimeUnixNano, /^\d+$/);
        assert.isTrue(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano));
        assert.strictEqual(span.status.code, 1);
      }
      assert.strictEqual(spans[0]!.traceId, spans[1]!.traceId);
      assert.strictEqual(spans[0]!.parentSpanId, spans[1]!.spanId);
      const eventSpans = spans.filter((span) => span.name === "Executor.handleEvent");
      assert.lengthOf(eventSpans, 2);
      assert.notStrictEqual(eventSpans[0]!.traceId, eventSpans[1]!.traceId);
      for (const eventSpan of eventSpans) {
        assert.isUndefined(eventSpan.parentSpanId);
        const trace = spans.filter((span) => span.traceId === eventSpan.traceId);
        const graph = trace.find((span) => span.name === "Executor.executeEventNode")!;
        const node = trace.find((span) => span.name === "Executor.runNode")!;
        const handler = trace.find((span) => span.name === "test.chat-handler")!;
        const schema = trace.find((span) => span.name === "Schema.run twitch.ChatMessage")!;
        assert.strictEqual(graph.parentSpanId, eventSpan.spanId);
        assert.strictEqual(node.parentSpanId, graph.spanId);
        assert.strictEqual(schema.parentSpanId, node.spanId);
        assert.strictEqual(handler.parentSpanId, schema.spanId);
      }
    }).pipe(
      Effect.scoped,
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
    ),
  );

  it.effect("returns an empty layer when no collector endpoint is configured", () =>
    Effect.gen(function* () {
      const layer = Observability.layer(makeServerConfig({}));
      assert.strictEqual(layer, Layer.empty);
      const result = yield* Effect.succeed("unexported").pipe(
        Effect.withSpan("disabled-operation"),
        Effect.provide(layer),
      );
      assert.strictEqual(result, "unexported");
    }),
  );
});
