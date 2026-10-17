import { assert, describe, expect, it } from "vitest";

import { decodeConfig, fromHost, type Host } from "../src/index.ts";

const host = (calls: Array<unknown>): Host => ({
  generate: {
    text: async (input) => {
      calls.push(["generate", input]);
      return { text: "Response" };
    },
  },
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
  credential: {
    list: async () => [
      { id: "credential", integrationID: "opencode", label: "Console", active: true },
    ],
    remove: async (input) => {
      calls.push(["remove", input]);
    },
  },
  integration: {
    list: async () => ({
      data: [
        {
          id: "opencode",
          name: "OpenCode Console",
          methods: [
            { type: "oauth", id: "workspace", label: "Sign in" },
            { type: "oauth", id: "configured", label: "Configured OAuth", form: [{}] },
            { type: "key" },
          ],
        },
      ],
    }),
    connect: {
      key: async (input) => {
        calls.push(["connect", input]);
      },
    },
    oauth: {
      connect: async (input) => {
        calls.push(["oauth-connect", input]);
        return {
          data: {
            attemptID: "attempt",
            url: "https://opencode.ai/auth",
            instructions: "Authorize in your browser",
            mode: "auto",
            time: { expires: 100 },
          },
        };
      },
      status: async (input) => {
        calls.push(["oauth-status", input]);
        return { data: { status: "complete" } };
      },
      complete: async (input) => {
        calls.push(["oauth-complete", input]);
      },
      cancel: async (input) => {
        calls.push(["oauth-cancel", input]);
      },
    },
  },
});

describe("OpenCode Workerd adapter", () => {
  it("adapts one-shot generation and the enabled model catalog", async () => {
    const calls: Array<unknown> = [];
    const service = fromHost(host(calls));
    assert.strictEqual(
      await service.generateText({ prompt: "Hello", model: "anthropic/claude" }),
      "Response",
    );
    assert.strictEqual(await service.generateText({ prompt: "Default", model: "" }), "Response");
    assert.deepStrictEqual(await service.listModels(), ["anthropic/claude", "openai/gpt"]);
    assert.deepStrictEqual(calls, [
      ["generate", { prompt: "Hello", model: { providerID: "anthropic", id: "claude" } }],
      ["generate", { prompt: "Default" }],
    ]);
  });

  it("exposes credential metadata without secret values", async () => {
    const calls: Array<unknown> = [];
    const service = fromHost(host(calls));
    assert.deepStrictEqual(await service.listCredentials(), [
      { id: "credential", integrationID: "opencode", label: "Console", active: true },
    ]);
    await service.connectKey({ integrationID: "opencode", key: "secret" });
    await service.removeCredential("credential");
    assert.deepStrictEqual(calls, [
      ["connect", { integrationID: "opencode", key: "secret" }],
      ["remove", { credentialID: "credential" }],
    ]);
  });

  it("discovers and drives OAuth integrations", async () => {
    const calls: Array<unknown> = [];
    const service = fromHost(host(calls));
    assert.deepStrictEqual(await service.listOAuthMethods(), [
      {
        integrationID: "opencode",
        integrationName: "OpenCode Console",
        methodID: "workspace",
        label: "Sign in",
      },
    ]);
    assert.deepStrictEqual(
      await service.startOAuth({ integrationID: "opencode", methodID: "workspace" }),
      {
        integrationID: "opencode",
        attemptID: "attempt",
        url: "https://opencode.ai/auth",
        instructions: "Authorize in your browser",
        mode: "auto",
        expires: 100,
      },
    );
    assert.deepStrictEqual(
      await service.oauthStatus({ integrationID: "opencode", attemptID: "attempt" }),
      { status: "complete" },
    );
    await service.completeOAuth({
      integrationID: "opencode",
      attemptID: "attempt",
      code: " code ",
    });
    await service.cancelOAuth({ integrationID: "opencode", attemptID: "attempt" });
    assert.deepStrictEqual(calls, [
      ["oauth-connect", { integrationID: "opencode", methodID: "workspace" }],
      ["oauth-status", { integrationID: "opencode", attemptID: "attempt" }],
      ["oauth-complete", { integrationID: "opencode", attemptID: "attempt", code: "code" }],
      ["oauth-cancel", { integrationID: "opencode", attemptID: "attempt" }],
    ]);
  });

  it("rejects malformed model references before generation", async () => {
    await expect(
      fromHost(host([])).generateText({ prompt: "Hello", model: "invalid" }),
    ).rejects.toThrow(/provider\/model/);
  });

  it("validates managed OpenCode configuration", async () => {
    assert.deepStrictEqual(await decodeConfig('{"model":"anthropic/claude"}'), {
      model: { providerID: "anthropic", model: "claude" },
    });
    await expect(decodeConfig("[]")).rejects.toThrow();
    await expect(decodeConfig('{"unknown":true}')).rejects.toThrow();
  });
});
