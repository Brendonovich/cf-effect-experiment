import { Effect, Layer } from "effect";

import { ClientRpcs, KofiEngine, KofiWebhook, WebhookId } from "./Definition.ts";

export const make = (makeWebhookId: () => string = () => crypto.randomUUID()) =>
  KofiEngine.toLayer((mg) =>
    Effect.succeed({
      resources: KofiWebhook.toLayer(
        mg.storage.get.pipe(
          Effect.map((storage) =>
            Object.entries(storage.webhooks).map(([id, webhook]) => ({
              id: WebhookId.make(id),
              display: webhook.name ?? "Webhook",
            })),
          ),
        ),
      ),
      rpcs: Layer.empty,
      client: {
        state: mg.storage.get.pipe(
          Effect.map((storage) => ({
            webhooks: Object.entries(storage.webhooks).map(([id, webhook]) => ({
              id: WebhookId.make(id),
              name: webhook.name ?? "Webhook",
            })),
          })),
        ),
        rpcs: ClientRpcs.toLayer({
          KofiCreateWebhook: Effect.fnUntraced(function* ({ name, verificationToken }) {
            const webhookId = WebhookId.make(makeWebhookId());
            yield* mg.storage.update((storage) => ({
              webhooks: {
                ...storage.webhooks,
                [webhookId]: { name, verificationToken },
              },
            }));
            yield* mg.resource.refresh(KofiWebhook);
            yield* mg.client.refresh;
            return webhookId;
          }),
          KofiRenameWebhook: Effect.fnUntraced(function* ({ webhookId, name }) {
            yield* mg.storage.update((storage) => {
              const webhook = storage.webhooks[webhookId];
              if (webhook === undefined) return storage;
              return {
                webhooks: {
                  ...storage.webhooks,
                  [webhookId]: { ...webhook, name },
                },
              };
            });
            yield* mg.resource.refresh(KofiWebhook);
            yield* mg.client.refresh;
          }),
          KofiRemoveWebhook: Effect.fnUntraced(function* ({ webhookId }) {
            yield* mg.storage.update((storage) => {
              const webhooks = { ...storage.webhooks };
              delete webhooks[webhookId];
              return { webhooks };
            });
            yield* mg.resource.refresh(KofiWebhook);
            yield* mg.client.refresh;
          }),
        }),
      },
    }),
  );

export default make();
