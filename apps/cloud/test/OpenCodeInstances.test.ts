import { assert, describe, it } from "@effect/vitest";
import { ConnectionId } from "@macrograph/module-opencode/Definition";
import { Effect } from "effect";

import * as OpenCodeInstances from "../src/opencode/OpenCodeInstances.ts";

const writer = ConnectionId.make("writer");

const namespace = (
  calls: Array<unknown>,
  applied = '{"applied":true}',
): OpenCodeInstances.Namespace => ({
  getByName: (name) => ({
    ensure: (config) => Effect.sync(() => void calls.push(["ensure", name, config])),
    provision: (config) =>
      Effect.sync(() => {
        calls.push(["provision", name, config]);
        return applied;
      }),
    generateText: (input) => Effect.sync(() => (calls.push(["generate", name, input]), "text")),
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

describe("Cloud OpenCode instances", () => {
  it.effect("names one Durable Object per project connection", () =>
    Effect.sync(() => {
      assert.strictEqual(OpenCodeInstances.objectName("project", "writer"), "project:writer");
    }),
  );

  it.effect("production applies the deployed managed config before use", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const instances = OpenCodeInstances.make(
        Effect.succeed("project"),
        namespace(calls),
        "production",
      );
      assert.deepStrictEqual(instances.connectionTypes, ["managed", "remote"]);
      const instance = yield* instances.resolve({
        id: writer,
        target: { type: "managed", config: '{"model":"p/m"}' },
      });
      assert.isUndefined(instance.appliedConfig);
      assert.strictEqual(yield* instance.generateText({ prompt: "Hello", model: "" }), "text");
      assert.deepStrictEqual(calls, [
        ["ensure", "project:writer", '{"model":"p/m"}'],
        ["generate", "project:writer", { prompt: "Hello", model: "" }],
      ]);
    }),
  );

  it.effect("the editor provisions without applying config and reports the applied config", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const instances = OpenCodeInstances.make(
        Effect.succeed("project"),
        namespace(calls),
        "editor",
      );
      const instance = yield* instances.resolve({
        id: writer,
        target: { type: "managed", config: '{"edited":true}' },
      });
      assert.strictEqual(instance.appliedConfig, '{"applied":true}');
      assert.deepStrictEqual(calls, [["provision", "project:writer", '{"edited":true}']]);
    }),
  );

  it.effect("deploys apply each managed connection's config to its production instance", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      yield* OpenCodeInstances.applyDeployment(
        "project",
        {
          opencode: {
            connections: {
              writer: { name: "Writer", target: { type: "managed", config: '{"v":2}' } },
              remote: {
                name: "Remote",
                target: { type: "remote", url: "https://opencode.example.com", password: "" },
              },
            },
          },
        },
        namespace(calls),
      );
      assert.deepStrictEqual(calls, [["ensure", "project:writer", '{"v":2}']]);
    }),
  );

  it.effect("connects remote targets without touching Durable Objects", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const instances = OpenCodeInstances.make(
        Effect.succeed("project"),
        { getByName: () => assert.fail("remote targets must not create a Durable Object") },
        "editor",
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
        id: writer,
        target: { type: "remote", url: "https://opencode.example.com", password: "secret" },
      });
      assert.strictEqual(yield* instance.generateText({ prompt: "Hi", model: "" }), "remote");
      assert.deepStrictEqual(calls, [{ url: "https://opencode.example.com", password: "secret" }]);
    }),
  );
});
