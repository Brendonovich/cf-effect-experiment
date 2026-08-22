import { HttpIngress } from "@macrograph/plugin";
import { Effect, Option, Schema } from "effect";

import { Payment, PaymentType, Shipping, ShopItem, WebhookId } from "./Definition.ts";

export const WebhookMetadata = Schema.Struct({ webhookId: WebhookId });
export type WebhookMetadata = typeof WebhookMetadata.Type;

export const WebhookConfiguration = Schema.Struct({ verificationToken: Schema.String });
export type WebhookConfiguration = typeof WebhookConfiguration.Type;

export const WebhookIngress = HttpIngress.make({
  id: "kofi:payment",
  pluginId: "kofi",
  method: "POST",
  metadata: WebhookMetadata,
  event: Payment,
  configuration: WebhookConfiguration,
});

const Delivery = Schema.Struct({
  verification_token: Schema.String,
  message_id: Schema.String,
  timestamp: Schema.String,
  type: PaymentType,
  is_public: Schema.Boolean,
  from_name: Schema.String,
  message: Schema.NullOr(Schema.String),
  amount: Schema.String,
  url: Schema.String,
  email: Schema.String,
  currency: Schema.String,
  is_subscription_payment: Schema.Boolean,
  is_first_subscription_payment: Schema.Boolean,
  kofi_transaction_id: Schema.String,
  shop_items: Schema.optional(Schema.NullOr(Schema.Array(ShopItem))),
  tier_name: Schema.optional(Schema.NullOr(Schema.String)),
  shipping: Schema.optional(Schema.NullOr(Shipping)),
});

const decodeDelivery = Schema.decodeUnknownEffect(Schema.fromJsonString(Delivery));

export const handler = WebhookIngress.implement(
  Effect.succeed(
    Effect.succeed({
      handle: Effect.fnUntraced(function* (request) {
        const data = new URLSearchParams(new TextDecoder().decode(request.body)).get("data");
        if (data === null) return { status: 400 };
        const delivery = yield* decodeDelivery(data).pipe(Effect.option);
        if (Option.isNone(delivery)) return { status: 400 };
        if (delivery.value.verification_token !== request.configuration.verificationToken)
          return { status: 403 };

        const { verification_token: _, type, ...fields } = delivery.value;
        const event: Payment = { _tag: type, ...fields };
        return {
          status: 200,
          events: [{ event, eventId: event.message_id }],
        };
      }),
    }),
  ),
);
