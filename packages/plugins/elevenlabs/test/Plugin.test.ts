import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, Result, Schema } from "effect";

import {
  ClientState,
  ElevenLabsEngine,
  RequestFailure,
  SpeechOptions,
  SpeechRequest,
} from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";
import plugin from "../src/Plugin.ts";

describe("ElevenLabs catalog", () => {
  it.effect("maps audio results to pins and preserves typed failures", () =>
    Effect.gen(function* () {
      const [schema] = yield* Registration.collect(plugin.effect);
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
        text: "Hello",
        modelId: "model",
        voiceId: "voice",
        body: "{}",
      };
      const engine = {
        ElevenLabsTTS: (request: typeof SpeechRequest.Type) => {
          assert.deepStrictEqual(request, input);
          return Effect.succeed({ audio: "SUQzAP8=", mime: "audio/mpeg" });
        },
      };
      const continuation = yield* schema!.run({
        ...context,
        engine,
        input: (ref) => input[ref.id],
        output: (ref, value) => {
          outputs[ref.id] = value;
        },
      });
      assert.isUndefined(continuation);
      assert.deepStrictEqual(outputs, { audio: "SUQzAP8=", mime: "audio/mpeg" });
      const failure = new RequestFailure({ reason: "Request failed" });
      const result = yield* Effect.result(
        schema!.run({
          ...context,
          engine: { ElevenLabsTTS: () => Effect.fail(failure) },
          input: (ref) => input[ref.id],
          output: () => assert.fail("failed requests must not write outputs"),
        }),
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.strictEqual(result.failure, failure);
    }),
  );

  it.effect("registers a runtime-compatible text-to-audio schema without file pins", () =>
    Effect.gen(function* () {
      assert.strictEqual(plugin.id, "elevenlabs");
      assert.strictEqual(deployment.plugin, plugin);
      assert.strictEqual(deployment.definition, ElevenLabsEngine);
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map(({ id }) => id),
        ["ElevenLabsTTS"],
      );
      const schema = schemas[0]!;
      assert.strictEqual(schema.type, "exec");
      assert.deepStrictEqual(
        schema.executionInputs.map(({ id }) => id),
        ["exec"],
      );
      assert.deepStrictEqual(
        schema.executionOutputs.map(({ id }) => id),
        ["exec"],
      );
      assert.deepStrictEqual(
        schema.dataInputs.map(({ id, type }) => [id, type._tag]),
        [
          ["text", "String"],
          ["modelId", "String"],
          ["voiceId", "String"],
          ["body", "String"],
        ],
      );
      assert.strictEqual(
        schema.dataInputs.find(({ id }) => id === "modelId")!.defaultValue,
        "eleven_multilingual_v2",
      );
      assert.strictEqual(schema.dataInputs.find(({ id }) => id === "body")!.defaultValue, "{}");
      const suggestions = schema.dataInputs.find(({ id }) => id === "modelId")!.suggestions;
      assert.isDefined(suggestions);
      assert.deepStrictEqual(
        yield* suggestions!({ properties: {}, inputDefaults: {}, engine: undefined }),
        [
          "eleven_turbo_v2_5",
          "eleven_multilingual_v2",
          "eleven_turbo_v2",
          "eleven_multilingual_v1",
          "eleven_monolingual_v1",
        ],
      );
      assert.deepStrictEqual(
        schema.dataOutputs.map(({ id, type }) => [id, type._tag]),
        [
          ["audio", "String"],
          ["mime", "String"],
        ],
      );
    }),
  );

  it.effect("supports empty options and boundary values", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* Schema.decodeUnknownEffect(SpeechOptions)({}), {});
      const options = {
        voice_settings: {
          stability: 0,
          similarity_boost: 1,
          style: 1,
          speed: 0.7,
          use_speaker_boost: false,
        },
        seed: 4294967295,
      };
      assert.deepStrictEqual(yield* Schema.decodeUnknownEffect(SpeechOptions)(options), options);
    }),
  );

  it.effect("only serializes the configured flag as client state", () =>
    Effect.gen(function* () {
      const encoded = yield* Schema.encodeUnknownEffect(ClientState)({
        configured: true,
        apiKey: "secret",
      });
      assert.deepStrictEqual(encoded, { configured: true });
      assert.deepStrictEqual(ElevenLabsEngine.InitialStorage, { apiKey: null });
    }),
  );
});
