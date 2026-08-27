import type { Executor } from "@macrograph/execution";

import { assert, describe, it } from "@effect/vitest";
import {
  ConnectionId,
  GraphId,
  IoId,
  NodeId,
  PackageId,
  Project,
  SchemaId,
} from "@macrograph/core";
import { unavailableRuntimeClient as unavailableTwitchRuntimeClient } from "@macrograph/plugin-twitch/Engine";
import { ProjectExecutor } from "@macrograph/project-host";
import { Effect, Result, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ExecutorPlugins from "../src/execution/ExecutorPlugins.ts";
import * as WorkflowRuntime from "../src/execution/WorkflowRuntime.ts";

describe("ExecutorPlugins", () => {
  it.effect("executes stateless nodes and both HTTP integrations in a hosted graph", () =>
    Effect.gen(function* () {
      const node = (
        id: string,
        plugin: string,
        schema: string,
        inputDefaults: Readonly<Record<string, Schema.Json>> = {},
      ) => ({
        id: NodeId.make(id),
        name: id,
        schema: { package: PackageId.make(plugin), schema: SchemaId.make(schema) },
        properties: {},
        inputDefaults,
        foldPins: false,
        position: { x: 0, y: 0 },
      });
      const connection = (id: string, out: string, output: string, input: string, pin: string) => ({
        id: ConnectionId.make(id),
        outNodeId: NodeId.make(out),
        outIoId: IoId.make(output),
        inNodeId: NodeId.make(input),
        inIoId: IoId.make(pin),
      });
      const graphId = GraphId.make("cloud");
      const nodes = [
        node("tick", "util", "Tick"),
        node("add", "math", "AddInts", { two: 2 }),
        node("string", "string", "IntToString"),
        node("chat", "openai", "ChatGPTMessage"),
        node("speech", "elevenlabs", "ElevenLabsTTS", { voiceId: "voice_123" }),
      ];
      const project: Project.Model = {
        ...Project.empty(),
        engines: {
          openai: { apiKey: "snapshot-openai" },
          elevenlabs: { apiKey: "snapshot-elevenlabs" },
        },
        graphs: {
          [graphId]: {
            id: graphId,
            name: "Cloud graph",
            nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
            connections: [
              connection("tick-chat", "tick", "exec", "chat", "exec"),
              connection("chat-speech", "chat", "exec", "speech", "exec"),
              connection("tick-add", "tick", "tick", "add", "one"),
              connection("add-string", "add", "output", "string", "input"),
              connection("string-chat", "string", "string", "chat", "message"),
              connection("chat-text", "chat", "response", "speech", "text"),
            ],
          },
        },
      };
      const calls: Array<string> = [];
      const http = HttpClient.make((request, url) =>
        Effect.sync(() => {
          calls.push(url.origin);
          if (request.body._tag !== "Uint8Array")
            return assert.fail("Expected a JSON request body");
          const body = JSON.parse(new TextDecoder().decode(request.body.body));
          if (url.origin === "https://api.openai.com") {
            assert.strictEqual(request.headers.authorization, "Bearer snapshot-openai");
            assert.deepStrictEqual(body.messages, [{ role: "user", content: "3" }]);
            return HttpClientResponse.fromWeb(
              request,
              Response.json({ choices: [{ message: { content: "Cloud response" } }] }),
            );
          }
          assert.strictEqual(url.origin, "https://api.elevenlabs.io");
          assert.strictEqual(request.headers["xi-api-key"], "snapshot-elevenlabs");
          assert.strictEqual(body.text, "Cloud response");
          return HttpClientResponse.fromWeb(
            request,
            new Response("audio", { headers: { "content-type": "audio/mpeg" } }),
          );
        }),
      );
      const engineClient = yield* WorkflowRuntime.make(project).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );
      const steps = new Map<string, Executor.NodeExecutionResult>();
      const executor = yield* ProjectExecutor.make(project, {
        plugins: ExecutorPlugins.registry,
        engineClient,
        executionDriver: {
          executeNode: (key, effect) =>
            effect.pipe(
              Effect.tap((result) => Effect.sync(() => void steps.set(key.nodeId, result))),
            ),
        },
      });
      yield* ExecutorPlugins.registry.handle(executor, "util", { _tag: "TickEvent", tick: 1 });
      assert.deepStrictEqual(calls, ["https://api.openai.com", "https://api.elevenlabs.io"]);
      assert.deepStrictEqual([...steps.keys()], ["tick", "chat", "speech"]);
      assert.deepStrictEqual(steps.get("speech")?.outputs, [
        { outputId: "audio", value: "YXVkaW8=" },
        { outputId: "mime", value: "audio/mpeg" },
      ]);
    }),
  );

  it("registers the cloud-compatible catalog without local or persistent-socket plugins", () => {
    assert.deepStrictEqual(ExecutorPlugins.registry.entries.map(({ id }) => id).sort(), [
      "elevenlabs",
      "http-client",
      "json",
      "kofi",
      "list",
      "logic",
      "math",
      "openai",
      "string",
      "twitch",
      "util",
    ]);
  });

  it.effect("registers stateless nodes without treating them as event sources", () =>
    Effect.gen(function* () {
      const executor = yield* ProjectExecutor.make(Project.empty(), {
        plugins: ExecutorPlugins.registry,
      });
      const result = yield* Effect.result(
        ExecutorPlugins.registry.handle(executor, "math", { _tag: "not-an-event" }),
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.strictEqual(result.failure._tag, "SchemaError");
    }),
  );

  it.effect("registers Twitch metadata with credential-owned workflow execution", () =>
    Effect.gen(function* () {
      assert.isTrue(ExecutorPlugins.registry.entries.some(({ id }) => id === "twitch"));
      const failure = yield* Effect.flip(unavailableTwitchRuntimeClient.SendChatMessage());
      assert.strictEqual(failure._tag, "TwitchExecutionUnavailable");
      assert.include(failure.reason, "no credential-scoped workflow RPC binding exists");
    }),
  );

  it.effect("decodes and dispatches a Ko-fi payment", () =>
    Effect.gen(function* () {
      const executor = yield* ProjectExecutor.make(Project.empty(), {
        plugins: ExecutorPlugins.registry,
      });
      yield* ExecutorPlugins.registry.handle(executor, "kofi", {
        _tag: "Donation",
        webhookId: "primary",
        message_id: "message-1",
        timestamp: "2026-08-21T10:00:00Z",
        is_public: true,
        from_name: "A Supporter",
        message: "Keep going!",
        amount: "5.00",
        url: "https://ko-fi.com/",
        email: "supporter@example.com",
        currency: "USD",
        is_subscription_payment: false,
        is_first_subscription_payment: false,
        kofi_transaction_id: "transaction-1",
      });
    }),
  );
});
