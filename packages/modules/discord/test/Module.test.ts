import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/module";
import { Effect } from "effect";

import deployment from "../src/Deployment.ts";
import module, { restModule } from "../src/Module.ts";
import restDeployment from "../src/RestDeployment.ts";

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

  it.effect("omits gateway events from the REST-only deployment", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(restModule.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        [
          "DiscordSendMessage",
          "DiscordGetUser",
          "DiscordGetGuildMember",
          "DiscordGetRole",
          "DiscordSendWebhook",
        ],
      );
      assert.strictEqual(restDeployment.moduleId, "discord");
      assert.strictEqual(restDeployment.module, restModule);
      assert.strictEqual(restDeployment.definition, module.engine);
    }),
  );
});
