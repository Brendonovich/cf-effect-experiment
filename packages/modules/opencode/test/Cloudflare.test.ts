import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { OpenCodeEngine, RequestFailure } from "../src/Definition.ts";
import { make } from "../src/Deployment/Cloudflare.ts";
import { makeLayer, type Service } from "../src/Engine/Cloudflare.ts";
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

const makeService = (): Service => ({
  generateText: () => Effect.succeed("Generated"),
  listModels: () => Effect.succeed(["anthropic/claude"]),
  clientState: () =>
    Effect.succeed({
      mode: "cloudflare",
      credentials: [
        { id: "credential", integrationID: "opencode", label: "Console", active: true },
      ],
    }),
  connectKey: () => Effect.void,
  removeCredential: () => Effect.void,
});

const runtime = (service: Service) =>
  Effect.gen(function* () {
    const engine = yield* OpenCodeEngine;
    const client = yield* RpcTest.makeClient(OpenCodeEngine.Rpcs).pipe(Effect.provide(engine.rpcs));
    const settings = yield* RpcTest.makeClient(OpenCodeEngine.ClientRpcs).pipe(
      Effect.provide(engine.client.rpcs),
    );
    return { client, engine, settings };
  }).pipe(Effect.provide(makeLayer(service)), Effect.provide(context));

describe("OpenCode Cloudflare deployment", () => {
  it("binds the module to an injected project service", () => {
    const deployment = make(makeService());
    assert.strictEqual(deployment.module, OpenCodeModule);
    assert.strictEqual(deployment.definition, OpenCodeEngine);
  });

  it.effect("proxies generation, models, state and credential mutations", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const service: Service = {
        ...makeService(),
        generateText: (input) =>
          Effect.sync(() => {
            calls.push(["generate", input]);
            return "Response";
          }),
        connectKey: (input) =>
          Effect.sync(() => {
            calls.push(["connect", input]);
          }),
        removeCredential: (id) =>
          Effect.sync(() => {
            calls.push(["remove", id]);
          }),
      };
      const { client, engine, settings } = yield* runtime(service);
      assert.strictEqual(
        yield* client.OpenCodeGenerateText({ prompt: "Hello", model: "opencode/model" }),
        "Response",
      );
      assert.deepStrictEqual(yield* client.OpenCodeListModels(), ["anthropic/claude"]);
      assert.deepStrictEqual(yield* engine.client.state, {
        mode: "cloudflare",
        credentials: [
          { id: "credential", integrationID: "opencode", label: "Console", active: true },
        ],
      });
      yield* settings.OpenCodeConnectKey({ integrationID: "opencode", key: "secret" });
      yield* settings.OpenCodeRemoveCredential({ credentialID: "credential" });
      assert.deepStrictEqual(calls, [
        ["generate", { prompt: "Hello", model: "opencode/model" }],
        ["connect", { integrationID: "opencode", key: "secret" }],
        ["remove", "credential"],
      ]);
    }),
  );

  it.effect("maps remote failures to module failures", () =>
    Effect.gen(function* () {
      const { client } = yield* runtime({
        ...makeService(),
        generateText: () => Effect.fail(new Error("Provider unavailable")),
      });
      const result = yield* Effect.result(
        client.OpenCodeGenerateText({ prompt: "Hello", model: "" }),
      );
      assert.isTrue(result._tag === "Failure");
      if (result._tag === "Failure") {
        assert.instanceOf(result.failure, RequestFailure);
        assert.strictEqual(result.failure.reason, "Provider unavailable");
      }
    }),
  );
});
