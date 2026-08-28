import type * as Registration from "@macrograph/plugin/Registration";

import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Option, Schema } from "effect";

import { actions } from "./Actions.ts";
import { TwitchAccount, TwitchEngine, TwitchEventSub } from "./Definition.ts";

type Context = Registration.PluginContext<typeof TwitchEngine>;
type Kind = "string" | "int" | "bool";
type Field = {
  readonly id: string;
  readonly path: string;
  readonly kind: Kind;
  readonly name: string;
};
type Event = {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly description: string;
  readonly outputs: ReadonlyArray<Field>;
};

const field = (id: string, path: string, kind: Kind = "string", name?: string): Field => ({
  id,
  path,
  kind,
  name:
    name ??
    id
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/^./, (value) => value.toUpperCase())
      .replace(/\bId\b/g, "ID"),
});
const user = [
  field("userId", "user_id"),
  field("userLogin", "user_login"),
  field("userName", "user_name"),
];
const broadcaster = [
  field("broadcasterUserId", "broadcaster_user_id"),
  field("broadcasterUserLogin", "broadcaster_user_login"),
  field("broadcasterUserName", "broadcaster_user_name"),
];
const moderator = [
  field("moderatorUserId", "moderator_user_id"),
  field("moderatorUserLogin", "moderator_user_login"),
  field("moderatorUserName", "moderator_user_name"),
];
const eventDescriptions: Readonly<Record<string, string>> = {
  ChannelChatMessage: "Fires when a message is sent in a channel's chat.",
  ChannelChatClear: "Fires when all chat messages are cleared.",
  ChannelChatClearUserMessages: "Fires when a user's messages are cleared.",
  ChannelChatMessageDelete: "Fires when a chat message is deleted.",
  ChannelChatNotification: "Fires when a chat notification occurs.",
  ChannelChatSettingsUpdate: "Fires when chat settings are updated.",
  ChannelChatUserMessageHold: "Fires when a user's message is held for review.",
  ChannelChatUserMessageUpdate: "Fires when a held message is approved or denied.",
  ChannelBan: "Fires when a user is banned from a channel.",
  ChannelUnban: "Fires when a user is unbanned from a channel.",
  ChannelUpdate: "Fires when channel information is updated.",
  ChannelRaid: "Fires when a channel raids another channel.",
  ChannelSubscribe: "Fires when a user subscribes to a channel.",
  ChannelSubscriptionEnd: "Fires when a user's subscription ends.",
  ChannelSubscriptionGift: "Fires when a user gifts subscriptions.",
  ChannelSubscriptionMessage: "Fires when a user resubscribes with a message.",
  ChannelCheer: "Fires when a user cheers bits in a channel.",
  ChannelModeratorAdd: "Fires when a moderator is added.",
  ChannelModeratorRemove: "Fires when a moderator is removed.",
  ChannelVipAdd: "Fires when a VIP is added.",
  ChannelVipRemove: "Fires when a VIP is removed.",
  ChannelModerate: "Fires when a moderation action occurs.",
  ChannelUnbanRequestCreate: "Fires when an unban request is created.",
  ChannelUnbanRequestResolve: "Fires when an unban request is resolved.",
  ChannelSuspiciousUserUpdate: "Fires when a suspicious user's status is updated.",
  ChannelSuspiciousUserMessage: "Fires when a suspicious user sends a message.",
  ChannelWarningAcknowledge: "Fires when a user acknowledges a warning.",
  ChannelWarningSend: "Fires when a warning is sent to a user.",
  AutomodSettingsUpdate: "Fires when AutoMod settings are updated.",
  AutomodTermsUpdate: "Fires when AutoMod terms are updated.",
  ChannelPollBegin: "Fires when a poll begins.",
  ChannelPollProgress: "Fires when a poll progresses.",
  ChannelPollEnd: "Fires when a poll ends.",
  ChannelPredictionBegin: "Fires when a prediction begins.",
  ChannelPredictionProgress: "Fires when a prediction progresses.",
  ChannelPredictionLock: "Fires when a prediction locks.",
  ChannelPredictionEnd: "Fires when a prediction ends.",
  ChannelPointsAutomaticRewardRedemptionAdd:
    "Fires when a channel points automatic reward is redeemed.",
  HypeTrainBegin: "Fires when a hype train begins.",
  HypeTrainProgress: "Fires when a hype train progresses.",
  HypeTrainEnd: "Fires when a hype train ends.",
  ChannelCharityCampaignDonate: "Fires when a donation is made to a charity campaign.",
  ChannelCharityCampaignStart: "Fires when a charity campaign starts.",
  ChannelCharityCampaignProgress: "Fires when a charity campaign progresses.",
  ChannelCharityCampaignStop: "Fires when a charity campaign stops.",
  ChannelSharedChatSessionBegin: "Fires when a shared chat session begins.",
  ChannelSharedChatSessionUpdate: "Fires when a shared chat session updates.",
  ChannelSharedChatSessionEnd: "Fires when a shared chat session ends.",
  ChannelAdBreakBegin: "Fires when an ad break begins.",
};
const event = (id: string, name: string, tag: string, outputs: ReadonlyArray<Field>): Event => ({
  id,
  name,
  tag,
  outputs,
  description: eventDescriptions[id] ?? name,
});

