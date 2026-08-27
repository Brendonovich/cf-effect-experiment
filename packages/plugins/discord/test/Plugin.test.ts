import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect } from "effect";

import deployment from "../src/Deployment.ts";
import plugin from "../src/Plugin.ts";

describe("Discord plugin", () => {
  it.effect("registers all six legacy concepts and a matching standalone deployment", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        [
          "DiscordMessage",
          "DiscordSendMessage",
          "DiscordGetUser",
          "DiscordGetGuildMember",
          "DiscordGetRole",
          "DiscordSendWebhook",
        ],
      );
      assert.strictEqual(deployment.pluginId, "discord");
      assert.strictEqual(deployment.definition, plugin.engine);
    }),
  );
});
