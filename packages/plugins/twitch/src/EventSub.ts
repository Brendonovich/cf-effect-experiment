import { Schema, Stream } from "effect";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import { Socket } from "effect/unstable/socket";

export const SUBSCRIPTIONS = [
  ["channel.ban", 1, ["broadcaster_user_id"]],
  ["channel.unban", 1, ["broadcaster_user_id"]],
  ["channel.update", 2, ["broadcaster_user_id"]],
  ["channel.ad_break.begin", 1, ["broadcaster_user_id"]],
  ["channel.raid", 1, ["to_broadcaster_user_id"]],
  ["channel.chat.clear", 1, ["broadcaster_user_id", "user_id"]],
  ["channel.chat.clear_user_messages", 1, ["broadcaster_user_id", "user_id"]],
  ["channel.chat.message", 1, ["broadcaster_user_id", "user_id"]],
  ["channel.chat.message_delete", 1, ["broadcaster_user_id", "user_id"]],
  ["channel.chat.notification", 1, ["broadcaster_user_id", "user_id"]],
  ["channel.chat_settings.update", 1, ["broadcaster_user_id", "user_id"]],
  ["channel.chat.user_message_hold", 1, ["broadcaster_user_id", "user_id"]],
  ["channel.chat.user_message_update", 1, ["broadcaster_user_id", "user_id"]],
  ["channel.subscribe", 1, ["broadcaster_user_id"]],
  ["channel.subscription.end", 1, ["broadcaster_user_id"]],
  ["channel.subscription.gift", 1, ["broadcaster_user_id"]],
  ["channel.subscription.message", 1, ["broadcaster_user_id"]],
  ["channel.cheer", 1, ["broadcaster_user_id"]],
  ["channel.moderator.add", 1, ["broadcaster_user_id"]],
  ["channel.moderator.remove", 1, ["broadcaster_user_id"]],
  ["channel.vip.add", 1, ["broadcaster_user_id"]],
  ["channel.vip.remove", 1, ["broadcaster_user_id"]],
  ["channel.moderate", 2, ["broadcaster_user_id", "moderator_user_id"]],
  ["channel.unban_request.create", 1, ["broadcaster_user_id"]],
  ["channel.unban_request.resolve", 1, ["broadcaster_user_id"]],
  ["channel.suspicious_user.update", 1, ["broadcaster_user_id"]],
  ["channel.suspicious_user.message", 1, ["broadcaster_user_id"]],
  ["channel.warning.acknowledge", 1, ["broadcaster_user_id"]],
  ["channel.warning.send", 1, ["broadcaster_user_id"]],
  ["automod.settings.update", 1, ["broadcaster_user_id", "moderator_user_id"]],
  ["automod.terms.update", 1, ["broadcaster_user_id", "moderator_user_id"]],
  ["channel.poll.begin", 1, ["broadcaster_user_id"]],
  ["channel.poll.progress", 1, ["broadcaster_user_id"]],
  ["channel.poll.end", 1, ["broadcaster_user_id"]],
  ["channel.prediction.begin", 1, ["broadcaster_user_id"]],
  ["channel.prediction.progress", 1, ["broadcaster_user_id"]],
  ["channel.prediction.lock", 1, ["broadcaster_user_id"]],
  ["channel.prediction.end", 1, ["broadcaster_user_id"]],
  ["channel.channel_points_automatic_reward_redemption.add", 2, ["broadcaster_user_id"]],
  ["channel.hype_train.begin", 2, ["broadcaster_user_id"]],
  ["channel.hype_train.progress", 2, ["broadcaster_user_id"]],
  ["channel.hype_train.end", 2, ["broadcaster_user_id"]],
  ["channel.charity_campaign.donate", 1, ["broadcaster_user_id"]],
  ["channel.charity_campaign.start", 1, ["broadcaster_user_id"]],
  ["channel.charity_campaign.progress", 1, ["broadcaster_user_id"]],
  ["channel.charity_campaign.stop", 1, ["broadcaster_user_id"]],
  ["channel.shared_chat.session.begin", 1, ["broadcaster_user_id"]],
  ["channel.shared_chat.session.update", 1, ["broadcaster_user_id"]],
  ["channel.shared_chat.session.end", 1, ["broadcaster_user_id"]],
] as const;

export const SUBSCRIPTION_TYPES = SUBSCRIPTIONS.map(([type]) => type);

export type SubscriptionDefinition = (typeof SUBSCRIPTIONS)[number];

export const buildCondition = (
  definition: SubscriptionDefinition | { readonly condition: ReadonlyArray<string> },
  accountId: string,
): Record<string, string> =>
  Object.fromEntries(
    ("condition" in definition ? definition.condition : definition[2]).map((key) => [
      key,
      accountId,
    ]),
  );

const optionalString = S.optional(S.NullOr(S.String));
const optionalNumber = S.optional(S.Number);
const optionalBoolean = S.optional(S.Boolean);
const UserFields = {
  user_id: optionalString,
  user_login: optionalString,
  user_name: optionalString,
  broadcaster_user_id: optionalString,
  broadcaster_user_login: optionalString,
  broadcaster_user_name: optionalString,
  moderator_user_id: optionalString,
  moderator_user_login: optionalString,
  moderator_user_name: optionalString,
  chatter_user_id: optionalString,
  chatter_user_login: optionalString,
  chatter_user_name: optionalString,
  target_user_id: optionalString,
  target_user_login: optionalString,
  target_user_name: optionalString,
  from_broadcaster_user_id: optionalString,
  from_broadcaster_user_login: optionalString,
  from_broadcaster_user_name: optionalString,
  to_broadcaster_user_id: optionalString,
  to_broadcaster_user_login: optionalString,
  to_broadcaster_user_name: optionalString,
  host_broadcaster_user_id: optionalString,
  host_broadcaster_user_login: optionalString,
  host_broadcaster_user_name: optionalString,
  requester_user_id: optionalString,
  requester_user_login: optionalString,
  requester_user_name: optionalString,
};

