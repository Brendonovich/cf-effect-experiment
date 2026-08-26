import { DataType, Plugin } from "@macrograph/plugin";
import { Effect, Option } from "effect";

import { KofiEngine, KofiWebhook } from "./Definition.ts";

export default Plugin.make({
  id: "kofi",
  name: "Ko-fi",
  engine: KofiEngine,
  effect: Effect.fnUntraced(function* (ctx) {
    yield* ctx.schema.register({
      id: "webhook:payment",
      name: "Payment Received",
      description: "Runs when the selected Ko-fi webhook reports a completed payment.",
      type: "event",
      properties: {
        webhook: {
          name: "Webhook",
          description: "The configured Ko-fi webhook.",
          resource: KofiWebhook,
        },
      },
      event: (event, { properties }) =>
        Effect.succeed(event.webhookId === properties.webhook),
      io: (io) => ({
        type: io.data.out("type", DataType.String, { name: "Type" }),
        fromName: io.data.out("fromName", DataType.String, { name: "From Name" }),
        amount: io.data.out("amount", DataType.String, { name: "Amount" }),
        currency: io.data.out("currency", DataType.String, { name: "Currency" }),
        message: io.data.out("message", DataType.Option(DataType.String), { name: "Message" }),
        email: io.data.out("email", DataType.String, { name: "Email" }),
        transactionId: io.data.out("transactionId", DataType.String, { name: "Transaction ID" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event === undefined) return;
          io.type(event._tag);
          io.fromName(event.from_name);
          io.amount(event.amount);
          io.currency(event.currency);
          io.message(Option.fromNullOr(event.message));
          io.email(event.email);
          io.transactionId(event.kofi_transaction_id);
        }),
    });
  }),
});
