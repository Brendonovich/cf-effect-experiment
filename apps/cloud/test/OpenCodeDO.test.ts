import type { Service as WorkerdService } from "@macrograph/opencode-workerd";

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import { makeService } from "../src/opencode/OpenCodeDO.ts";

const makeHost = (): WorkerdService => ({
  generateText: async ({ prompt, model }) => `${model || "default/default"}: ${prompt}`,
  listModels: async () => ["provider/first", "provider/second"],
  listCredentials: async () => [
    { id: "credential", integrationID: "opencode", label: "Console", active: true },
  ],
  listOAuthMethods: async () => [
    {
      integrationID: "opencode",
      integrationName: "OpenCode Console",
      methodID: "oauth",
      label: "Sign in",
    },
  ],
  connectKey: async () => {},
  removeCredential: async () => {},
  startOAuth: async ({ integrationID }) => ({
    integrationID,
    attemptID: "attempt",
    url: "https://opencode.ai/auth",
    instructions: "Authorize",
    mode: "auto",
    expires: 100,
  }),
  oauthStatus: async () => ({ status: "pending" }),
  completeOAuth: async () => {},
  cancelOAuth: async () => {},
});

describe("OpenCode Durable Object service", () => {
  it.effect("adapts model generation, catalog and credential state", () =>
    Effect.gen(function* () {
      const service = makeService(makeHost());
      assert.strictEqual(
        yield* service.generateText({ prompt: "Hello", model: "provider/model" }),
        "provider/model: Hello",
      );
      assert.strictEqual(
        yield* service.generateText({ prompt: "Hello", model: "" }),
        "default/default: Hello",
      );
      assert.deepStrictEqual(yield* service.listModels(), ["provider/first", "provider/second"]);
      assert.deepStrictEqual(yield* service.clientState(), {
        mode: "cloudflare",
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
    }),
  );

  it.effect("normalizes credentials and keeps keys out of state", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const host: WorkerdService = {
        ...makeHost(),
        connectKey: async (input) => {
          calls.push(["connect", input]);
        },
        listCredentials: async () => [],
        listOAuthMethods: async () => [],
        removeCredential: async (credentialID) => {
          calls.push(["remove", credentialID]);
        },
      };
      const service = makeService(host);
      yield* service.connectKey({ integrationID: " opencode ", key: " secret " });
      yield* service.removeCredential("credential");
      assert.deepStrictEqual(calls, [
        ["connect", { integrationID: "opencode", key: "secret" }],
        ["remove", "credential"],
      ]);
      assert.deepStrictEqual(yield* service.clientState(), {
        mode: "cloudflare",
        credentials: [],
        oauthMethods: [],
      });
    }),
  );

  it.effect("turns invalid input and SDK failures into typed request failures", () =>
    Effect.gen(function* () {
      const service = makeService({
        ...makeHost(),
        generateText: async () => Promise.reject(new Error("Provider unavailable")),
      });
      const invalid = yield* Effect.result(
        service.connectKey({ integrationID: "", key: "secret" }),
      );
      assert.isTrue(Result.isFailure(invalid));
      if (Result.isFailure(invalid))
        assert.strictEqual(invalid.failure.reason, "Provider ID and API key are required");
      const failed = yield* Effect.result(
        service.generateText({ prompt: "Hello", model: "provider/model" }),
      );
      assert.isTrue(Result.isFailure(failed));
      if (Result.isFailure(failed))
        assert.strictEqual(failed.failure.reason, "Provider unavailable");
    }),
  );
});
