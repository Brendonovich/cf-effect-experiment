import { Engine } from "@macrograph/module";
import { Effect, Layer } from "effect";

import { WebhookId } from "../Definition.ts";
import { layer, webhookEndpointsLayer } from "../Engine.ts";
import GitHubModule from "../Module.ts";
import { handler, WebhookIngress } from "../Webhook.ts";

const deployment = Engine.deployment(
  GitHubModule,
  layer.pipe(Layer.provide(webhookEndpointsLayer)),
);

export default Engine.withHttpIngress(deployment, {
  handlers: [handler],
  requirements: (state) =>
    Effect.succeed(
      Object.entries(state.webhooks).map(([webhookId, webhook]) =>
        WebhookIngress.require({
          instanceKey: webhookId,
          displayName: webhook.name,
          metadata: {
            webhookId: WebhookId.make(webhookId),
            owner: webhook.owner,
            repository: webhook.repository,
          },
          configuration: { events: webhook.events },
        }),
      ),
    ),
});
