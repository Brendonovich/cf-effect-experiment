import { assert, describe, it } from "@effect/vitest";
import { HttpEndpoint, HttpIngress } from "@macrograph/plugin";
import { Effect } from "effect";

import { WebhookId } from "../src/Definition.ts";
import deployment from "../src/Deployment/Webhook.ts";
import { handler as webhookHandler } from "../src/Webhook.ts";

const delivery = {
  verification_token: "secret-token",
  message_id: "message-1",
  timestamp: "2026-08-21T10:00:00Z",
  type: "Donation",
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
};

const request = (verificationToken: string) => ({
  endpoint: {
    id: HttpEndpoint.Id.make("endpoint-1"),
    url: "https://example.com/ingress/project/endpoint-1",
    schema: { id: HttpEndpoint.HandlerId.make("kofi:payment"), displayName: "Webhook" },
    instanceKey: HttpEndpoint.InstanceKey.make("primary"),
    metadata: { webhookId: "primary" },
  },
  configuration: { verificationToken },
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new TextEncoder().encode(
    new URLSearchParams({ data: JSON.stringify(delivery) }).toString(),
  ),
});

describe("Ko-fi webhook", () => {
  it.effect("derives a webhook requirement from engine state", () =>
    Effect.gen(function* () {
      const requirements = yield* deployment.httpIngress.requirements({
        webhooks: { [WebhookId.make("primary")]: { verificationToken: "secret-token" } },
      });
      assert.deepStrictEqual(yield* HttpIngress.manifest(requirements), [
        {
          handlerId: HttpEndpoint.HandlerId.make("kofi:payment"),
          pluginId: "kofi",
          instanceKey: HttpEndpoint.InstanceKey.make("primary"),
          displayName: "Webhook",
          metadata: { webhookId: "primary" },
          configuration: { verificationToken: "secret-token" },
        },
      ]);
    }),
  );

  it.effect("uses the configured webhook name as its endpoint display name", () =>
    Effect.gen(function* () {
      const requirements = yield* deployment.httpIngress.requirements({
        webhooks: {
          [WebhookId.make("primary")]: {
            name: "Supporter Donations",
            verificationToken: "secret-token",
          },
        },
      });
      const manifest = yield* HttpIngress.manifest(requirements);
      assert.strictEqual(manifest[0]?.displayName, "Supporter Donations");
    }),
  );

  it.effect("accepts a verified form-encoded payment", () =>
    Effect.gen(function* () {
      const handler = yield* webhookHandler.build;
      const response = yield* handler.handle(request("secret-token"));
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.events[0]?.eventType, "Donation");
      assert.strictEqual(response.events[0]?.eventId, "message-1");
      assert.deepInclude(response.events[0]?.payload, { webhookId: "primary" });
    }),
  );

  it.effect("rejects an invalid verification token", () =>
    Effect.gen(function* () {
      const handler = yield* webhookHandler.build;
      const response = yield* handler.handle(request("different-token"));
      assert.strictEqual(response.status, 403);
      assert.deepStrictEqual(response.events, []);
    }),
  );
});
