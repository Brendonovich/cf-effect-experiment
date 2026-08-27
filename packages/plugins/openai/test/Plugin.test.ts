import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, Option, Result, Schema } from "effect";

import {
  ChatRequest,
  ClientState,
  ImageRequest,
  OpenAIEngine,
  RequestFailure,
} from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";
import plugin from "../src/Plugin.ts";

describe("OpenAI catalog", () => {
  it.effect("maps RPC results to scalar/option pins and preserves typed failures", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      const context = {
        properties: {},
        event: undefined,
        execution: {
          projectId: "project",
          graphId: "graph",
          eventNodeId: "event",
          traceId: "trace",
        },
        node: {
          nodeId: "node",
          kind: "exec" as const,
          executionPath: "node",
          traceId: "trace",
          withSpan: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
        },
      };
      const outputs: Record<string, unknown> = {};
      const input: Record<string, unknown> = {
        message: "Hello",
        model: "model",
        historyIn: "[]",
        prompt: "A tree",
      };
      const failure = new RequestFailure({ operation: "chat", reason: "Request failed" });
      const engine = {
        OpenAIChat: (request: typeof ChatRequest.Type) => {
          assert.deepStrictEqual(request, { message: "Hello", model: "model", historyIn: "[]" });
          return Effect.succeed({ response: "Hi", historyOut: "history" });
        },
        OpenAIImage: (request: typeof ImageRequest.Type) => {
          assert.deepStrictEqual(request, { prompt: "A tree", model: "model" });
          return Effect.succeed({
            url: null,
            base64: "aW1hZ2U=",
            mime: "image/png",
            revised: null,
          });
        },
      };
      for (const schema of schemas) {
        const continuation = yield* schema.run({
          ...context,
          engine,
          input: (ref) => input[ref.id],
          output: (ref, value) => {
            outputs[ref.id] = value;
          },
        });
        assert.isUndefined(continuation);
      }
      assert.deepStrictEqual(outputs, {
        response: "Hi",
        historyOut: "history",
        url: Option.none(),
        base64: Option.some("aW1hZ2U="),
        mime: "image/png",
        revised: Option.none(),
      });
      const result = yield* Effect.result(
        schemas[0]!.run({
          ...context,
          engine: { OpenAIChat: () => Effect.fail(failure) },
          input: (ref) => input[ref.id],
          output: () => assert.fail("failed requests must not write outputs"),
        }),
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.strictEqual(result.failure, failure);
    }),
  );

  it.effect("registers runtime-compatible chat and image execution schemas", () =>
    Effect.gen(function* () {
      assert.strictEqual(plugin.id, "openai");
      assert.strictEqual(deployment.plugin, plugin);
      assert.strictEqual(deployment.definition, OpenAIEngine);
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map(({ id }) => id),
        ["ChatGPTMessage", "DallEImageGeneration"],
      );
      for (const schema of schemas) {
        assert.strictEqual(schema.type, "exec");
        assert.deepStrictEqual(
          schema.executionInputs.map(({ id }) => id),
          ["exec"],
        );
        assert.deepStrictEqual(
          schema.executionOutputs.map(({ id }) => id),
          ["exec"],
        );
        assert.isTrue(schema.dataInputs.every(({ type }) => type._tag === "String"));
        assert.isFalse(schema.dataInputs.some(({ id }) => id === "apiKey"));
      }
      const [chat, image] = schemas;
      assert.deepStrictEqual(
        chat!.dataInputs.map(({ id }) => id),
        ["message", "model", "historyIn"],
      );
      assert.strictEqual(
        chat!.dataInputs.find(({ id }) => id === "model")!.defaultValue,
        "gpt-4o-mini",
      );
      assert.strictEqual(chat!.dataInputs.find(({ id }) => id === "historyIn")!.defaultValue, "[]");
      assert.deepStrictEqual(
        chat!.dataOutputs.map(({ id, type }) => [id, type._tag]),
        [
          ["response", "String"],
          ["historyOut", "String"],
        ],
      );
      assert.strictEqual(
        image!.dataInputs.find(({ id }) => id === "model")!.defaultValue,
        "gpt-image-1",
      );
      assert.deepStrictEqual(
        image!.dataOutputs.map(({ id, type }) => [id, type._tag]),
        [
          ["url", "Option"],
          ["base64", "Option"],
          ["mime", "String"],
          ["revised", "Option"],
        ],
      );
    }),
  );

  it.effect("only serializes the configured flag as client state", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeUnknownEffect(ClientState)({
        configured: true,
        apiKey: "secret",
      });
      assert.deepStrictEqual(encoded, { configured: true });
      assert.deepStrictEqual(OpenAIEngine.InitialStorage, { apiKey: null });
    }),
  );
});
