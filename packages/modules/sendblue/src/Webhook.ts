import * as HttpIngress from "@macrograph/module/HttpIngress";
import { Effect, Option, Schema } from "effect";

import { InboundMessage } from "./Definition.ts";

export const WebhookIngress = HttpIngress.make({
  id: "sendblue:receive",
  moduleId: "sendblue",
  displayName: "Receive Messages",
  method: "POST",
  metadata: Schema.Struct({}),
  event: InboundMessage,
  configuration: Schema.Struct({ signingSecret: Schema.String }),
});

const Delivery = Schema.Struct({
  message_handle: Schema.String,
  is_outbound: Schema.Boolean,
  status: Schema.String,
  from_number: Schema.String,
  to_number: Schema.optionalKey(Schema.String),
  sendblue_number: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.String),
  media_url: Schema.optionalKey(Schema.String),
  service: Schema.optionalKey(Schema.String),
  message_type: Schema.optionalKey(Schema.String),
  group_id: Schema.optionalKey(Schema.String),
  date_sent: Schema.optionalKey(Schema.String),
});

const equalSecret = (left: string, right: string) => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++)
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
};

export const handler = WebhookIngress.implement(
  Effect.succeed(
    Effect.succeed({
      handle: Effect.fnUntraced(function* (request) {
        const providedSecret = request.headers["sb-signing-secret"] ?? "";
        if (!equalSecret(providedSecret, request.configuration.signingSecret))
          return { status: 403 };
        const delivery = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Delivery))(
          new TextDecoder().decode(request.body),
        ).pipe(Effect.option);
        if (Option.isNone(delivery)) return { status: 400 };
        if (delivery.value.is_outbound || delivery.value.status !== "RECEIVED")
          return { status: 200 };
        const value = delivery.value;
        const event: InboundMessage = {
          _tag: "SendblueMessageReceived",
          messageHandle: value.message_handle,
          fromNumber: value.from_number,
          toNumber: value.to_number ?? value.sendblue_number ?? "",
          content: value.content ?? "",
          mediaUrl: value.media_url ?? "",
          service: value.service ?? "",
          messageType: value.message_type ?? "message",
          groupId: value.group_id ?? "",
          dateSent: value.date_sent ?? "",
        };
        return { status: 200, events: [{ event, eventId: event.messageHandle }] };
      }),
    }),
  ),
);
