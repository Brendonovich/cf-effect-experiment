import { Engine, Resource } from "@macrograph/module";
import { Array, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const MessageStatus = Schema.String;
export const AccountId = Schema.String.pipe(Schema.brand("SendblueAccountId"));
export type AccountId = typeof AccountId.Type;

export class SendblueAccount extends Resource.make<SendblueAccount, AccountId>()(
  "SendblueAccount",
  { name: "Sendblue Account" },
) {}

export const InboundMessage = Schema.Struct({
  _tag: Schema.Literal("SendblueMessageReceived"),
  accountId: AccountId,
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

export const DeliveryMode = Schema.Literals(["polling", "webhook"]);
export type DeliveryMode = typeof DeliveryMode.Type;

export const Account = Schema.Struct({
  name: Schema.String,
  apiKey: Schema.String,
  apiSecret: Schema.String,
  webhookSecret: Schema.NullOr(Schema.String),
  mode: DeliveryMode,
});

export const RuntimeStorage = Schema.Struct({
  accounts: Schema.Record(AccountId, Account).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
});
export const ClientState = Schema.Struct({
  accounts: Schema.Array(Schema.Struct({ id: AccountId, name: Schema.String, mode: DeliveryMode })),
});

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("SendblueSendMessage", {
    payload: Schema.Struct({
      accountId: AccountId,
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
  Rpc.make("SendblueCreateAccount", {
    payload: Schema.Struct({
      name: Schema.String,
      apiKey: Schema.String,
      apiSecret: Schema.String,
      webhookSecret: Schema.String,
      mode: DeliveryMode,
    }),
    success: AccountId,
    error: SendblueFailure,
  }),
  Rpc.make("SendblueRemoveAccount", { payload: Schema.Struct({ accountId: AccountId }) }),
) {}

export class SendblueEngine extends Engine.make({
  resources: [SendblueAccount],
  events: Array.empty<InboundMessage>(),
  storage: RuntimeStorage,
  initialStorage: { accounts: {} },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
