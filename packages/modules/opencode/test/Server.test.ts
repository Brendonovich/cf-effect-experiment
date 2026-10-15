import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RpcTest } from "effect/rpc";

import { OpenCodeEngine, RequestFailure } from "../src/Definition.ts";
import ServerDeployment from "../src/Deployment/Server.ts";
import { makeLayer, type Connect } from "../src/Engine/Server.ts";
import OpenCodeModule from "../src/Module.ts";

const context = Layer.succeed(OpenCodeEngine.EngineContext)(
  OpenCodeEngine.EngineContext.of({
    storage: {
      get: Effect.die("unused"),
      set: () => Effect.die("unused"),
      update: () => Effect.die("unused"),
    },
    resource: { refresh: () => Effect.die("unused") },
    credentials: {
      get: Effect.succeed([]),
      refresh: () => Effect.die("unused"),
      subscribe: () => Effect.void,
    },
    client: { refresh: Effect.void },
    emit: () => Effect.die("unused"),
  }),
);

const runtime = (connect: Connect) =>
  Effect.gen(function* () {
    const engine = yield* OpenCodeEngine;
    return yield* RpcTest.makeClient(OpenCodeEngine.Rpcs).pipe(Effect.provide(engine.rpcs));
  }).pipe(Effect.provide(makeLayer(connect)), Effect.provide(context));

describe("OpenCode server deployment", () => {
  it("binds the OpenCode module to the local-service engine", () => {
    assert.strictEqual(ServerDeployment.module, OpenCodeModule);
    assert.strictEqual(ServerDeployment.definition, OpenCodeEngine);
  });

  it.effect("generates with explicit and default models", () =>
    Effect.gen(function* () {
      const requests: Array<unknown> = [];
      const client = yield* runtime(async () => ({
        generate: {
          text: async (request) => {
            requests.push(request);
            return { text: "Generated" };
          },
        },
        model: { list: async () => ({ data: [] }) },
      }));
      assert.strictEqual(
        yield* client.OpenCodeGenerateText({ prompt: "Hello", model: "anthropic/claude" }),
        "Generated",
      );
      assert.strictEqual(
        yield* client.OpenCodeGenerateText({ prompt: "Default", model: "" }),
        "Generated",
      );
      assert.deepStrictEqual(requests, [
        { prompt: "Hello", model: { providerID: "anthropic", id: "claude" } },
        { prompt: "Default" },
      ]);
    }),
  );

  it.effect("lists enabled models as sorted provider/model references", () =>
    Effect.gen(function* () {
      const client = yield* runtime(async () => ({
        generate: { text: async () => ({ text: "" }) },
        model: {
          list: async () => ({
            data: [
              { providerID: "openai", id: "gpt", enabled: true },
              { providerID: "anthropic", id: "claude", enabled: true },
              { providerID: "openai", id: "disabled", enabled: false },
              { providerID: "openai", id: "gpt", enabled: true },
            ],
          }),
        },
      }));
      assert.deepStrictEqual(yield* client.OpenCodeListModels(), [
        "anthropic/claude",
        "openai/gpt",
      ]);
    }),
  );

  it.effect("reports missing services and malformed model references", () =>
    Effect.gen(function* () {
      const missing = yield* runtime(async () => undefined);
      const missingResult = yield* Effect.result(missing.OpenCodeListModels());
      assert.isTrue(missingResult._tag === "Failure");
      if (missingResult._tag === "Failure") {
        assert.instanceOf(missingResult.failure, RequestFailure);
        assert.include(missingResult.failure.reason, "No running local OpenCode service");
      }

      const connected = yield* runtime(async () => ({
        generate: { text: async () => ({ text: "" }) },
        model: { list: async () => ({ data: [] }) },
      }));
      const invalid = yield* Effect.result(
        connected.OpenCodeGenerateText({ prompt: "Hello", model: "invalid" }),
      );
      assert.isTrue(invalid._tag === "Failure");
      if (invalid._tag === "Failure")
        assert.strictEqual(invalid.failure.reason, "Model must use the provider/model format");
    }),
  );
});
