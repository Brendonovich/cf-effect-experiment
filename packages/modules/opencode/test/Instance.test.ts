import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RpcTest } from "effect/rpc";

import { makeLayer } from "../src/Engine.ts";
import { OpenCodeEngine, initialStorage } from "../src/Definition.ts";
import type { Instance, Instances } from "../src/Instance.ts";

describe("OpenCode instance routing", () => {
  it.effect("routes credentials and OAuth through the selected target", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const instance: Instance = {
        generateText: () => Effect.succeed(""),
        listModels: Effect.succeed([]),
        listCredentials: Effect.succeed([
          { id: "credential", integrationID: "opencode", label: "Console", active: true },
        ]),
        listOAuthMethods: Effect.succeed([
          {
            integrationID: "opencode",
            integrationName: "OpenCode Console",
            methodID: "oauth",
            label: "Sign in",
          },
        ]),
        connectKey: (input) => Effect.sync(() => calls.push(["key", input])),
        removeCredential: (id) => Effect.sync(() => calls.push(["remove", id])),
        startOAuth: (input) =>
          Effect.sync(() => {
            calls.push(["start", input]);
            return {
              integrationID: input.integrationID,
              attemptID: "attempt",
              url: "https://opencode.ai/auth",
              instructions: "Authorize",
              mode: "auto" as const,
              expires: 100,
            };
          }),
        oauthStatus: (input) =>
          Effect.sync(() => (calls.push(["status", input]), { status: "complete" as const })),
        completeOAuth: (input) => Effect.sync(() => calls.push(["complete", input])),
        cancelOAuth: (input) => Effect.sync(() => calls.push(["cancel", input])),
      };
      const instances: Instances = {
        defaultTarget: "managed",
        availableTargets: ["managed", "remote"],
        resolve: (target) => Effect.sync(() => (calls.push(["resolve", target]), instance)),
      };
      let storage = initialStorage;
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
      const engine = yield* OpenCodeEngine.pipe(
        Effect.provide(makeLayer(instances)),
        Effect.provide(context),
      );
      const rpc = yield* RpcTest.makeClient(OpenCodeEngine.ClientRpcs).pipe(
        Effect.provide(engine.client.rpcs),
      );
      assert.deepStrictEqual(yield* engine.client.state, {
        target: { type: "default" },
        defaultTarget: "managed",
        availableTargets: ["managed", "remote"],
        credentials: [
          { id: "credential", integrationID: "opencode", label: "Console", active: true },
        ],
        oauthMethods: [
          {
            integrationID: "opencode",
            integrationName: "OpenCode Console",
            methodID: "oauth",
            label: "Sign in",
          },
        ],
      });
      yield* rpc.OpenCodeConnectKey({ integrationID: "opencode", key: "secret" });
      yield* rpc.OpenCodeStartOAuth({ integrationID: "opencode", methodID: "oauth" });
      yield* rpc.OpenCodeOAuthStatus({ integrationID: "opencode", attemptID: "attempt" });
      assert.isTrue(calls.some((call) => Array.isArray(call) && call[0] === "key"));
      assert.isTrue(calls.some((call) => Array.isArray(call) && call[0] === "start"));
      assert.isTrue(calls.some((call) => Array.isArray(call) && call[0] === "status"));
    }),
  );
});
