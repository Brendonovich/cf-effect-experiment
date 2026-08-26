import * as Engine from "@macrograph/plugin/Engine";
import * as Resource from "@macrograph/plugin/Resource";
import { Array, Effect, Schema } from "effect";
import * as S from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { EventSubSocket, SubscriptionEvent } from "./EventSub.ts";
import { Helix } from "./Helix.ts";

export const AccountId = S.String.pipe(S.brand("AccountId"));
export type AccountId = typeof AccountId.Type;

export { SUBSCRIPTION_TYPES, SubscriptionEvent } from "./EventSub.ts";

export class MissingCredential extends S.TaggedError<MissingCredential>()(
  "MissingCredential",
  { accountId: AccountId, reason: S.String },
) {}

export class CredentialAuthorizationError extends S.TaggedError<CredentialAuthorizationError>()(
  "TwitchCredentialAuthorizationError",
  { accountId: AccountId, reason: S.String, requiredScopes: S.Array(S.String) },
) {}

export class TwitchExecutionUnavailable extends S.TaggedError<TwitchExecutionUnavailable>()(
  "TwitchExecutionUnavailable",
  { reason: S.String },
) {}

export class TwitchEventSub extends Resource.make<TwitchEventSub, AccountId>()("EventSubSocket", {
  name: "EventSub Connection",
}) {}
export class TwitchAccount extends Resource.make<TwitchAccount, AccountId>()("TwitchAccount", {
  name: "Twitch Account",
}) {}

