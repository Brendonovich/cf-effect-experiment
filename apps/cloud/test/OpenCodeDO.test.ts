import type { Service } from "@macrograph/opencode-workerd";

import { assert, describe, it } from "@effect/vitest";

import { makeController } from "../src/opencode/OpenCodeDO.ts";

const service = (name: string, closed: Array<string>): Service => ({
  generateText: async () => name,
  listModels: async () => [],
  listCredentials: async () => [],
  listOAuthMethods: async () => [],
  connectKey: async () => {},
  removeCredential: async () => {},
  startOAuth: async () => assert.fail("unused"),
  oauthStatus: async () => assert.fail("unused"),
  completeOAuth: async () => {},
  cancelOAuth: async () => {},
  close: async () => void closed.push(name),
});

describe("OpenCode Durable Object", () => {
  it("creates hosts lazily, reuses matching config and rebuilds changed config", async () => {
    const values = new Map<string, string>();
    const created: Array<string> = [];
    const closed: Array<string> = [];
    const controller = makeController(
      {
        get: async (key) => values.get(key),
        put: async (key, value) => void values.set(key, value),
      },
      async (config) => {
        created.push(config);
        return service(config, closed);
      },
    );
    assert.deepStrictEqual(created, []);
    await controller.ensure('{"model":"one"}');
    await controller.ensure('{"model":"one"}');
    assert.deepStrictEqual(created, ['{"model":"one"}']);
    await controller.ensure('{"model":"two"}');
    assert.deepStrictEqual(created, ['{"model":"one"}', '{"model":"two"}']);
    assert.deepStrictEqual(closed, ['{"model":"one"}']);
  });

  it("restores persisted config on first use without eager creation", async () => {
    const created: Array<string> = [];
    const controller = makeController(
      {
        get: async () => '{"model":"persisted"}',
        put: async () => {},
      },
      async (config) => {
        created.push(config);
        return service(config, []);
      },
    );
    assert.deepStrictEqual(created, []);
    assert.strictEqual(
      await (await controller.service()).generateText({ prompt: "", model: "" }),
      '{"model":"persisted"}',
    );
    assert.deepStrictEqual(created, ['{"model":"persisted"}']);
  });
});
