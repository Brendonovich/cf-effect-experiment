import { Engine } from "@macrograph/module";
import { Effect } from "effect";

import SendblueEngineLive from "../Engine.ts";
import SendblueModule from "../Module.ts";
import { handler, WebhookIngress } from "../Webhook.ts";

export default Engine.withHttpIngress(Engine.deployment(SendblueModule, SendblueEngineLive), {
  handlers: [handler],
  requirements: (state) =>
    Effect.succeed(
      state.webhookSecret === null
        ? []
        : [
            WebhookIngress.require({
              instanceKey: "receive",
              metadata: {},
              configuration: { signingSecret: state.webhookSecret },
            }),
          ],
    ),
});