export const ClientState = Schema.Struct({
  transport: S.Literals(["websocket", "webhook"]),
  accounts: Schema.Array(
    Schema.Struct({
      id: AccountId,
      displayName: Schema.String,
      eventSubSocket: Schema.Struct({
        state: S.Union([
          S.Literal("disconnected"),
          S.Literal("connecting"),
          S.Literal("connected"),
        ]),
      }),
      enabledSubscriptions: Schema.Array(S.String),
    }),
  ),
});

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("ConnectEventSub", {
    payload: S.Struct({ accountId: AccountId }),
    error: S.Union([
      EventSubSocket.ConnectionFailed,
      Helix.HelixError,
      MissingCredential,
      CredentialAuthorizationError,
    ]),
  }),
  Rpc.make("DisconnectEventSub", {
    payload: S.Struct({ accountId: AccountId }),
  }),
  Rpc.make("ToggleEventSubSubscription", {
    payload: S.Struct({
      accountId: AccountId,
      subscriptionType: S.String,
      enabled: S.Boolean,
    }),
  }),
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("SendChatMessage", {
    payload: S.Struct({
      account_id: AccountId,
      broadcaster_id: S.String,
      sender_id: S.String,
      message: S.String,
      reply_parent_message_id: S.optional(S.String),
    }),
    success: S.Struct({
      data: S.Array(
        S.Struct({
          message_id: S.String,
          is_sent: S.Boolean,
          drop_reason: S.optional(S.Struct({ code: S.String, message: S.String })),
        }),
      ),
    }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("GetChatSettings", {
    payload: S.Struct({ account_id: AccountId, broadcaster_id: S.String }),
    success: S.Struct({
      data: S.Array(
        S.Struct({
          emote_mode: S.Boolean,
          follower_mode: S.Boolean,
          slow_mode: S.Boolean,
          subscriber_mode: S.Boolean,
        }),
      ),
    }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("UpdateChatSettings", {
    payload: S.Struct({
      account_id: AccountId,
      broadcaster_id: S.String,
      moderator_id: S.String,
      emote_mode: S.optional(S.Boolean),
      follower_mode: S.optional(S.Boolean),
      slow_mode: S.optional(S.Boolean),
      subscriber_mode: S.optional(S.Boolean),
    }),
    success: S.Struct({
      data: S.Array(
        S.Struct({
          emote_mode: S.Boolean,
          follower_mode: S.Boolean,
          slow_mode: S.Boolean,
          subscriber_mode: S.Boolean,
        }),
      ),
    }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("GetChannelInformation", {
    payload: S.Struct({ account_id: AccountId, broadcaster_id: S.String }),
    success: S.Struct({
      data: S.Array(
        S.Struct({
          broadcaster_id: S.String,
          broadcaster_login: S.String,
          broadcaster_name: S.String,
          broadcaster_language: S.String,
          game_id: S.String,
          game_name: S.String,
          title: S.String,
        }),
      ),
    }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("ModifyChannelInformation", {
    payload: S.Struct({
      account_id: AccountId,
      broadcaster_id: S.String,
      game_id: S.optional(S.String),
      broadcaster_language: S.optional(S.String),
      title: S.optional(S.String),
    }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("GetStreams", {
    payload: S.Struct({ account_id: AccountId, user_id: S.String }),
    success: S.Struct({
      data: S.Array(
        S.Struct({
          id: S.String,
          user_id: S.String,
          game_name: S.optional(S.String),
          title: S.String,
          viewer_count: S.Int,
        }),
      ),
    }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("CreateClip", {
    payload: S.Struct({ account_id: AccountId, broadcaster_id: S.String }),
    success: S.Struct({ data: S.Array(S.Struct({ id: S.String, edit_url: S.String })) }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("CreatePoll", {
    payload: S.Struct({
      account_id: AccountId,
      broadcaster_id: S.String,
      title: S.String,
      choice1: S.String,
      choice2: S.String,
      duration: S.Int,
    }),
    success: S.Struct({ data: S.Array(S.Struct({ id: S.String })) }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("EndPoll", {
    payload: S.Struct({
      account_id: AccountId,
      broadcaster_id: S.String,
      id: S.String,
      status: S.Literals(["ARCHIVED", "TERMINATED"]),
    }),
    success: S.Struct({ data: S.Array(S.Struct({ id: S.String })) }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("CreatePrediction", {
    payload: S.Struct({
      account_id: AccountId,
      broadcaster_id: S.String,
      title: S.String,
      outcome1: S.String,
      outcome2: S.String,
      prediction_window: S.Int,
    }),
    success: S.Struct({ data: S.Array(S.Struct({ id: S.String })) }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("EndPrediction", {
    payload: S.Struct({
      account_id: AccountId,
      broadcaster_id: S.String,
      id: S.String,
      status: S.Literals(["CANCELED", "LOCKED", "RESOLVED"]),
      winning_outcome_id: S.optional(S.String),
    }),
    success: S.Struct({ data: S.Array(S.Struct({ id: S.String })) }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("GetUsers", {
    payload: S.Struct({
      account_id: AccountId,
      id: S.optional(S.String),
      login: S.optional(S.String),
    }),
    success: S.Struct({
      data: S.Array(
        S.Struct({
          id: S.String,
          display_name: S.String,
          broadcaster_type: S.String,
          description: S.String,
        }),
      ),
    }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
  Rpc.make("GetFollowers", {
    payload: S.Struct({ account_id: AccountId, broadcaster_id: S.String }),
    success: S.Struct({ total: S.Int }),
    error: S.Union([Helix.HelixError, MissingCredential, CredentialAuthorizationError]),
  }),
) {}

export const RuntimeStorage = Schema.Struct({
  accounts: Schema.Record(
    AccountId,
    Schema.Struct({
      enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
      subscriptions: Schema.Array(Schema.String),
    }),
  ),
});

export class TwitchEngine extends Engine.make({
  resources: [TwitchAccount, TwitchEventSub],
  events: Array.empty<SubscriptionEvent.Any>(),
  storage: RuntimeStorage,
  initialStorage: { accounts: {} },
  rpcs: RuntimeRpcs,
  client: {
    state: ClientState,
    rpcs: ClientRpcs,
  },
}) {}
