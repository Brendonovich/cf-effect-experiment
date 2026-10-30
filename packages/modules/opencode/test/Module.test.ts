import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/module";
import { Effect, Result } from "effect";

import {
  ConnectionId,
  GenerateTextRequest,
  OpenCodeConnection,
  OpenCodeEngine,
  RequestFailure,
} from "../src/Definition.ts";
import module from "../src/Module.ts";

const connectionId = ConnectionId.make("writer");
const context = {
  properties: { connection: connectionId },
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

describe("OpenCode module", () => {
  it.effect("registers stateless generation with live model suggestions", () =>
    Effect.gen(function* () {
      assert.strictEqual(module.id, "opencode");
      assert.strictEqual(module.engine, OpenCodeEngine);
      const [schema] = yield* Registration.collect(module.effect);
      assert.isDefined(schema);
      assert.strictEqual(schema!.id, "GenerateText");
      assert.strictEqual(schema!.type, "exec");
      assert.strictEqual(schema!.replay, "unsafe");
      assert.deepStrictEqual(
        schema!.properties.map((property) =>
          "resource" in property
            ? { id: property.id, resource: property.resource, class: property.resourceClass }
            : property,
        ),
        [{ id: "connection", resource: "OpenCodeConnection", class: OpenCodeConnection }],
      );
      assert.deepStrictEqual(
        schema!.dataInputs.map(({ id, name, type, defaultValue }) => ({
          id,
          name,
          type: type._tag,
          defaultValue,
        })),
        [
          { id: "prompt", name: "Prompt", type: "String", defaultValue: undefined },
          { id: "model", name: "Model", type: "String", defaultValue: "" },
        ],
      );
      assert.deepStrictEqual(
        schema!.dataOutputs.map(({ id, name, type }) => ({ id, name, type: type._tag })),
        [{ id: "response", name: "Response", type: "String" }],
      );
      assert.deepStrictEqual(
        schema!.executionInputs.map(({ id }) => id),
        ["exec"],
      );
      assert.deepStrictEqual(
        schema!.executionOutputs.map(({ id }) => id),
        ["exec"],
      );

      const suggestions = schema!.dataInputs.find(({ id }) => id === "model")!.suggestions;
      assert.isDefined(suggestions);
      assert.deepStrictEqual(
        yield* suggestions!({
          properties: { connection: connectionId },
          inputDefaults: {},
          engine: {
            OpenCodeListModels: (request: { readonly connectionId: ConnectionId }) => {
              assert.deepStrictEqual(request, { connectionId });
              return Effect.succeed(["anthropic/sonnet", "openai/gpt"]);
            },
          },
        }),
        ["anthropic/sonnet", "openai/gpt"],
      );
    }),
  );

  it.effect("forwards the bound connection, prompt, and model and emits the response", () =>
    Effect.gen(function* () {
      const [schema] = yield* Registration.collect(module.effect);
      const input: typeof GenerateTextRequest.Type = {
        connectionId,
        prompt: "Summarize this",
        model: "anthropic/claude",
      };
      const output: Record<string, unknown> = {};
      const result = yield* schema!.run({
        ...context,
        engine: {
          OpenCodeGenerateText: (request: typeof GenerateTextRequest.Type) => {
            assert.deepStrictEqual(request, input);
            return Effect.succeed("Summary");
          },
        },
        input: (ref) => (ref.id === "prompt" ? input.prompt : input.model),
        output: (ref, value) => {
          output[ref.id] = value;
        },
      });
      assert.isUndefined(result);
      assert.deepStrictEqual(output, { response: "Summary" });
    }),
  );

  it.effect("preserves typed request failures without writing output", () =>
    Effect.gen(function* () {
      const [schema] = yield* Registration.collect(module.effect);
      const failure = new RequestFailure({ reason: "OpenCode is unavailable" });
      const result = yield* Effect.result(
        schema!.run({
          ...context,
          engine: { OpenCodeGenerateText: () => Effect.fail(failure) },
          input: (ref) => (ref.id === "prompt" ? "Hello" : ""),
          output: () => assert.fail("failed generations must not write output"),
        }),
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.strictEqual(result.failure, failure);
    }),
  );
});
