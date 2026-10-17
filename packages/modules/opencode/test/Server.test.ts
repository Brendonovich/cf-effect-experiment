import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RpcTest } from "effect/rpc";

import { OpenCodeEngine, RequestFailure, type Target, initialStorage } from "../src/Definition.ts";
import ServerDeployment from "../src/Deployment/Server.ts";
import { makeLayer } from "../src/Engine.ts";
import { makeInstances, type Discover } from "../src/Engine/Server.ts";
import OpenCodeModule from "../src/Module.ts";

const runtime = (discover: Discover, initialTarget: Target = initialStorage.target) => {
  let storage = { target: initialTarget };
  const context = Layer.succeed(OpenCodeEngine.EngineContext)(
    OpenCodeEngine.EngineContext.of({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) => Effect.sync(() => void (storage = value)),
        update: (update) => Effect.sync(() => void (storage = update(storage))),
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
  return Effect.gen(function* () {
    const engine = yield* OpenCodeEngine;
    const client = yield* RpcTest.makeClient(OpenCodeEngine.Rpcs).pipe(Effect.provide(engine.rpcs));
    const settings = yield* RpcTest.makeClient(OpenCodeEngine.ClientRpcs).pipe(
      Effect.provide(engine.client.rpcs),
    );
    return { client, engine, settings };
  }).pipe(Effect.provide(makeLayer(makeInstances(discover))), Effect.provide(context));
};

const client = (requests: Array<unknown> = []) => ({
  generate: {
    text: async (request: unknown) => {
      requests.push(request);
      return { text: "Generated" };
    },
  },
  model: { list: async () => ({ data: [] }) },
  credential: { list: async () => [], remove: async () => {} },
  integration: {
    list: async () => ({ data: [] }),
    connect: { key: async () => {} },
    oauth: {
      connect: async () => assert.fail("unused"),
      status: async () => assert.fail("unused"),
      complete: async () => {},
      cancel: async () => {},
    },
  },
});

describe("OpenCode server deployment", () => {
  it("binds the OpenCode module to the target-resolving engine", () => {
    assert.strictEqual(ServerDeployment.module, OpenCodeModule);
    assert.strictEqual(ServerDeployment.definition, OpenCodeEngine);
  });

  it.effect("resolves the deployment default to the discovered local service", () =>
    Effect.gen(function* () {
      const requests: Array<unknown> = [];
      const { client: runtimeClient, engine } = yield* runtime(async () => client(requests));
      assert.strictEqual(
        yield* runtimeClient.OpenCodeGenerateText({ prompt: "Hello", model: "anthropic/claude" }),
        "Generated",
      );
      assert.strictEqual(
        yield* runtimeClient.OpenCodeGenerateText({ prompt: "Default", model: "" }),
        "Generated",
      );
      assert.deepStrictEqual(requests, [
        { prompt: "Hello", model: { providerID: "anthropic", id: "claude" } },
        { prompt: "Default" },
      ]);
      assert.deepStrictEqual(yield* engine.client.state, {
        target: { type: "default" },
        defaultTarget: "remote",
        availableTargets: ["remote"],
        credentials: [],
        oauthMethods: [],
      });
    }),
  );

  it.effect("lists enabled models as sorted provider/model references", () =>
    Effect.gen(function* () {
      const { client: runtimeClient } = yield* runtime(async () => ({
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
        credential: { list: async () => [], remove: async () => {} },
        integration: {
          list: async () => ({ data: [] }),
          connect: { key: async () => {} },
          oauth: {
            connect: async () => assert.fail("unused"),
            status: async () => assert.fail("unused"),
            complete: async () => {},
            cancel: async () => {},
          },
        },
      }));
      assert.deepStrictEqual(yield* runtimeClient.OpenCodeListModels(), [
        "anthropic/claude",
        "openai/gpt",
      ]);
    }),
  );

  it.effect("reports missing services and malformed model references", () =>
    Effect.gen(function* () {
      const missing = yield* runtime(async () => undefined);
      const missingResult = yield* Effect.result(missing.client.OpenCodeListModels());
      assert.isTrue(missingResult._tag === "Failure");
      if (missingResult._tag === "Failure") {
        assert.instanceOf(missingResult.failure, RequestFailure);
        assert.include(missingResult.failure.reason, "No running local OpenCode service");
      }

      const connected = yield* runtime(async () => client());
      const invalid = yield* Effect.result(
        connected.client.OpenCodeGenerateText({ prompt: "Hello", model: "invalid" }),
      );
      assert.isTrue(invalid._tag === "Failure");
      if (invalid._tag === "Failure")
        assert.strictEqual(invalid.failure.reason, "Model must use the provider/model format");
    }),
  );

  it.effect("does not expose or accept managed targets on the server", () =>
    Effect.gen(function* () {
      const { settings } = yield* runtime(async () => client());
      const result = yield* Effect.result(
        settings.OpenCodeSetTarget({ type: "managed", config: "{}" }),
      );
      assert.isTrue(result._tag === "Failure");
      if (result._tag === "Failure")
        assert.strictEqual(
          result.failure.reason,
          "managed OpenCode targets are unavailable in this deployment",
        );
    }),
  );
});
