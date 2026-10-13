import { Engine } from "@macrograph/module";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const MessageStatus = Schema.String;

export const InboundMessage = Schema.Struct({
  _tag: Schema.Literal("SendblueMessageReceived"),
  messageHandle: Schema.String,
  fromNumber: Schema.String,
  toNumber: Schema.String,
  content: Schema.String,
  mediaUrl: Schema.String,
  service: Schema.String,
  messageType: Schema.String,
  groupId: Schema.String,
  dateSent: Schema.String,
});
export type InboundMessage = typeof InboundMessage.Type;

export class SendblueFailure extends Schema.TaggedError<SendblueFailure>()("SendblueFailure", {
  operation: Schema.Literals(["send", "settings"]),
  reason: Schema.Literals([
    "API credentials are not configured",
    "Invalid input",
    "Request failed",
    "Provider rejected request",
    "Invalid provider response",
    "Request timed out",
  ]),
  status: Schema.optionalKey(Schema.Number),
}) {}

export const RuntimeStorage = Schema.Struct({
  apiKey: Schema.NullOr(Schema.String),
  apiSecret: Schema.NullOr(Schema.String),
  webhookSecret: Schema.NullOr(Schema.String),
});
export const ClientState = Schema.Struct({
  apiConfigured: Schema.Boolean,
  webhookConfigured: Schema.Boolean,
});

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("SendblueSendMessage", {
    payload: Schema.Struct({
      fromNumber: Schema.String,
      number: Schema.String,
      content: Schema.String,
      mediaUrl: Schema.String,
    }),
    success: Schema.Struct({
      messageHandle: Schema.String,
      status: Schema.String,
      service: Schema.String,
      wasDowngraded: Schema.Boolean,
    }),
    error: SendblueFailure,
  }),
) {}

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("SendblueUpdateSettings", {
    payload: Schema.Struct({
      apiKey: Schema.String,
      apiSecret: Schema.String,
      webhookSecret: Schema.String,
    }),
    error: SendblueFailure,
  }),
  Rpc.make("SendblueClearSettings"),
) {}

export class SendblueEngine extends Engine.make({
  events: Array.empty<InboundMessage>(),
  storage: RuntimeStorage,
  initialStorage: { apiKey: null, apiSecret: null, webhookSecret: null },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
