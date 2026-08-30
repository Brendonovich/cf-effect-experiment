/**
 * Effect `Schema` wrappers for the Stream Deck bridge wire protocol.
 *
 * Imported by the MacroGraph plugin to decode plugin messages and encode
 * master messages. The external plugin repo does not need this entry point;
 * it can decode/validate the JSON with the plain types from
 * `@macrograph/streamdeck-protocol`.
 */
import { Schema } from "effect";

export const Coordinates = Schema.Struct({
  column: Schema.Number,
  row: Schema.Number,
});
export type Coordinates = typeof Coordinates.Type;

export const DeviceInfo = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  size: Schema.NullOr(Coordinates),
});
export type DeviceInfo = typeof DeviceInfo.Type;

export const JsonRecord = Schema.Record(Schema.String, Schema.Unknown);
export type JsonRecord = typeof JsonRecord.Type;

// ---------------------------------------------------------------------------
// Plugin -> MacroGraph
// ---------------------------------------------------------------------------

export const Hello = Schema.Struct({
  type: Schema.Literal("hello"),
  version: Schema.Number,
  client: Schema.String,
  pluginUuid: Schema.String,
});
export type Hello = typeof Hello.Type;

export const DeviceConnected = Schema.Struct({
  type: Schema.Literal("deviceConnected"),
  device: DeviceInfo,
});
export type DeviceConnected = typeof DeviceConnected.Type;

export const DeviceDisconnected = Schema.Struct({
  type: Schema.Literal("deviceDisconnected"),
  deviceId: Schema.String,
});
export type DeviceDisconnected = typeof DeviceDisconnected.Type;

export const Appear = Schema.Struct({
  type: Schema.Literal("appear"),
  deviceId: Schema.String,
  action: Schema.String,
  context: Schema.String,
  coordinates: Coordinates,
  settings: JsonRecord,
});
export type Appear = typeof Appear.Type;

export const Disappear = Schema.Struct({
  type: Schema.Literal("disappear"),
  deviceId: Schema.String,
  action: Schema.String,
  context: Schema.String,
});
export type Disappear = typeof Disappear.Type;

const KeyMessage = Schema.Struct({
  deviceId: Schema.String,
  action: Schema.String,
  context: Schema.String,
  coordinates: Coordinates,
  settings: JsonRecord,
  payload: Schema.optional(JsonRecord),
});

export const KeyDown = Schema.Struct({ type: Schema.Literal("keyDown"), ...KeyMessage.fields });
export type KeyDown = typeof KeyDown.Type;

export const KeyUp = Schema.Struct({ type: Schema.Literal("keyUp"), ...KeyMessage.fields });
export type KeyUp = typeof KeyUp.Type;

export const SettingsChanged = Schema.Struct({
  type: Schema.Literal("settingsChanged"),
  action: Schema.String,
  context: Schema.String,
  settings: JsonRecord,
});
export type SettingsChanged = typeof SettingsChanged.Type;

export const GlobalSettingsChanged = Schema.Struct({
  type: Schema.Literal("globalSettingsChanged"),
  settings: JsonRecord,
});
export type GlobalSettingsChanged = typeof GlobalSettingsChanged.Type;

export const FromPropertyInspector = Schema.Struct({
  type: Schema.Literal("fromPropertyInspector"),
  action: Schema.String,
  context: Schema.String,
  payload: JsonRecord,
});
export type FromPropertyInspector = typeof FromPropertyInspector.Type;

export const QueryButtons = Schema.Struct({
  type: Schema.Literal("queryButtons"),
  requestId: Schema.String,
});
export type QueryButtons = typeof QueryButtons.Type;

export const PluginMessage = Schema.Union([
  Hello,
  DeviceConnected,
  DeviceDisconnected,
  Appear,
  Disappear,
  KeyDown,
  KeyUp,
  SettingsChanged,
  GlobalSettingsChanged,
  FromPropertyInspector,
  QueryButtons,
]);
export type PluginMessage = typeof PluginMessage.Type;

// ---------------------------------------------------------------------------
// MacroGraph -> plugin
// ---------------------------------------------------------------------------

export const HelloAck = Schema.Struct({
  type: Schema.Literal("helloAck"),
  version: Schema.Number,
});
export type HelloAck = typeof HelloAck.Type;

export const SetTitle = Schema.Struct({
  type: Schema.Literal("setTitle"),
  context: Schema.String,
  title: Schema.String,
  state: Schema.optional(Schema.Number),
});
export type SetTitle = typeof SetTitle.Type;

export const SetImage = Schema.Struct({
  type: Schema.Literal("setImage"),
  context: Schema.String,
  image: Schema.String,
  state: Schema.optional(Schema.Number),
});
export type SetImage = typeof SetImage.Type;

export const SetState = Schema.Struct({
  type: Schema.Literal("setState"),
  context: Schema.String,
  state: Schema.Number,
});
export type SetState = typeof SetState.Type;

export const ShowOk = Schema.Struct({ type: Schema.Literal("showOk"), context: Schema.String });
export type ShowOk = typeof ShowOk.Type;

export const ShowAlert = Schema.Struct({
  type: Schema.Literal("showAlert"),
  context: Schema.String,
});
export type ShowAlert = typeof ShowAlert.Type;

export const SetSettings = Schema.Struct({
  type: Schema.Literal("setSettings"),
  context: Schema.String,
  settings: JsonRecord,
});
export type SetSettings = typeof SetSettings.Type;

export const SetProfile = Schema.Struct({
  type: Schema.Literal("setProfile"),
  deviceId: Schema.String,
  profile: Schema.NullOr(Schema.String),
});
export type SetProfile = typeof SetProfile.Type;

export const SwitchToProfile = Schema.Struct({
  type: Schema.Literal("switchToProfile"),
  deviceId: Schema.String,
  profile: Schema.String,
  page: Schema.optional(Schema.Number),
});
export type SwitchToProfile = typeof SwitchToProfile.Type;

export const SendToPropertyInspector = Schema.Struct({
  type: Schema.Literal("sendToPropertyInspector"),
  action: Schema.String,
  context: Schema.String,
  payload: JsonRecord,
});
export type SendToPropertyInspector = typeof SendToPropertyInspector.Type;

export const OpenUrl = Schema.Struct({ type: Schema.Literal("openUrl"), url: Schema.String });
export type OpenUrl = typeof OpenUrl.Type;

export const ButtonList = Schema.Struct({
  type: Schema.Literal("buttonList"),
  requestId: Schema.String,
  buttons: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String }),
  ),
});
export type ButtonList = typeof ButtonList.Type;

export const MasterMessage = Schema.Union([
  HelloAck,
  SetTitle,
  SetImage,
  SetState,
  ShowOk,
  ShowAlert,
  SetSettings,
  SetProfile,
  SwitchToProfile,
  SendToPropertyInspector,
  OpenUrl,
  ButtonList,
]);
export type MasterMessage = typeof MasterMessage.Type;