export const events: ReadonlyArray<Event> = [
  event("ChannelChatMessage", "Chat Message", "channel.chat.message", [
    ...broadcaster,
    field("chatterUserId", "chatter_user_id"),
    field("chatterUserName", "chatter_user_name"),
    field("chatterUserLogin", "chatter_user_login"),
    field("messageId", "message_id"),
    field("messageText", "message.text"),
    field("color", "color"),
  ]),
  event("ChannelChatClear", "Chat Clear", "channel.chat.clear", broadcaster),
  event(
    "ChannelChatClearUserMessages",
    "Chat Clear User Messages",
    "channel.chat.clear_user_messages",
    [
      ...broadcaster,
      field("targetUserId", "target_user_id"),
      field("targetUserName", "target_user_name"),
      field("targetUserLogin", "target_user_login"),
    ],
  ),
  event("ChannelChatMessageDelete", "Chat Message Delete", "channel.chat.message_delete", [
    ...broadcaster,
    field("targetUserId", "target_user_id"),
    field("targetUserName", "target_user_name"),
    field("targetUserLogin", "target_user_login"),
    field("messageId", "message_id"),
  ]),
  event("ChannelChatNotification", "Chat Notification", "channel.chat.notification", [
    ...broadcaster,
    field("chatterUserId", "chatter_user_id"),
    field("chatterUserName", "chatter_user_name"),
    field("chatterUserLogin", "chatter_user_login"),
    field("messageId", "message_id"),
    field("messageText", "message.text"),
    field("systemMessage", "system_message"),
  ]),
  event("ChannelChatSettingsUpdate", "Chat Settings Update", "channel.chat_settings.update", [
    ...broadcaster,
    field("emoteMode", "emote_mode", "bool"),
    field("followerMode", "follower_mode", "bool"),
    field("slowMode", "slow_mode", "bool"),
    field("subscriberMode", "subscriber_mode", "bool"),
    field("uniqueChatMode", "unique_chat_mode", "bool"),
  ]),
  event("ChannelChatUserMessageHold", "Chat User Message Hold", "channel.chat.user_message_hold", [
    ...broadcaster,
    ...user,
  ]),
  event(
    "ChannelChatUserMessageUpdate",
    "Chat User Message Update",
    "channel.chat.user_message_update",
    [...broadcaster, ...user, field("status", "status")],
  ),
  event("ChannelBan", "User Banned", "channel.ban", [
    ...broadcaster,
    ...user,
    ...moderator,
    field("reason", "reason"),
    field("isPermanent", "is_permanent", "bool"),
  ]),
  event("ChannelUnban", "User Unbanned", "channel.unban", [...broadcaster, ...user, ...moderator]),
  event("ChannelUpdate", "Updated", "channel.update", [
    ...broadcaster,
    field("title", "title"),
    field("language", "language"),
    field("categoryId", "category_id"),
    field("categoryName", "category_name"),
  ]),
  event("ChannelRaid", "Raid", "channel.raid", [
    field("fromBroadcasterUserId", "from_broadcaster_user_id"),
    field("fromBroadcasterUserName", "from_broadcaster_user_name"),
    field("fromBroadcasterUserLogin", "from_broadcaster_user_login"),
    field("toBroadcasterUserId", "to_broadcaster_user_id"),
    field("toBroadcasterUserName", "to_broadcaster_user_name"),
    field("toBroadcasterUserLogin", "to_broadcaster_user_login"),
    field("viewers", "viewers", "int"),
  ]),
  event("ChannelSubscribe", "Subscribed", "channel.subscribe", [
    ...user,
    ...broadcaster,
    field("tier", "tier"),
    field("isGift", "is_gift", "bool"),
  ]),
  event("ChannelSubscriptionEnd", "Subscription Ended", "channel.subscription.end", [
    ...user,
    ...broadcaster,
    field("tier", "tier"),
    field("isGift", "is_gift", "bool"),
  ]),
  event("ChannelSubscriptionGift", "Subscription Gifted", "channel.subscription.gift", [
    ...broadcaster,
    field("total", "total", "int"),
    field("tier", "tier"),
    field("isAnonymous", "is_anonymous", "bool"),
  ]),
  event("ChannelSubscriptionMessage", "Subscription Message", "channel.subscription.message", [
    ...user,
    ...broadcaster,
    field("tier", "tier"),
    field("cumulativeMonths", "cumulative_months", "int"),
    field("durationMonths", "duration_months", "int"),
  ]),
  event("ChannelCheer", "Cheered", "channel.cheer", [
    field("isAnonymous", "is_anonymous", "bool"),
    ...broadcaster,
    field("message", "message"),
    field("bits", "bits", "int"),
  ]),
  event("ChannelModeratorAdd", "Moderator Added", "channel.moderator.add", [
    ...broadcaster,
    ...user,
  ]),
  event("ChannelModeratorRemove", "Moderator Removed", "channel.moderator.remove", [
    ...broadcaster,
    ...user,
  ]),
  event("ChannelVipAdd", "VIP Added", "channel.vip.add", [...broadcaster, ...user]),
  event("ChannelVipRemove", "VIP Removed", "channel.vip.remove", [...broadcaster, ...user]),
  event("ChannelModerate", "Moderated", "channel.moderate", [
    ...broadcaster,
    ...moderator,
    field("action", "action"),
  ]),
  event("ChannelUnbanRequestCreate", "Unban Request Created", "channel.unban_request.create", [
    field("id", "id"),
    ...broadcaster,
    ...user,
    field("text", "text"),
  ]),
  event("ChannelUnbanRequestResolve", "Unban Request Resolved", "channel.unban_request.resolve", [
    field("id", "id"),
    ...broadcaster,
    ...user,
    field("status", "status"),
  ]),
  event("ChannelSuspiciousUserUpdate", "Suspicious User Update", "channel.suspicious_user.update", [
    ...broadcaster,
    ...moderator,
    ...user,
    field("lowTrustStatus", "low_trust_status"),
  ]),
  event(
    "ChannelSuspiciousUserMessage",
    "Suspicious User Message",
    "channel.suspicious_user.message",
    [
      ...broadcaster,
      ...user,
      field("lowTrustStatus", "low_trust_status"),
      field("banEvasionEvaluation", "ban_evasion_evaluation"),
      field("messageId", "message.message_id"),
      field("messageText", "message.text"),
    ],
  ),
  event("ChannelWarningAcknowledge", "Warning Acknowledged", "channel.warning.acknowledge", [
    ...broadcaster,
    ...user,
  ]),
  event("ChannelWarningSend", "Warning Sent", "channel.warning.send", [
    ...broadcaster,
    ...moderator,
    ...user,
  ]),
  event("AutomodSettingsUpdate", "Automod Settings Update", "automod.settings.update", [
    ...broadcaster,
    ...moderator,
    field("bullying", "bullying", "int"),
    field("disability", "disability", "int"),
    field("misogyny", "misogyny", "int"),
    field("aggression", "aggression", "int"),
    field("swearing", "swearing", "int"),
  ]),
  event("AutomodTermsUpdate", "Automod Terms Update", "automod.terms.update", [
    ...broadcaster,
    ...moderator,
    field("action", "action"),
    field("fromAutomod", "from_automod", "bool"),
  ]),
  ...(["Begin", "Progress", "End"] as const).map((phase) =>
    event(
      `ChannelPoll${phase}`,
      phase === "Begin" ? "Poll Began" : `Poll ${phase}`,
      `channel.poll.${phase.toLowerCase()}`,
      [
        field("id", "id"),
        ...broadcaster,
        field("title", "title"),
        ...(phase === "End" ? [field("status", "status")] : []),
      ],
    ),
  ),
  ...(["Begin", "Progress", "Lock", "End"] as const).map((phase) =>
    event(
      `ChannelPrediction${phase}`,
      phase === "Begin"
        ? "Prediction Began"
        : phase === "Lock"
          ? "Prediction Locked"
          : `Prediction ${phase}`,
      `channel.prediction.${phase.toLowerCase()}`,
      [
        field("id", "id"),
        ...broadcaster,
        field("title", "title"),
        ...(phase === "End" ? [field("status", "status")] : []),
      ],
    ),
  ),
  event(
    "ChannelPointsAutomaticRewardRedemptionAdd",
    "Points Reward Redeemed",
    "channel.channel_points_automatic_reward_redemption.add",
    [
      field("id", "id"),
      ...broadcaster,
      ...user,
      field("rewardType", "reward.type"),
      field("rewardCost", "reward.cost", "int"),
    ],
  ),
  ...(["Begin", "Progress", "End"] as const).map((phase) =>
    event(`HypeTrain${phase}`, `Hype Train ${phase}`, `channel.hype_train.${phase.toLowerCase()}`, [
      field("id", "id"),
      ...broadcaster,
      field("level", "level", "int"),
      field("total", "total", "int"),
      ...(phase === "End"
        ? []
        : [field("progress", "progress", "int"), field("goal", "goal", "int")]),
    ]),
  ),
  event("ChannelCharityCampaignDonate", "Charity Donation", "channel.charity_campaign.donate", [
    field("id", "id"),
    field("campaignId", "campaign_id"),
    ...broadcaster,
    ...user,
    field("charityName", "charity_name"),
    field("amountValue", "amount.value", "int"),
  ]),
  ...(["Start", "Progress", "Stop"] as const).map((phase) =>
    event(
      `ChannelCharityCampaign${phase}`,
      phase === "Start"
        ? "Charity Campaign Started"
        : phase === "Stop"
          ? "Charity Campaign Stopped"
          : "Charity Campaign Progress",
      `channel.charity_campaign.${phase.toLowerCase()}`,
      [
        field("id", "id"),
        ...broadcaster,
        field("charityName", "charity_name"),
        field("currentAmountValue", "current_amount.value", "int"),
        field("targetAmountValue", "target_amount.value", "int"),
      ],
    ),
  ),
  ...(["Begin", "Update", "End"] as const).map((phase) =>
    event(
      `ChannelSharedChatSession${phase}`,
      phase === "Begin" ? "Shared Chat Session Began" : `Shared Chat Session ${phase}`,
      `channel.shared_chat.session.${phase.toLowerCase()}`,
      [
        field("sessionId", "session_id"),
        ...broadcaster,
        field("hostBroadcasterUserId", "host_broadcaster_user_id"),
        field("hostBroadcasterUserLogin", "host_broadcaster_user_login"),
        field("hostBroadcasterUserName", "host_broadcaster_user_name"),
      ],
    ),
  ),
  event("ChannelAdBreakBegin", "Ad Break Begin", "channel.ad_break.begin", [
    ...broadcaster,
    field("requesterUserId", "requester_user_id"),
    field("requesterUserLogin", "requester_user_login"),
    field("requesterUserName", "requester_user_name"),
    field("durationSeconds", "duration_seconds", "int"),
    field("isAutomatic", "is_automatic", "bool"),
  ]),
];

