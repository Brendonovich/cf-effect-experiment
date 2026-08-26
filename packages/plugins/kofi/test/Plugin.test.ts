import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect } from "effect";

import { KofiWebhook, WebhookId } from "../src/Definition.ts";
import KofiPlugin from "../src/Plugin.ts";

const payment = (webhookId: WebhookId) => ({
  _tag: "Donation" as const,
  webhookId,
  message_id: "message-1",
  timestamp: "2026-08-21T10:00:00Z",
  is_public: true,
  from_name: "A Supporter",
  message: "Keep going!",
  amount: "5.00",
  url: "https://ko-fi.com/",
  email: "supporter@example.com",
  currency: "USD",
  is_subscription_payment: false,
  is_first_subscription_payment: false,
  kofi_transaction_id: "transaction-1",
});

describe("Ko-fi plugin", () => {
  it.effect("only matches payments from the selected webhook resource", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(KofiPlugin.effect);
      const schema = schemas[0]!;
      const webhookId = WebhookId.make("primary");
      const otherWebhookId = WebhookId.make("other");

      assert.deepStrictEqual(
        schema.properties.map((property) => ({
          id: property.id,
          resource: "resource" in property ? property.resource : undefined,
        })),
        [{ id: "webhook", resource: KofiWebhook.key }],
      );
      assert.isTrue(yield* schema.matches(payment(webhookId), { webhook: webhookId }));
      assert.isFalse(yield* schema.matches(payment(otherWebhookId), { webhook: webhookId }));
    }),
  );
});
