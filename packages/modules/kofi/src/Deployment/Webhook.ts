import { Engine } from "@macrograph/module";
import { Effect } from "effect";

import { WebhookId } from "../Definition.ts";
import KofiEngineLive from "../Engine.ts";
import KofiModule from "../Module.ts";
import { handler, WebhookIngress } from "../Webhook.ts";

export default Engine.withHttpIngress(Engine.deployment(KofiModule, KofiEngineLive), {
  handlers: [handler],
  requirements: (state) =>
    Effect.succeed(
      Object.entries(state.webhooks).map(([webhookId, webhook]) =>
        WebhookIngress.require({
          instanceKey: webhookId,
          displayName: webhook.name ?? "Webhook",
          metadata: { webhookId: WebhookId.make(webhookId) },
          configuration: { verificationToken: webhook.verificationToken },
        }),
      ),
    ),
});