export const existingActionIds = [
  "SendChatMessage",
  "GetChatSettings",
  "UpdateChatSettings",
  "GetChannelInformation",
  "ModifyChannelInformation",
  "GetStreams",
  "CreateClip",
  "CreatePoll",
  "EndPoll",
  "CreatePrediction",
  "EndPrediction",
  "GetUsers",
  "GetFollowers",
] as const;
export const actionIds = [...existingActionIds, ...actions.map(({ id }) => id)];
export const ids = [...events.map(({ id }) => id), ...actionIds];
export const count = ids.length;

const accountProperty = {
  account: {
    name: "Account",
    description: "The credential-owned Twitch account used for this request.",
    resource: TwitchAccount,
  },
} as const;
const eventSubProperty = {
  socket: {
    name: "EventSub Connection",
    description: "The selected Twitch account whose EventSub delivery triggers this node.",
    resource: TwitchEventSub,
  },
} as const;
const dataType = (kind: Kind): DataType.Any =>
  kind === "string" ? DataType.String : kind === "int" ? DataType.Int : DataType.Bool;
const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
const get = (value: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((current, key) => record(current)[key], value);
const outputValue = (kind: Kind, value: unknown): string | number | boolean => {
  if (kind === "bool") return value === true;
  if (kind === "int")
    return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  return typeof value === "string" ? value : value == null ? "" : String(value);
};
const isOutputValue = (kind: Kind, value: unknown) =>
  kind === "bool"
    ? typeof value === "boolean"
    : kind === "int"
      ? typeof value === "number" && Number.isFinite(value)
      : typeof value === "string";
const eventAccount = (value: unknown) => {
  const data = record(value);
  for (const key of [
    "broadcaster_user_id",
    "to_broadcaster_user_id",
    "from_broadcaster_user_id",
    "user_id",
    "moderator_user_id",
  ]) {
    if (typeof data[key] === "string") return data[key];
  }
  return undefined;
};
export const isCatalogEvent = (value: unknown, accountId: string) => {
  const data = record(value);
  const definition = events.find(({ tag }) => tag === data._tag);
  return (
    definition !== undefined &&
    eventAccount(value) === accountId &&
    definition.outputs.every((item) => isOutputValue(item.kind, get(value, item.path)))
  );
};
const option = <A>(value: Option.Option<A>): A | undefined => Option.getOrUndefined(value);
const endPollStatus = (value: string): "ARCHIVED" | "TERMINATED" | undefined =>
  value === "ARCHIVED" || value === "TERMINATED" ? value : undefined;
const endPredictionStatus = (value: string): "CANCELED" | "LOCKED" | "RESOLVED" | undefined =>
  value === "CANCELED" || value === "LOCKED" || value === "RESOLVED" ? value : undefined;

export const register = Effect.fnUntraced(function* (context: Context) {
  for (const definition of events) {
    yield* context.schema.register({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      type: "event",
      properties: eventSubProperty,
      event: (value, { properties }) =>
        Effect.succeed(value._tag === definition.tag && isCatalogEvent(value, properties.socket)),
      io: (io) => ({
        outputs: definition.outputs.map((item) =>
          io.data.out(item.id, dataType(item.kind), { name: item.name }),
        ),
      }),
      run: ({ event: value, io }) =>
        Effect.sync(() => {
          for (const [index, item] of definition.outputs.entries()) {
            const write = io.outputs[index];
            if (write !== undefined) write(outputValue(item.kind, get(value, item.path)));
          }
        }),
    });
  }

  yield* context.schema.register({
    id: "SendChatMessage",
    name: "Send Chat Message",
    description: "Sends a message to a Twitch channel's chat.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      message: io.data.in("message", DataType.String, { name: "Message" }),
      replyId: io.data.in("replyId", DataType.Option(DataType.String), {
        name: "Reply Message ID",
      }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const result = (yield* engine.SendChatMessage({
          account_id: properties.account,
          broadcaster_id: io.broadcasterId,
          sender_id: properties.account,
          message: io.message,
          ...(Option.isSome(io.replyId) && io.replyId.value !== ""
            ? { reply_parent_message_id: io.replyId.value }
            : {}),
        })).data[0];
        if (result?.is_sent !== true)
          return yield* Effect.fail(
            new Error(result?.drop_reason?.message ?? "Twitch did not send the chat message"),
          );
      }),
  });
  yield* context.schema.register({
    id: "GetChatSettings",
    name: "Get Chat Settings",
    description: "Gets chat settings for a broadcaster's channel.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      emoteMode: io.data.out("emoteMode", DataType.Bool, { name: "Emote Mode" }),
      followerMode: io.data.out("followerMode", DataType.Bool, { name: "Follower Mode" }),
      slowMode: io.data.out("slowMode", DataType.Bool, { name: "Slow Mode" }),
      subscriberMode: io.data.out("subscriberMode", DataType.Bool, { name: "Subscriber Mode" }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const result = (yield* engine.GetChatSettings({
          account_id: properties.account,
          broadcaster_id: io.broadcasterId,
        })).data[0];
        if (result !== undefined) {
          io.emoteMode(result.emote_mode);
          io.followerMode(result.follower_mode);
          io.slowMode(result.slow_mode);
          io.subscriberMode(result.subscriber_mode);
        }
      }),
  });
  yield* context.schema.register({
    id: "UpdateChatSettings",
    name: "Update Chat Settings",
    description: "Updates chat settings for a broadcaster's channel.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      moderatorId: io.data.in("moderatorId", DataType.String, { name: "Moderator ID" }),
      emoteMode: io.data.in("emoteMode", DataType.Option(DataType.Bool), { name: "Emote Mode" }),
      followerMode: io.data.in("followerMode", DataType.Option(DataType.Bool), {
        name: "Follower Mode",
      }),
      followerDuration: io.data.in("followerDuration", DataType.Option(DataType.Int), {
        name: "Follower Duration (minutes)",
      }),
      slowMode: io.data.in("slowMode", DataType.Option(DataType.Bool), { name: "Slow Mode" }),
      slowDuration: io.data.in("slowDuration", DataType.Option(DataType.Int), {
        name: "Slow Wait Time (seconds)",
      }),
      subscriberMode: io.data.in("subscriberMode", DataType.Option(DataType.Bool), {
        name: "Subscriber Mode",
      }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const emoteMode = option(io.emoteMode);
        const followerMode = option(io.followerMode);
        const slowMode = option(io.slowMode);
        const subscriberMode = option(io.subscriberMode);
        const followerDuration = option(io.followerDuration);
        const slowDuration = option(io.slowDuration);
        if (
          followerMode === true &&
          followerDuration !== undefined &&
          (!Number.isSafeInteger(followerDuration) ||
            followerDuration < 0 ||
            followerDuration > 129600)
        )
          return yield* Effect.fail(new Error("Follower duration must be 0-129600 minutes"));
        if (
          slowMode === true &&
          slowDuration !== undefined &&
          (!Number.isSafeInteger(slowDuration) || slowDuration < 3 || slowDuration > 120)
        )
          return yield* Effect.fail(new Error("Slow wait time must be 3-120 seconds"));
        if (
          (followerDuration !== undefined && followerMode === undefined) ||
          (slowDuration !== undefined && slowMode === undefined)
        )
          return yield* Effect.fail(
            new Error("Select the corresponding mode when setting its duration"),
          );
        if (
          emoteMode === undefined &&
          followerMode === undefined &&
          slowMode === undefined &&
          subscriberMode === undefined
        )
          return yield* Effect.fail(new Error("Select at least one chat setting to update"));
        yield* engine.UpdateChatSettings({
          account_id: properties.account,
          broadcaster_id: io.broadcasterId,
          moderator_id: io.moderatorId,
          emote_mode: emoteMode,
          follower_mode: followerMode,
          follower_mode_duration: followerMode === true ? followerDuration : undefined,
          slow_mode: slowMode,
          slow_mode_wait_time: slowMode === true ? slowDuration : undefined,
          subscriber_mode: subscriberMode,
        });
      }),
  });
  yield* context.schema.register({
    id: "GetChannelInformation",
    name: "Get Channel Information",
    description: "Gets information about a Twitch channel.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      broadcasterLogin: io.data.out("broadcasterLogin", DataType.String, {
        name: "Broadcaster Login",
      }),
      broadcasterName: io.data.out("broadcasterName", DataType.String, {
        name: "Broadcaster Name",
      }),
      gameName: io.data.out("gameName", DataType.String, { name: "Game Name" }),
      gameId: io.data.out("gameId", DataType.String, { name: "Game ID" }),
      title: io.data.out("title", DataType.String, { name: "Title" }),
      language: io.data.out("language", DataType.String, { name: "Language" }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const result = (yield* engine.GetChannelInformation({
          account_id: properties.account,
          broadcaster_id: io.broadcasterId,
        })).data[0];
        if (result !== undefined) {
          io.broadcasterLogin(result.broadcaster_login);
          io.broadcasterName(result.broadcaster_name);
          io.gameName(result.game_name);
          io.gameId(result.game_id);
          io.title(result.title);
          io.language(result.broadcaster_language);
        }
      }),
  });
  yield* context.schema.register({
    id: "ModifyChannelInformation",
    name: "Modify Channel Information",
    description: "Modifies channel information for a broadcaster.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      gameId: io.data.in("gameId", DataType.Option(DataType.String), { name: "Game ID" }),
      title: io.data.in("title", DataType.Option(DataType.String), { name: "Title" }),
      broadcasterLanguage: io.data.in("broadcasterLanguage", DataType.Option(DataType.String), {
        name: "Broadcaster Language",
      }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const gameId = option(io.gameId);
        const title = option(io.title);
        const broadcasterLanguage = option(io.broadcasterLanguage);
        if (gameId === undefined && title === undefined && broadcasterLanguage === undefined)
          return yield* Effect.fail(new Error("Select channel information to modify"));
        yield* engine.ModifyChannelInformation({
          account_id: properties.account,
          broadcaster_id: io.broadcasterId,
          game_id: gameId,
          title,
          broadcaster_language: broadcasterLanguage,
        });
      }),
  });
  yield* context.schema.register({
    id: "GetStreams",
    name: "Get Streams",
    description: "Looks up a user's active Twitch stream.",
    properties: accountProperty,
    io: (io) => ({
      userId: io.data.in("userId", DataType.String, { name: "User ID" }),
      isLive: io.data.out("isLive", DataType.Bool, { name: "Is Live" }),
      viewerCount: io.data.out("viewerCount", DataType.Int, { name: "Viewer Count" }),
      gameName: io.data.out("gameName", DataType.String, { name: "Game Name" }),
      title: io.data.out("title", DataType.String, { name: "Title" }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const stream = (yield* engine.GetStreams({
          account_id: properties.account,
          user_id: io.userId,
        })).data[0];
        io.isLive(stream !== undefined);
        io.viewerCount(stream?.viewer_count ?? 0);
        io.gameName(stream?.game_name ?? "");
        io.title(stream?.title ?? "");
      }),
  });
  yield* context.schema.register({
    id: "CreateClip",
    name: "Create Clip",
    description: "Creates a clip from the broadcaster's stream.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      clipId: io.data.out("clipId", DataType.String, { name: "Clip ID" }),
      editUrl: io.data.out("editUrl", DataType.String, { name: "Edit URL" }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const clip = (yield* engine.CreateClip({
          account_id: properties.account,
          broadcaster_id: io.broadcasterId,
        })).data[0];
        if (clip !== undefined) {
          io.clipId(clip.id);
          io.editUrl(clip.edit_url);
        }
      }),
  });
  yield* context.schema.register({
    id: "CreatePoll",
    name: "Create Poll",
    description: "Creates a poll with two choices for a broadcaster's channel.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      title: io.data.in("title", DataType.String, { name: "Title" }),
      choice1: io.data.in("choice1", DataType.String, { name: "Choice 1" }),
      choice2: io.data.in("choice2", DataType.String, { name: "Choice 2" }),
      duration: io.data.in("duration", DataType.Int, { name: "Duration", defaultValue: 60 }),
      pollId: io.data.out("pollId", DataType.String, { name: "Poll ID" }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const poll = (yield* engine.CreatePoll({
          account_id: properties.account,
          broadcaster_id: io.broadcasterId,
          title: io.title,
          choice1: io.choice1,
          choice2: io.choice2,
          duration: io.duration,
        })).data[0];
        if (poll !== undefined) io.pollId(poll.id);
      }),
  });
  yield* context.schema.register({
    id: "EndPoll",
    name: "End Poll",
    description: "Ends a poll that is currently active.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      id: io.data.in("id", DataType.String, { name: "Poll ID" }),
      status: io.data.in("status", DataType.String, {
        name: "Status",
        defaultValue: "TERMINATED",
        suggestions: () => Effect.succeed(["ARCHIVED", "TERMINATED"]),
      }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const status = endPollStatus(io.status);
        if (status === undefined) return yield* Effect.fail(new Error("Invalid poll status"));
        yield* engine.EndPoll({
          account_id: properties.account,
          broadcaster_id: io.broadcasterId,
          id: io.id,
          status,
        });
      }),
  });
  yield* context.schema.register({
    id: "CreatePrediction",
    name: "Create Prediction",
    description: "Creates a prediction with two outcomes for a broadcaster's channel.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      title: io.data.in("title", DataType.String, { name: "Title" }),
      outcome1: io.data.in("outcome1", DataType.String, { name: "Outcome 1" }),
      outcome2: io.data.in("outcome2", DataType.String, { name: "Outcome 2" }),
      predictionWindow: io.data.in("predictionWindow", DataType.Int, {
        name: "Prediction Window",
        defaultValue: 60,
      }),
      predictionId: io.data.out("predictionId", DataType.String, { name: "Prediction ID" }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const prediction = (yield* engine.CreatePrediction({
          account_id: properties.account,
          broadcaster_id: io.broadcasterId,
          title: io.title,
          outcome1: io.outcome1,
          outcome2: io.outcome2,
          prediction_window: io.predictionWindow,
        })).data[0];
        if (prediction !== undefined) io.predictionId(prediction.id);
      }),
  });
  yield* context.schema.register({
    id: "EndPrediction",
    name: "End Prediction",
    description: "Ends a prediction that is currently active.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      id: io.data.in("id", DataType.String, { name: "Prediction ID" }),
      status: io.data.in("status", DataType.String, {
        name: "Status",
        defaultValue: "CANCELED",
        suggestions: () => Effect.succeed(["CANCELED", "LOCKED", "RESOLVED"]),
      }),
      winningOutcomeId: io.data.in("winningOutcomeId", DataType.Option(DataType.String), {
        name: "Winning Outcome ID",
      }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const status = endPredictionStatus(io.status);
        if (status === undefined) return yield* Effect.fail(new Error("Invalid prediction status"));
        const winningOutcomeId = option(io.winningOutcomeId);
        if (status === "RESOLVED" && winningOutcomeId === undefined)
          return yield* Effect.fail(
            new Error("Winning Outcome ID is required to resolve a prediction"),
          );
        yield* engine.EndPrediction({
          account_id: properties.account,
          broadcaster_id: io.broadcasterId,
          id: io.id,
          status,
          winning_outcome_id: winningOutcomeId,
        });
      }),
  });
  yield* context.schema.register({
    id: "GetUsers",
    name: "Get Users",
    description: "Gets a Twitch user by ID or login.",
    properties: accountProperty,
    io: (io) => ({
      userId: io.data.in("userId", DataType.Option(DataType.String), { name: "User ID" }),
      login: io.data.in("login", DataType.Option(DataType.String), { name: "Login" }),
      id: io.data.out("id", DataType.String, { name: "ID" }),
      displayName: io.data.out("displayName", DataType.String, { name: "Display Name" }),
      broadcasterType: io.data.out("broadcasterType", DataType.String, {
        name: "Broadcaster Type",
      }),
      description: io.data.out("description", DataType.String, { name: "Description" }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        const user = (yield* engine.GetUsers({
          account_id: properties.account,
          id: option(io.userId),
          login: option(io.login),
        })).data[0];
        if (user !== undefined) {
          io.id(user.id);
          io.displayName(user.display_name);
          io.broadcasterType(user.broadcaster_type);
          io.description(user.description);
        }
      }),
  });
  yield* context.schema.register({
    id: "GetFollowers",
    name: "Get Followers",
    description: "Gets the total followers for a broadcaster.",
    properties: accountProperty,
    io: (io) => ({
      broadcasterId: io.data.in("broadcasterId", DataType.String, { name: "Broadcaster ID" }),
      total: io.data.out("total", DataType.Int, { name: "Total" }),
    }),
    run: ({ io, properties, engine }) =>
      Effect.gen(function* () {
        io.total(
          (yield* engine.GetFollowers({
            account_id: properties.account,
            broadcaster_id: io.broadcasterId,
          })).total,
        );
      }),
  });
  for (const action of actions) {
    yield* context.schema.register({
      id: action.id,
      name: action.name,
      description: `${action.name} using authenticated Twitch ${action.id === "ValidateToken" ? "OAuth validation" : "Helix"}.${action.scopes.length ? ` Requires ${action.scopes.join(" or ")}.` : ""}`,
      properties: accountProperty,
      io: (io) => ({
        inputs: action.inputs.map((field) => {
          const type =
            field.kind === "int"
              ? DataType.Int
              : field.kind === "bool"
                ? DataType.Bool
                : DataType.String;
          return io.data.in(field.id, field.optional ? DataType.Option(type) : type, {
            name: field.id
              .replace(/([a-z])([A-Z])/g, "$1 $2")
              .replace(/^./, (value) => value.toUpperCase()),
          });
        }),
        responseJson: io.data.out("responseJson", DataType.String, { name: "Response JSON" }),
        outputs: (action.outputs ?? []).map((field) => {
          const type =
            field.kind === "int"
              ? DataType.Int
              : field.kind === "bool" || field.kind === "exists"
                ? DataType.Bool
                : DataType.String;
          return io.data.out(field.id, field.optional ? DataType.Option(type) : type);
        }),
      }),
      run: ({ io, properties, engine }) =>
        Effect.gen(function* () {
          const inputs: Record<string, Schema.Json> = {};
          for (const [index, field] of action.inputs.entries()) {
            const raw = io.inputs[index];
            const value = Option.isOption(raw) ? Option.getOrUndefined(raw) : raw;
            if (value === undefined) continue;
            if (
              typeof value !== "string" &&
              typeof value !== "number" &&
              typeof value !== "boolean"
            )
              return yield* Effect.fail(new Error(`Invalid ${field.id}`));
            inputs[field.id] = value;
          }
          const result = yield* engine.ExecuteAction({
            account_id: properties.account,
            action: action.id,
            inputs,
          });
          io.responseJson(JSON.stringify(result.response));
          for (const [index, field] of (action.outputs ?? []).entries()) {
            const raw = result.outputs[field.id];
            const value =
              field.kind === "json" && raw !== null && raw !== undefined
                ? JSON.stringify(raw)
                : raw;
            const write = io.outputs[index];
            if (!write) continue;
            if (field.optional && (value === null || value === undefined)) write(Option.none());
            else if (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
            )
              write(field.optional ? Option.some(value) : value);
            else return yield* Effect.fail(new Error(`Missing Twitch output: ${field.id}`));
          }
        }),
    });
  }
});