const EventFields = {
  ...UserFields,
  id: optionalString,
  session_id: optionalString,
  campaign_id: optionalString,
  message_id: optionalString,
  title: optionalString,
  language: optionalString,
  category_id: optionalString,
  category_name: optionalString,
  color: optionalString,
  system_message: optionalString,
  status: optionalString,
  action: optionalString,
  text: optionalString,
  tier: optionalString,
  reason: optionalString,
  low_trust_status: optionalString,
  ban_evasion_evaluation: optionalString,
  charity_name: optionalString,
  viewers: optionalNumber,
  total: optionalNumber,
  bits: optionalNumber,
  cumulative_months: optionalNumber,
  duration_months: optionalNumber,
  level: optionalNumber,
  progress: optionalNumber,
  goal: optionalNumber,
  duration_seconds: optionalNumber,
  bullying: optionalNumber,
  disability: optionalNumber,
  misogyny: optionalNumber,
  aggression: optionalNumber,
  swearing: optionalNumber,
  is_permanent: optionalBoolean,
  is_gift: optionalBoolean,
  is_anonymous: optionalBoolean,
  is_automatic: optionalBoolean,
  emote_mode: optionalBoolean,
  follower_mode: optionalBoolean,
  slow_mode: optionalBoolean,
  subscriber_mode: optionalBoolean,
  unique_chat_mode: optionalBoolean,
  from_automod: optionalBoolean,
  message: S.optional(
    S.Union([
      S.String,
      S.Struct({
        text: S.optional(S.String),
        message_id: S.optional(S.String),
      }),
    ]),
  ),
  reward: S.optional(S.Struct({ type: S.String, cost: S.Number })),
  amount: S.optional(S.Struct({ value: S.Number })),
  current_amount: S.optional(S.Struct({ value: S.Number })),
  target_amount: S.optional(S.Struct({ value: S.Number })),
};

export namespace SubscriptionEvent {
  export const Any = S.Struct({
    _tag: S.Literals(SUBSCRIPTION_TYPES),
    ...EventFields,
  });
  export type Any = S.Schema.Type<typeof Any>;
  export const decodeAny = S.decodeUnknownResult(Any);
}

export namespace EventSubSocket {
  export class ConnectionFailed extends Schema.TaggedError<ConnectionFailed>()(
    "ConnectionFailed",
    { cause: S.Unknown },
  ) {}

  export const make = (url = "wss://eventsub.wss.twitch.tv/ws") =>
    Effect.gen(function* () {
      const getEvent = yield* Stream.never.pipe(
        Stream.pipeThroughChannel(Socket.makeWebSocketChannel(url)),
        Stream.decodeText(),
        Stream.mapEffect((value) =>
          S.decodeEffect(S.fromJsonString(EventSubMessage.EventSubMessage))(value),
        ),
        Stream.mapError((cause) => new ConnectionFailed({ cause })),
        Stream.toPull,
      );
      const firstEvent = yield* getEvent.pipe(
        Effect.map((value) => value[0]),
        Effect.catchTag("Done", (cause) => new ConnectionFailed({ cause })),
      );
      if (!EventSubMessage.isType(firstEvent, "session_welcome"))
        return yield* new ConnectionFailed({ cause: "session-welcome-expected" });
      return {
        id: firstEvent.payload.session.id,
        keepaliveTimeoutSeconds:
          firstEvent.payload.session.keepalive_timeout_seconds === null ||
          firstEvent.payload.session.keepalive_timeout_seconds === undefined
            ? 10
            : firstEvent.payload.session.keepalive_timeout_seconds,
        stream: Stream.fromPull(Effect.succeed(getEvent)),
      };
    });
}

export namespace EventSubMessage {
  const metadata = <Type extends string>(type: Type) =>
    S.Struct({
      message_id: S.String,
      message_timestamp: S.DateFromString,
      message_type: S.Literal(type),
    });
  export const EventSubMessage = S.Union([
    S.Struct({
      metadata: metadata("session_welcome"),
      payload: S.Struct({
        session: S.Struct({
          id: S.String,
          status: S.String,
          keepalive_timeout_seconds: S.optional(S.NullOr(S.Number)),
        }),
      }),
    }),
    S.Struct({ metadata: metadata("session_keepalive"), payload: S.Struct({}) }),
    S.Struct({
      metadata: metadata("notification"),
      payload: S.Struct({
        subscription: S.Struct({
          id: S.String,
          type: S.String,
          version: S.String,
          condition: S.Record(S.String, S.String),
          created_at: S.DateFromString,
        }),
        event: S.Unknown,
      }),
    }),
    S.Struct({
      metadata: metadata("session_reconnect"),
      payload: S.Struct({ session: S.Struct({ id: S.String, reconnect_url: S.String }) }),
    }),
    S.Struct({
      metadata: metadata("revocation"),
      payload: S.Struct({
        subscription: S.Struct({ id: S.String, type: S.String, status: S.String }),
      }),
    }),
  ]);
  export type EventSubMessage = S.Schema.Type<typeof EventSubMessage>;

  export function isType<Type extends EventSubMessage["metadata"]["message_type"]>(
    message: EventSubMessage,
    type: Type,
  ): message is Extract<EventSubMessage, { metadata: { message_type: Type } }> {
    return message.metadata.message_type === type;
  }
}
