import * as Engine from "@macrograph/plugin/Engine";
import { Array, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const FailureReason = Schema.Literals([
  "not-configured",
  "invalid-token",
  "invalid-id",
  "invalid-message",
  "invalid-webhook",
  "network",
  "unauthorized",
  "forbidden",
  "not-found",
  "rate-limited",
  "http",
  "invalid-response",
  "storage-failed",
]);
export class DiscordFailure extends Schema.TaggedError<DiscordFailure>()("DiscordFailure", {
  reason: FailureReason,
}) {}

export const ConnectionStatus = Schema.Literals([
  "disconnected",
  "connecting",
  "connected",
  "error",
]);
export const GatewayError = Schema.Literals([
  "connection-failed",
  "authentication-failed",
  "intents-rejected",
  "reconnect-exhausted",
]);
export const RuntimeStorage = Schema.Struct({
  token: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  gatewayEnabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  messageContent: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
});
export const ClientState = Schema.Struct({
  configured: Schema.Boolean,
  gatewayEnabled: Schema.Boolean,
  messageContent: Schema.Boolean,
  status: ConnectionStatus,
  error: Schema.optional(GatewayError),
});
export const initialClientState: typeof ClientState.Type = {
  configured: false,
  gatewayEnabled: false,
  messageContent: false,
  status: "disconnected",
};

export class MessageReceived extends Schema.TaggedClass<MessageReceived>()(
  "DiscordMessageReceived",
  {
    message: Schema.String,
    messageID: Schema.String,
    channelId: Schema.String,
    username: Schema.String,
    userId: Schema.String,
    nickname: Schema.String,
    guildId: Schema.String,
    rolesJson: Schema.String,
    payloadJson: Schema.String,
  },
) {}

export const UserResult = Schema.Struct({
  username: Schema.String,
  displayName: Schema.String,
  avatarId: Schema.String,
  bannerId: Schema.String,
  payloadJson: Schema.String,
});
export const MemberResult = Schema.Struct({
  ...UserResult.fields,
  nick: Schema.String,
  rolesJson: Schema.String,
});
export const RoleResult = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  position: Schema.Int,
  mentionable: Schema.Boolean,
  permissions: Schema.String,
  payloadJson: Schema.String,
});

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("DiscordConfigure", {
    payload: Schema.Struct({
      token: Schema.String,
      gatewayEnabled: Schema.Boolean,
      messageContent: Schema.Boolean,
    }),
    error: DiscordFailure,
  }),
  Rpc.make("DiscordSetGateway", {
    payload: Schema.Struct({ enabled: Schema.Boolean, messageContent: Schema.Boolean }),
    error: DiscordFailure,
  }),
  Rpc.make("DiscordClear", { error: DiscordFailure }),
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("DiscordSendMessage", {
    payload: Schema.Struct({
      channelId: Schema.String,
      message: Schema.String,
      everyone: Schema.Boolean,
    }),
    success: Schema.Struct({ messageId: Schema.String, payloadJson: Schema.String }),
    error: DiscordFailure,
  }),
  Rpc.make("DiscordGetUser", {
    payload: Schema.Struct({ userId: Schema.String }),
    success: UserResult,
    error: DiscordFailure,
  }),
  Rpc.make("DiscordGetGuildMember", {
    payload: Schema.Struct({ guildId: Schema.String, userId: Schema.String }),
    success: MemberResult,
    error: DiscordFailure,
  }),
  Rpc.make("DiscordGetRole", {
    payload: Schema.Struct({ guildId: Schema.String, roleId: Schema.String }),
    success: RoleResult,
    error: DiscordFailure,
  }),
  Rpc.make("DiscordSendWebhook", {
    payload: Schema.Struct({
      webhookUrl: Schema.String,
      content: Schema.String,
      username: Schema.String,
      avatarUrl: Schema.String,
      tts: Schema.Boolean,
    }),
    success: Schema.Int,
    error: DiscordFailure,
  }),
) {}

export class DiscordEngine extends Engine.make({
  events: Array.empty<MessageReceived>(),
  storage: RuntimeStorage,
  initialStorage: { token: "", gatewayEnabled: false, messageContent: false },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
