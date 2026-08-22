import { Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import { KofiEngine } from "./Definition.ts";

export default Plugin.make({
  id: "kofi",
  name: "Ko-fi",
  engine: KofiEngine,
  effect: Effect.fnUntraced(function* (ctx) {
    yield* ctx.schema.register({
      id: "webhook:payment",
      name: "Payment Received",
      type: "event",
      event: () => Effect.succeed(true),
      io: (io) => ({
        type: io.data.out<string>("type"),
        fromName: io.data.out<string>("fromName"),
        amount: io.data.out<string>("amount"),
        currency: io.data.out<string>("currency"),
        message: io.data.out<string | null>("message"),
        email: io.data.out<string>("email"),
        transactionId: io.data.out<string>("transactionId"),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event === undefined) return;
          io.type(event._tag);
          io.fromName(event.from_name);
          io.amount(event.amount);
          io.currency(event.currency);
          io.message(event.message);
          io.email(event.email);
          io.transactionId(event.kofi_transaction_id);
        }),
    });
  }),
});
