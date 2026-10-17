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
    connect: {
      key: async (input) => {
        calls.push(["connect", input]);
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
