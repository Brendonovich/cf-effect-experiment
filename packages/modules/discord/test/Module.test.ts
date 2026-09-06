import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/module";
import { Effect } from "effect";

import deployment from "../src/Deployment.ts";
import module from "../src/Module.ts";

describe("Discord module", () => {
  it.effect("registers all six legacy concepts and a matching standalone deployment", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(module.effect);
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
      assert.strictEqual(deployment.moduleId, "discord");
      assert.strictEqual(deployment.definition, module.engine);
    }),
  );
});
