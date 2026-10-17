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
            connectKey: async () => {},
            removeCredential: async () => {},
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
