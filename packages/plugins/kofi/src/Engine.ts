import { Effect, Layer } from "effect";

import { ClientRpcs, KofiEngine, WebhookId } from "./Definition.ts";

export const make = (makeWebhookId: () => string = () => crypto.randomUUID()) =>
  KofiEngine.toLayer((mg) =>
    Effect.succeed({
      resources: Layer.empty,
      rpcs: Layer.empty,
      client: {
        state: mg.storage.get.pipe(
          Effect.map((storage) => ({
            webhooks: Object.keys(storage.webhooks).map((id) => ({
              id: WebhookId.make(id),
            })),
          })),
        ),
        rpcs: ClientRpcs.toLayer({
          KofiCreateWebhook: Effect.fnUntraced(function* ({ verificationToken }) {
            const webhookId = WebhookId.make(makeWebhookId());
            yield* mg.storage.update((storage) => ({
              webhooks: {
                ...storage.webhooks,
                [webhookId]: { verificationToken },
              },
            }));
            yield* mg.client.refresh;
            return webhookId;
          }),
          KofiRemoveWebhook: Effect.fnUntraced(function* ({ webhookId }) {
            yield* mg.storage.update((storage) => {
              const webhooks = { ...storage.webhooks };
              delete webhooks[webhookId];
              return { webhooks };
            });
            yield* mg.client.refresh;
          }),
        }),
      },
    }),
  );

export default make();
