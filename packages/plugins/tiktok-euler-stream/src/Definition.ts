import * as Engine from "@macrograph/plugin/Engine";
import { Array, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const eventKinds = [
  "chat",
  "gift",
  "giftStreak",
  "member",
  "follow",
  "share",
  "like",
  "roomUser",
  "questionNew",
  "emote",
  "envelope",
  "liveIntro",
  "linkMicBattle",
  "linkMicArmies",
  "superFan",
  "superFanJoin",
  "streamEnd",
  "goalUpdate",
  "roomMessage",
] as const;
export const EventKind = Schema.Literals(eventKinds);
export type EventKind = typeof EventKind.Type;
export type TransportEvent = Exclude<EventKind, "giftStreak"> | "social";
export const TransportMode = Schema.Literals(["connector", "managed"]);
export type TransportMode = typeof TransportMode.Type;
export const StateError = Schema.Literals([
  "connection-failed",
  "disconnect-failed",
  "invalid-payload",
  "event-overflow",
  "not-configured",
  "creator-offline",
  "authentication-failed",
  "provider-failed",
]);

export class TikTokEvent extends Schema.TaggedClass<TikTokEvent>()("TikTokEvent", {
  kind: EventKind,
  user: Schema.String,
  userId: Schema.String,
  nickname: Schema.String,
  comment: Schema.String,
  giftId: Schema.String,
  giftName: Schema.String,
  diamonds: Schema.Int,
  repeatCount: Schema.Int,
  repeatEnd: Schema.Boolean,
  giftType: Schema.Int,
  likeCount: Schema.Int,
  totalLikeCount: Schema.Int,
  memberCount: Schema.Int,
  viewerCount: Schema.Int,
  question: Schema.String,
  questionId: Schema.String,
  emoteIdsJson: Schema.String,
  envelopeId: Schema.String,
  peopleCount: Schema.Int,
  description: Schema.String,
  battleId: Schema.String,
  giftCount: Schema.Int,
  totalDiamondCount: Schema.Int,
  action: Schema.Int,
  message: Schema.String,
  contributor: Schema.String,
  contributeCount: Schema.Int,
  contributeScore: Schema.Int,
  payloadJson: Schema.String,
}) {}

export class TikTokFailure extends Schema.TaggedError<TikTokFailure>()("TikTokFailure", {
  reason: Schema.Literals([
    "invalid-username",
    "invalid-api-key",
    "not-configured",
    "storage-failed",
  ]),
}) {}

export const RuntimeStorage = Schema.Struct({
  mode: TransportMode,
  username: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  apiKey: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
});
export const ClientState = Schema.Struct({
  mode: TransportMode,
  username: Schema.String,
  configured: Schema.Boolean,
  apiKeyConfigured: Schema.Boolean,
  enabled: Schema.Boolean,
  roomId: Schema.String,
  status: Schema.Literals(["disconnected", "connecting", "connected", "error"]),
  error: Schema.optional(StateError),
});
export const initialClientState: typeof ClientState.Type = {
  mode: "connector",
  username: "",
  configured: false,
  apiKeyConfigured: false,
  enabled: false,
  roomId: "",
  status: "disconnected",
};

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("TikTokConfigure", {
    payload: Schema.Struct({
      username: Schema.String,
      apiKey: Schema.optional(Schema.String),
      mode: TransportMode,
    }),
    error: TikTokFailure,
  }),
  Rpc.make("TikTokSetEnabled", {
    payload: Schema.Struct({ enabled: Schema.Boolean }),
    error: TikTokFailure,
  }),
  Rpc.make("TikTokClear", { error: TikTokFailure }),
) {}

export class TikTokEngine extends Engine.make({
  events: Array.empty<TikTokEvent>(),
  storage: RuntimeStorage,
  initialStorage: { mode: "connector", username: "", apiKey: "", enabled: false },
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
