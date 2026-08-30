import { Engine, Resource } from "@macrograph/plugin";
import * as WebSocket from "@macrograph/plugin-websocket-server/Definition";
import { BUTTON_SETTING_KEY, PROTOCOL_VERSION } from "@macrograph/streamdeck-protocol";
import { Array, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export { ServerId, ClientId } from "@macrograph/plugin-websocket-server/Definition";
export { PROTOCOL_VERSION, BUTTON_SETTING_KEY };

export const DEFAULT_PORT = 1880;
export const DEFAULT_HOST = "0.0.0.0";
/** Stable id for the auto-provisioned bridge listener (no user config). */
export const DEFAULT_SERVER_ID = WebSocket.ServerId.make(
  "00000000-0000-4000-8000-macrograph01",
);

export const ButtonId = Schema.String.pipe(Schema.brand("StreamDeckButtonId"));
export type ButtonId = typeof ButtonId.Type;

export const DeviceId = Schema.String.pipe(Schema.brand("StreamDeckDeviceId"));
export type DeviceId = typeof DeviceId.Type;

export const ButtonDefinition = Schema.Struct({
  id: ButtonId,
  name: Schema.String,
  preferredDeviceId: Schema.optional(DeviceId),
  defaultTitle: Schema.optional(Schema.String),
});
export type ButtonDefinition = typeof ButtonDefinition.Type;

export class StreamDeckFailure extends Schema.TaggedError<StreamDeckFailure>()("StreamDeckFailure", {
  reason: Schema.String,
}) {}

export class InvalidButton extends Schema.TaggedError<InvalidButton>()("StreamDeckInvalidButton", {
  message: Schema.String,
}) {}

export class ButtonNotFound extends Schema.TaggedError<ButtonNotFound>()("StreamDeckButtonNotFound", {
  id: ButtonId,
}) {}

const JsonRecord = Schema.Record(Schema.String, Schema.Unknown);

export class StreamDeckKeyDown extends Schema.TaggedClass<StreamDeckKeyDown>()("StreamDeckKeyDown", {
  deviceId: DeviceId,
  buttonId: ButtonId,
  buttonName: Schema.String,
  context: Schema.String,
  column: Schema.Number,
  row: Schema.Number,
  /** Current Stream Deck key state (0 or 1). */
  state: Schema.Number,
  settings: JsonRecord,
  payload: Schema.optional(JsonRecord),
}) {}

export class StreamDeckKeyUp extends Schema.TaggedClass<StreamDeckKeyUp>()("StreamDeckKeyUp", {
  deviceId: DeviceId,
  buttonId: ButtonId,
  context: Schema.String,
  column: Schema.Number,
  row: Schema.Number,
  /** Current Stream Deck key state (0 or 1). */
  state: Schema.Number,
  settings: JsonRecord,
  payload: Schema.optional(JsonRecord),
}) {}

export class StreamDeckDeviceConnected extends Schema.TaggedClass<StreamDeckDeviceConnected>()(
  "StreamDeckDeviceConnected",
  {
    deviceId: DeviceId,
    deviceType: Schema.String,
    columns: Schema.optional(Schema.Number),
    rows: Schema.optional(Schema.Number),
  },
) {}

export class StreamDeckDeviceDisconnected extends Schema.TaggedClass<StreamDeckDeviceDisconnected>()(
  "StreamDeckDeviceDisconnected",
  { deviceId: DeviceId },
) {}

export class StreamDeckButtonAppeared extends Schema.TaggedClass<StreamDeckButtonAppeared>()(
  "StreamDeckButtonAppeared",
  {
    deviceId: DeviceId,
    buttonId: Schema.optional(ButtonId),
    context: Schema.String,
    column: Schema.Number,
    row: Schema.Number,
    settings: JsonRecord,
  },
) {}

export class StreamDeckButtonDisappeared extends Schema.TaggedClass<StreamDeckButtonDisappeared>()(
  "StreamDeckButtonDisappeared",
  {
    deviceId: DeviceId,
    buttonId: Schema.optional(ButtonId),
    context: Schema.String,
  },
) {}

export class StreamDeckSettingsChanged extends Schema.TaggedClass<StreamDeckSettingsChanged>()(
  "StreamDeckSettingsChanged",
  {
    buttonId: Schema.optional(ButtonId),
    context: Schema.String,
    settings: JsonRecord,
  },
) {}

export class StreamDeckFromPropertyInspector extends Schema.TaggedClass<StreamDeckFromPropertyInspector>()(
  "StreamDeckFromPropertyInspector",
  {
    buttonId: Schema.optional(ButtonId),
    context: Schema.String,
    payload: JsonRecord,
  },
) {}

export type StreamDeckEvent =
  | StreamDeckKeyDown
  | StreamDeckKeyUp
  | StreamDeckDeviceConnected
  | StreamDeckDeviceDisconnected
  | StreamDeckButtonAppeared
  | StreamDeckButtonDisappeared
  | StreamDeckSettingsChanged
  | StreamDeckFromPropertyInspector;

export class StreamDeckServer extends Resource.make<StreamDeckServer, WebSocket.ServerId>()(
  "StreamDeckServer",
  {
    name: "Stream Deck Server",
    description: "The local WebSocket listener the Stream Deck plugin connects to.",
  },
) {}

export class StreamDeckButton extends Resource.make<StreamDeckButton, ButtonId>()("StreamDeckButton", {
  name: "Stream Deck Button",
  description: "A MacroGraph button definition that can be bound to a physical Stream Deck key.",
}) {}

export class StreamDeckDevice extends Resource.make<StreamDeckDevice, DeviceId>()("StreamDeckDevice", {
  name: "Stream Deck Device",
  description: "A Stream Deck hardware device reported by the connected plugin.",
}) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("StreamDeckSetTitle", {
    payload: Schema.Struct({
      button: ButtonId,
      title: Schema.String,
      state: Schema.optional(Schema.Number),
      target: Schema.optional(Schema.Number),
      fontSize: Schema.optional(Schema.Number),
    }),
    error: StreamDeckFailure,
  }),
  Rpc.make("StreamDeckSetImage", {
    payload: Schema.Struct({
      button: ButtonId,
      image: Schema.String,
      state: Schema.optional(Schema.Number),
    }),
    error: StreamDeckFailure,
  }),
  Rpc.make("StreamDeckSetState", {
    payload: Schema.Struct({ button: ButtonId, state: Schema.Number }),
    error: StreamDeckFailure,
  }),
  Rpc.make("StreamDeckShowOk", {
    payload: Schema.Struct({ button: ButtonId }),
    error: StreamDeckFailure,
  }),
  Rpc.make("StreamDeckShowAlert", {
    payload: Schema.Struct({ button: ButtonId }),
    error: StreamDeckFailure,
  }),
  Rpc.make("StreamDeckSetSettings", {
    payload: Schema.Struct({ button: ButtonId, settingsJson: Schema.String }),
    error: StreamDeckFailure,
  }),
  Rpc.make("StreamDeckSendToPropertyInspector", {
    payload: Schema.Struct({ button: ButtonId, payloadJson: Schema.String }),
    error: StreamDeckFailure,
  }),
  Rpc.make("StreamDeckOpenUrl", {
    payload: Schema.Struct({ url: Schema.String }),
    error: StreamDeckFailure,
  }),
  Rpc.make("StreamDeckSetProfile", {
    payload: Schema.Struct({ device: DeviceId, profile: Schema.NullOr(Schema.String) }),
    error: StreamDeckFailure,
  }),
  Rpc.make("StreamDeckSwitchToProfile", {
    payload: Schema.Struct({
      device: DeviceId,
      profile: Schema.String,
      page: Schema.optional(Schema.Number),
    }),
    error: StreamDeckFailure,
  }),
) {}

