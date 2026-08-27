import * as Engine from "@macrograph/plugin/Engine";
import { Array, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const EventKind = Schema.Literals([
  "donation",
  "subscription",
  "superchat",
  "membershipGift",
  "membershipGiftStart",
]);
export class StreamlabsEvent extends Schema.TaggedClass<StreamlabsEvent>()("StreamlabsEvent", {
  kind: EventKind,
  name: Schema.String,
  amount: Schema.Number,
  amountText: Schema.String,
  currency: Schema.String,
  formattedAmount: Schema.String,
  message: Schema.String,
  from: Schema.String,
  fromId: Schema.String,
  months: Schema.Number,
  membershipLevelName: Schema.String,
  displayString: Schema.String,
  comment: Schema.String,
  channelUrl: Schema.String,
  giftMembershipsLevelName: Schema.String,
  giftMembershipsCount: Schema.Int,
  membershipMessageId: Schema.String,
  youtubeMembershipGiftId: Schema.String,
  payloadJson: Schema.String,
}) {}

export class StreamlabsFailure extends Schema.TaggedError<StreamlabsFailure>()(
  "StreamlabsFailure",
  {
    reason: Schema.Literals(["invalid-token", "not-configured", "storage-failed"]),
  },
) {}
export const RuntimeStorage = Schema.Struct({
  token: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
});
export const ClientState = Schema.Struct({
  configured: Schema.Boolean,
  enabled: Schema.Boolean,
  status: Schema.Literals(["disconnected", "connecting", "connected", "error"]),
  error: Schema.optional(Schema.Literal("connection-failed")),
});
export const initialClientState: typeof ClientState.Type = {
  configured: false,
  enabled: false,
  status: "disconnected",
};

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("StreamlabsConfigure", {
    payload: Schema.Struct({ token: Schema.String }),
    error: StreamlabsFailure,
  }),
  Rpc.make("StreamlabsSetEnabled", {
    payload: Schema.Struct({ enabled: Schema.Boolean }),
    error: StreamlabsFailure,
  }),
  Rpc.make("StreamlabsClear", { error: StreamlabsFailure }),
) {}

export class StreamlabsEngine extends Engine.make({
  events: Array.empty<StreamlabsEvent>(),
  storage: RuntimeStorage,
  initialStorage: { token: "", enabled: false },
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
