import { Engine } from "@macrograph/plugin";
import { Effect } from "effect";

import { WebhookId } from "../Definition.ts";
import KofiEngineLive from "../Engine.ts";
import KofiPlugin from "../Plugin.ts";
import { handler, WebhookIngress } from "../Webhook.ts";

export default Engine.withHttpIngress(Engine.deployment(KofiPlugin, KofiEngineLive), {
  handlers: [handler],
  requirements: (state) =>
    Effect.succeed(
      Object.entries(state.webhooks).map(([webhookId, webhook]) =>
        WebhookIngress.require({
          instanceKey: webhookId,
          metadata: { webhookId: WebhookId.make(webhookId) },
          configuration: { verificationToken: webhook.verificationToken },
        }),
      ),
    ),
});
