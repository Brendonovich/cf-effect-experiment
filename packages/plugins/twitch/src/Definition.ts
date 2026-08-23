import { Engine, Resource } from "@macrograph/plugin";
import { Array, Effect, Schema } from "effect";
import * as S from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { EventSubSocket, SubscriptionEvent } from "./EventSub.ts";
import { Helix } from "./Helix.ts";

export const AccountId = S.String.pipe(S.brand("AccountId"));
export type AccountId = typeof AccountId.Type;

export { SUBSCRIPTION_TYPES, SubscriptionEvent } from "./EventSub.ts";

export class MissingCredential extends S.TaggedErrorClass<MissingCredential>()(
  "MissingCredential",
  {},
) {}

export class TwitchEventSub extends Resource.make<TwitchEventSub, AccountId>()("EventSubSocket", {
  name: "EventSub Socket",
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
    error: S.Union([EventSubSocket.ConnectionFailed, Helix.HelixError, MissingCredential]),
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
    // success: S.Struct({ data: S.Struct({ data: S.Array(ChatMessage) }) }),
    error: S.Union([Helix.HelixError, MissingCredential]),
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