export const ClientRpcs = WebSocket.ClientRpcs.prefix("StreamDeck").merge(
  RpcGroup.make(
    Rpc.make("StreamDeckAddButton", {
      payload: Schema.Struct({ name: Schema.String }),
      success: ButtonId,
      error: InvalidButton,
    }),
    Rpc.make("StreamDeckUpdateButton", {
      payload: Schema.Struct({ id: ButtonId, name: Schema.String }),
      error: Schema.Union([InvalidButton, ButtonNotFound]),
    }),
    Rpc.make("StreamDeckRemoveButton", {
      payload: Schema.Struct({ id: ButtonId }),
      error: ButtonNotFound,
    }),
  ),
);

export const DeviceState = Schema.Struct({
  id: DeviceId,
  type: Schema.String,
  columns: Schema.optional(Schema.Number),
  rows: Schema.optional(Schema.Number),
  bindingCount: Schema.Number,
});
export type DeviceState = typeof DeviceState.Type;

export const ButtonState = Schema.Struct({
  id: ButtonId,
  name: Schema.String,
  bound: Schema.Boolean,
  deviceId: Schema.optional(DeviceId),
  column: Schema.optional(Schema.Number),
  row: Schema.optional(Schema.Number),
});
export type ButtonState = typeof ButtonState.Type;

export const RuntimeStorage = Schema.Struct({
  servers: Schema.Array(WebSocket.ServerDefinition).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  buttons: Schema.Array(ButtonDefinition).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
});
export type RuntimeStorage = typeof RuntimeStorage.Type;

export const ClientState = Schema.Struct({
  servers: Schema.Array(WebSocket.ServerState),
  buttons: Schema.Array(ButtonState),
  devices: Schema.Array(DeviceState),
});
export type ClientState = typeof ClientState.Type;

export class StreamDeckEngine extends Engine.make({
  resources: [StreamDeckServer, StreamDeckButton, StreamDeckDevice],
  events: Array.empty<StreamDeckEvent>(),
  storage: RuntimeStorage,
  initialStorage: {
    servers: [
      {
        id: DEFAULT_SERVER_ID,
        name: "Stream Deck",
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        manuallyDisabled: false,
      },
    ],
    buttons: [],
  },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
