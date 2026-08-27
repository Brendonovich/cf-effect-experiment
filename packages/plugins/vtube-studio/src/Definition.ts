import * as Engine from "@macrograph/plugin/Engine";
import * as Resource from "@macrograph/plugin/Resource";
import { Schema as S } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export class ConnectionFailed extends S.TaggedError<ConnectionFailed>()(
  "VTubeStudioConnectionFailed",
  { reason: S.String },
) {}
export class RequestFailed extends S.TaggedError<RequestFailed>()("VTubeStudioRequestFailed", {
  requestType: S.String,
  reason: S.String,
  code: S.optional(S.Number),
}) {}
export const Failure = S.Union([ConnectionFailed, RequestFailed]);
export type Failure = typeof Failure.Type;

export class VTubeStudioInstance extends Resource.make<VTubeStudioInstance, string>()(
  "VTubeStudioInstance",
  { name: "VTube Studio Instance" },
) {}

export const RuntimeStorage = S.Struct({
  url: S.String,
  connectOnStartup: S.Boolean,
  authenticationToken: S.optional(S.String),
});
export const initialStorage: typeof RuntimeStorage.Type = {
  url: "ws://127.0.0.1:8001/",
  connectOnStartup: false,
};
export const ClientState = S.Struct({
  url: S.String,
  connectOnStartup: S.Boolean,
  state: S.Literals(["disconnected", "connecting", "connected", "error"]),
  error: S.optional(S.String),
});
export class ClientRpcs extends RpcGroup.make(
  Rpc.make("VTubeStudioConfigure", {
    payload: S.Struct({
      url: S.String,
      connectOnStartup: S.Boolean,
      resetAuthentication: S.Boolean,
    }),
    error: ConnectionFailed,
  }),
  Rpc.make("VTubeStudioConnect", { error: Failure }),
  Rpc.make("VTubeStudioDisconnect"),
) {}

export const RequestType = S.Literals([
  "AvailableModels",
  "ModelLoad",
  "ExpressionState",
  "ExpressionActivation",
  "HotkeysInCurrentModel",
  "HotkeyTrigger",
]);
export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("Call", {
    payload: S.Struct({
      url: S.String,
      requestType: RequestType,
      data: S.Record(S.String, S.Unknown),
    }),
    success: S.Record(S.String, S.Unknown),
    error: Failure,
  }),
) {}
export class VTubeStudioEngine extends Engine.make({
  resources: [VTubeStudioInstance],
  storage: RuntimeStorage,
  initialStorage,
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
