import { Engine, Resource } from "@macrograph/plugin";
import * as WebSocket from "@macrograph/plugin-websocket-client/Definition";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export {
  ConnectionId,
  ClientState,
  RuntimeStorage,
} from "@macrograph/plugin-websocket-client/Definition";
export const ClientRpcs = WebSocket.ClientRpcs.prefix("GoXLR");

export const Sliders = Schema.Literals(["A", "B", "C", "D"]);
export const MicTypes = Schema.Literals(["Dynamic", "Condenser", "Jack"]);
export const Presets = Schema.Literals([
  "Preset1",
  "Preset2",
  "Preset3",
  "Preset4",
  "Preset5",
  "Preset6",
]);
export const Inputs = Schema.Literals([
  "Microphone",
  "Chat",
  "Music",
  "Game",
  "Console",
  "LineIn",
  "System",
  "Samples",
]);
export const Outputs = Schema.Literals([
  "Headphones",
  "BroadcastMix",
  "LineOut",
  "ChatMic",
  "Sampler",
]);

export const Command = Schema.Union([
  Schema.Struct({
    SetFaderMuteState: Schema.Tuple([Sliders, Schema.Literals(["MutedToX", "Unmuted"])]),
  }),
  Schema.Struct({ SetMicrophoneType: MicTypes }),
  Schema.Struct({ SetReverbAmount: Schema.Int }),
  Schema.Struct({ SetEchoAmount: Schema.Int }),
  Schema.Struct({ SetPitchAmount: Schema.Int }),
  Schema.Struct({ SetGenderAmount: Schema.Int }),
  Schema.Struct({ SetFXEnabled: Schema.Boolean }),
  Schema.Struct({ SetActiveEffectPreset: Presets }),
  Schema.Struct({ SetRouter: Schema.Tuple([Inputs, Outputs, Schema.Boolean]) }),
]);
export type Command = typeof Command.Type;

export class GoXLRFailure extends Schema.TaggedError<GoXLRFailure>()("GoXLRFailure", {
  reason: Schema.String,
}) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("GoXLRCommand", {
    payload: Schema.Struct({ connectionId: WebSocket.ConnectionId, command: Command }),
    error: Schema.Union([WebSocket.ConnectionNotFound, WebSocket.NotConnected, GoXLRFailure]),
  }),
) {}

export class LevelChange extends Schema.TaggedClass<LevelChange>()("GoXLRLevelChange", {
  connectionId: WebSocket.ConnectionId,
  channel: Schema.String,
  value: Schema.Int,
}) {}
export class ButtonState extends Schema.TaggedClass<ButtonState>()("GoXLRButtonState", {
  connectionId: WebSocket.ConnectionId,
  buttonName: Schema.String,
  state: Schema.Boolean,
}) {}
export class DialState extends Schema.TaggedClass<DialState>()("GoXLRDialState", {
  connectionId: WebSocket.ConnectionId,
  dial: Schema.String,
  amount: Schema.Int,
}) {}
export class ChannelMuteState extends Schema.TaggedClass<ChannelMuteState>()(
  "GoXLRChannelMuteState",
  {
    connectionId: WebSocket.ConnectionId,
    channel: Schema.String,
    state: Schema.Boolean,
  },
) {}
export type GoXLREvent = LevelChange | ButtonState | DialState | ChannelMuteState;

export class GoXLRConnection extends Resource.make<GoXLRConnection, WebSocket.ConnectionId>()(
  "GoXLRConnection",
  {
    name: "GoXLR Connection",
    description:
      "A configured local GoXLR Utility daemon connection. Commands target its first mixer.",
  },
) {}

export class GoXLREngine extends Engine.make({
  resources: [GoXLRConnection],
  events: Array.empty<GoXLREvent>(),
  storage: WebSocket.RuntimeStorage,
  initialStorage: { connections: [] },
  rpcs: RuntimeRpcs,
  client: { state: WebSocket.ClientState, rpcs: ClientRpcs },
}) {}
