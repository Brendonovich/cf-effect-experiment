import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import * as OpenCodeInstances from "../src/opencode/OpenCodeInstances.ts";

describe("Cloud OpenCode instances", () => {
  it.effect("lazily resolves managed project instances through their Durable Object", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const instances = OpenCodeInstances.make(Effect.succeed("project"), {
        getByName: (name) => ({
          ensure: (config) => Effect.sync(() => calls.push(["ensure", name, config])),
          generateText: (input) => Effect.sync(() => (calls.push(["generate", input]), "text")),
          listModels: () => Effect.succeed(["provider/model"]),
          listCredentials: () => Effect.succeed([]),
          listOAuthMethods: () => Effect.succeed([]),
          connectKey: () => Effect.void,
          removeCredential: () => Effect.void,
          startOAuth: () => Effect.die("unused"),
          oauthStatus: () => Effect.die("unused"),
          completeOAuth: () => Effect.die("unused"),
          cancelOAuth: () => Effect.die("unused"),
        }),
      });
      assert.strictEqual(instances.defaultTarget, "managed");
      assert.deepStrictEqual(instances.availableTargets, ["managed", "remote"]);
      const instance = yield* instances.resolve({ type: "managed", config: '{"model":"p/m"}' });
      assert.strictEqual(
        yield* instance.generateText({ prompt: "Hello", model: "provider/model" }),
        "text",
      );
      assert.deepStrictEqual(yield* instance.listModels, ["provider/model"]);
      assert.deepStrictEqual(calls, [
        ["ensure", "project", '{"model":"p/m"}'],
        ["generate", { prompt: "Hello", model: "provider/model" }],
      ]);
    }),
  );

  it.effect("connects remote targets without touching Durable Objects", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const instances = OpenCodeInstances.make(
        Effect.succeed("project"),
        { getByName: () => assert.fail("remote targets must not create a Durable Object") },
        async (input) => {
          calls.push(input);
          return {
            generateText: async () => "remote",
            listModels: async () => ["remote/model"],
            listCredentials: async () => [],
            listOAuthMethods: async () => [],
            connectKey: async () => {},
            removeCredential: async () => {},
            startOAuth: async () => assert.fail("unused"),
            oauthStatus: async () => assert.fail("unused"),
            completeOAuth: async () => {},
            cancelOAuth: async () => {},
            close: async () => {},
          };
        },
      );
      const instance = yield* instances.resolve({
        type: "remote",
        url: "https://opencode.example.com",
        password: "secret",
      });
      assert.strictEqual(yield* instance.generateText({ prompt: "Hi", model: "" }), "remote");
      assert.deepStrictEqual(calls, [{ url: "https://opencode.example.com", password: "secret" }]);
    }),
  );
});
