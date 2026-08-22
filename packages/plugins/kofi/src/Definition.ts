import { Engine } from "@macrograph/plugin";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const WebhookId = Schema.String.pipe(Schema.brand("KofiWebhookId"));
export type WebhookId = typeof WebhookId.Type;

export const PaymentType = Schema.Literals([
  "Donation",
  "Subscription",
  "Commission",
  "Shop Order",
]);
export type PaymentType = typeof PaymentType.Type;

export const ShopItem = Schema.Struct({
  direct_link_code: Schema.String,
  variation_name: Schema.String,
  quantity: Schema.Number,
});

export const Shipping = Schema.Struct({
  full_name: Schema.String,
  street_address: Schema.String,
  city: Schema.String,
  state_or_province: Schema.String,
  postal_code: Schema.String,
  country: Schema.String,
  country_code: Schema.String,
  telephone: Schema.String,
});

export const Payment = Schema.Struct({
  _tag: PaymentType,
  message_id: Schema.String,
  timestamp: Schema.String,
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
export type Payment = typeof Payment.Type;

export const RuntimeStorage = Schema.Struct({
  webhooks: Schema.Record(
    WebhookId,
    Schema.Struct({
      verificationToken: Schema.String,
    }),
  ),
});

export const ClientState = Schema.Struct({
  webhooks: Schema.Array(Schema.Struct({ id: WebhookId })),
});

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("KofiCreateWebhook", {
    payload: Schema.Struct({ verificationToken: Schema.String }),
    success: WebhookId,
  }),
  Rpc.make("KofiRemoveWebhook", {
    payload: Schema.Struct({ webhookId: WebhookId }),
  }),
) {}

export class KofiEngine extends Engine.make({
  events: Array.empty<Payment>(),
  storage: RuntimeStorage,
  initialStorage: { webhooks: {} },
  client: {
    state: ClientState,
    rpcs: ClientRpcs,
  },
}) {}
