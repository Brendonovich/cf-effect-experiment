import * as Engine from "@macrograph/plugin/Engine";
import { Schema as S } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export class ConnectionFailed extends S.TaggedError<ConnectionFailed>()(
  "VoicemodConnectionFailed",
  { reason: S.String },
) {}
export class RequestFailed extends S.TaggedError<RequestFailed>()("VoicemodRequestFailed", {
  action: S.String,
  reason: S.String,
}) {}
export const Failure = S.Union([ConnectionFailed, RequestFailed]);
export type Failure = typeof Failure.Type;
export const RuntimeStorage = S.Struct({
  url: S.String,
  clientKey: S.String,
  connectOnStartup: S.Boolean,
});
export const initialStorage: typeof RuntimeStorage.Type = {
  url: "ws://127.0.0.1:59129/v1",
  clientKey: "",
  connectOnStartup: false,
};
export const ClientState = S.Struct({
  url: S.String,
  hasClientKey: S.Boolean,
  connectOnStartup: S.Boolean,
  state: S.Literals(["disconnected", "connecting", "connected", "error"]),
  error: S.optional(S.String),
});
export class ClientRpcs extends RpcGroup.make(
  Rpc.make("VoicemodConfigure", {
    payload: S.Struct({
      url: S.String,
      clientKey: S.optional(S.String),
      connectOnStartup: S.Boolean,
    }),
    error: ConnectionFailed,
  }),
  Rpc.make("VoicemodConnect", { error: Failure }),
  Rpc.make("VoicemodDisconnect"),
) {}
export const Voices = S.Array(
  S.Struct({
    id: S.String,
    friendlyName: S.String,
    enabled: S.optional(S.Boolean),
  }),
);
export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("GetVoices", { success: Voices, error: Failure }),
  Rpc.make("SetVoice", { payload: S.Struct({ voice: S.String }), error: Failure }),
  Rpc.make("SetVoiceChangerState", { payload: S.Struct({ state: S.Boolean }), error: Failure }),
  Rpc.make("SetHearSelfState", { payload: S.Struct({ state: S.Boolean }), error: Failure }),
) {}
export class VoicemodEngine extends Engine.make({
  storage: RuntimeStorage,
  initialStorage,
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
