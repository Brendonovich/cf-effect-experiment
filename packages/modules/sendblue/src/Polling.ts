import * as PollingIngress from "@macrograph/module/PollingIngress";
import { Clock, Effect, Schema } from "effect";
import { Headers, HttpClient, HttpClientRequest } from "effect/http";

import { InboundMessage, type SendblueEngine } from "./Definition.ts";

export const Configuration = Schema.Struct({ apiKey: Schema.String, apiSecret: Schema.String });
export type Configuration = typeof Configuration.Type;
export const Cursor = Schema.Struct({
  sentAt: Schema.String,
  handles: Schema.Array(Schema.String),
});
export type Cursor = typeof Cursor.Type;

const Message = Schema.Struct({
  message_handle: Schema.String,
  from_number: Schema.String,
  to_number: Schema.optionalKey(Schema.String),
  sendblue_number: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.String),
  media_url: Schema.optionalKey(Schema.String),
  service: Schema.optionalKey(Schema.String),
  message_type: Schema.optionalKey(Schema.String),
  group_id: Schema.optionalKey(Schema.String),
  date_sent: Schema.String,
});
const MessagesResponse = Schema.Struct({ data: Schema.Array(Message) });

export class ProviderFailure extends Schema.TaggedError<ProviderFailure>()(
  "SendbluePollingProviderFailure",
  { status: Schema.Number },
) {}

export const handler = PollingIngress.make({
  id: "sendblue:messages",
  moduleId: "sendblue",
  displayName: "Received Messages",
  intervalMs: 5_000,
  configuration: Configuration,
  cursor: Cursor,
  event: InboundMessage,
  initialCursor: () =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => ({ sentAt: new Date(now - 10_000).toISOString(), handles: [] })),
    ),
  poll: Effect.fnUntraced(
    function* ({ configuration, cursor }) {
      const client = HttpClient.withScope(yield* HttpClient.HttpClient);
      const query = new URLSearchParams({
        is_outbound: "false",
        status: "RECEIVED",
        sent_at_gte: cursor.sentAt,
        order_by: "sentAt",
        order_direction: "asc",
        limit: "1000",
      });
      const request = HttpClientRequest.get(
        `https://api.sendblue.com/api/v2/messages?${query.toString()}`,
      ).pipe(
        HttpClientRequest.setHeader("sb-api-key-id", configuration.apiKey),
        HttpClientRequest.setHeader("sb-api-secret-key", configuration.apiSecret),
        HttpClientRequest.acceptJson,
      );
      const response = yield* client.execute(request);
      if (response.status < 200 || response.status >= 300)
        return yield* new ProviderFailure({ status: response.status });
      const messages = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(MessagesResponse)),
      );
      const sorted = [...messages.data].sort((left, right) =>
        left.date_sent.localeCompare(right.date_sent),
      );
      const unseen = sorted.filter(
        (message) =>
          message.date_sent > cursor.sentAt ||
          (message.date_sent === cursor.sentAt && !cursor.handles.includes(message.message_handle)),
      );
      const nextCursor = sorted.reduce<Cursor>((current, message) => {
        if (message.date_sent > current.sentAt)
          return { sentAt: message.date_sent, handles: [message.message_handle] };
        if (
          message.date_sent === current.sentAt &&
          !current.handles.includes(message.message_handle)
        )
          return { ...current, handles: [...current.handles, message.message_handle] };
        return current;
      }, cursor);
      return {
        cursor: nextCursor,
        events: unseen.map((message) => ({
          event: {
            _tag: "SendblueMessageReceived" as const,
            messageHandle: message.message_handle,
            fromNumber: message.from_number,
            toNumber: message.to_number ?? message.sendblue_number ?? "",
            content: message.content ?? "",
            mediaUrl: message.media_url ?? "",
            service: message.service ?? "",
            messageType: message.message_type ?? "message",
            groupId: message.group_id ?? "",
            dateSent: message.date_sent,
          },
          eventId: message.message_handle,
        })),
      };
    },
    (effect) =>
      effect.pipe(
        Effect.scoped,
        Effect.updateService(Headers.CurrentRedactedNames, (names) => [
          ...names,
          "sb-api-key-id",
          "sb-api-secret-key",
        ]),
      ),
  ),
});

export const requirements = (state: typeof SendblueEngine.Storage.Type) =>
  Effect.succeed(
    state.apiKey === null || state.apiSecret === null || state.mode !== "polling"
      ? []
      : [
          handler.require({
            instanceKey: state.apiKey,
            configuration: { apiKey: state.apiKey, apiSecret: state.apiSecret },
          }),
        ],
  );
