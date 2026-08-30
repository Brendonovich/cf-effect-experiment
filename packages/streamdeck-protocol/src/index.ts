/**
 * `@macrograph/streamdeck-protocol`
 *
 * The wire protocol between MacroGraph and the external Stream Deck plugin
 * (`.sdPlugin`). The plugin opens the bridge WebSocket (default
 * `ws://127.0.0.1:1880`), sends `hello`, and then relays Stream Deck SDK
 * events on one side and MacroGraph commands on the other.
 *
 * This entry point is intentionally dependency-free: it exports only types,
 * version constants and message builders so the external plugin repo can
 * consume it without dragging Effect into its bundle.
 */

/** Version of the bridge protocol implemented by this build. */
export const PROTOCOL_VERSION = 1 as const;

/** `client` identifier the plugin must send in its `hello` message. */
export const CLIENT_ID = "macrograph-streamdeck" as const;

/**
 * Key inside a key's profile `settings` that binds it to a MacroGraph
 * button definition. When present (a non-empty string button id), the key is
 * "live": MacroGraph routes display commands to it and accepts its `keyDown`/
 * `keyUp` events. An empty or missing value unbinds the key.
 */
export const BUTTON_SETTING_KEY = "mgButtonId" as const;

export interface Coordinates {
  readonly column: number;
  readonly row: number;
}

export interface DeviceInfo {
  readonly id: string;
  readonly type: string;
  readonly size: Coordinates | null;
}

/** Arbitrary JSON object carried in settings / payloads. */
export type JsonRecord = Readonly<Record<string, unknown>>;

/** The plugin's Stream Deck SDK action UUID. */
export type ActionUUID = string;

/** Elgato SDK instance context identifying a specific placed key/action. */
export type Context = string;

/**
 * Plugin -> MacroGraph messages. Tagged with a lowercase `type` matching the
 * Stream Deck SDK event names the plugin forwards.
 */
export interface Hello {
  readonly type: "hello";
  readonly version: number;
  readonly client: string;
  readonly pluginUuid: string;
}

export interface DeviceConnected {
  readonly type: "deviceConnected";
  readonly device: DeviceInfo;
}

export interface DeviceDisconnected {
  readonly type: "deviceDisconnected";
  readonly deviceId: string;
}

export interface Appear {
  readonly type: "appear";
  readonly deviceId: string;
  readonly action: ActionUUID;
  readonly context: Context;
  readonly coordinates: Coordinates;
  readonly settings: JsonRecord;
}

export interface Disappear {
  readonly type: "disappear";
  readonly deviceId: string;
  readonly action: ActionUUID;
  readonly context: Context;
}

export interface KeyDown {
  readonly type: "keyDown";
  readonly deviceId: string;
  readonly action: ActionUUID;
  readonly context: Context;
  readonly coordinates: Coordinates;
  readonly settings: JsonRecord;
  readonly payload?: JsonRecord;
}

export interface KeyUp {
  readonly type: "keyUp";
  readonly deviceId: string;
  readonly action: ActionUUID;
  readonly context: Context;
  readonly coordinates: Coordinates;
  readonly settings: JsonRecord;
  readonly payload?: JsonRecord;
}

export interface SettingsChanged {
  readonly type: "settingsChanged";
  readonly action: ActionUUID;
  readonly context: Context;
  readonly settings: JsonRecord;
}

export interface GlobalSettingsChanged {
  readonly type: "globalSettingsChanged";
  readonly settings: JsonRecord;
}

export interface FromPropertyInspector {
  readonly type: "fromPropertyInspector";
  readonly action: ActionUUID;
  readonly context: Context;
  readonly payload: JsonRecord;
}

/** The plugin asks MacroGraph for the current button definitions (from its property inspector). */
export interface QueryButtons {
  readonly type: "queryButtons";
  readonly requestId: string;
}

export type PluginMessage =
  | Hello
  | DeviceConnected
  | DeviceDisconnected
  | Appear
  | Disappear
  | KeyDown
  | KeyUp
  | SettingsChanged
  | GlobalSettingsChanged
  | FromPropertyInspector
  | QueryButtons;

/**
 * MacroGraph -> plugin messages. The plugin translates these into Stream Deck
 * SDK calls for the touched context / device.
 */
export interface HelloAck {
  readonly type: "helloAck";
  readonly version: number;
}

export interface SetTitle {
  readonly type: "setTitle";
  readonly context: Context;
  readonly title: string;
  readonly state?: number;
}

export interface SetImage {
  readonly type: "setImage";
  readonly context: Context;
  readonly image: string;
  readonly state?: number;
}

export interface SetState {
  readonly type: "setState";
  readonly context: Context;
  readonly state: number;
}

export interface ShowOk {
  readonly type: "showOk";
  readonly context: Context;
}

export interface ShowAlert {
  readonly type: "showAlert";
  readonly context: Context;
}

export interface SetSettings {
  readonly type: "setSettings";
  readonly context: Context;
  readonly settings: JsonRecord;
}

export interface SetProfile {
  readonly type: "setProfile";
  readonly deviceId: string;
  readonly profile: string | null;
}

export interface SwitchToProfile {
  readonly type: "switchToProfile";
  readonly deviceId: string;
  readonly profile: string;
  readonly page?: number;
}

export interface SendToPropertyInspector {
  readonly type: "sendToPropertyInspector";
  readonly action: ActionUUID;
  readonly context: Context;
  readonly payload: JsonRecord;
}

export interface OpenUrl {
  readonly type: "openUrl";
  readonly url: string;
}

export interface ButtonList {
  readonly type: "buttonList";
  readonly requestId: string;
  readonly buttons: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

export type MasterMessage =
  | HelloAck
  | SetTitle
  | SetImage
  | SetState
  | ShowOk
  | ShowAlert
  | SetSettings
  | SetProfile
  | SwitchToProfile
  | SendToPropertyInspector
  | OpenUrl
  | ButtonList;

// ---------------------------------------------------------------------------
// Builders (plugin side)
// ---------------------------------------------------------------------------

export const hello = (pluginUuid: string): Hello => ({
  type: "hello",
  version: PROTOCOL_VERSION,
  client: CLIENT_ID,
  pluginUuid,
});

export const deviceConnected = (device: DeviceInfo): DeviceConnected => ({
  type: "deviceConnected",
  device,
});

export const deviceDisconnected = (deviceId: string): DeviceDisconnected => ({
  type: "deviceDisconnected",
  deviceId,
});

export const appear = (message: {
  readonly deviceId: string;
  readonly action: ActionUUID;
  readonly context: Context;
  readonly coordinates: Coordinates;
  readonly settings: JsonRecord;
}): Appear => ({ type: "appear", ...message });

export const disappear = (message: {
  readonly deviceId: string;
  readonly action: ActionUUID;
  readonly context: Context;
}): Disappear => ({ type: "disappear", ...message });

export const keyDown = (message: {
  readonly deviceId: string;
  readonly action: ActionUUID;
  readonly context: Context;
  readonly coordinates: Coordinates;
  readonly settings: JsonRecord;
  readonly payload?: JsonRecord;
}): KeyDown => ({ type: "keyDown", ...message });

export const keyUp = (message: {
  readonly deviceId: string;
  readonly action: ActionUUID;
  readonly context: Context;
  readonly coordinates: Coordinates;
  readonly settings: JsonRecord;
  readonly payload?: JsonRecord;
}): KeyUp => ({ type: "keyUp", ...message });

export const settingsChanged = (message: {
  readonly action: ActionUUID;
  readonly context: Context;
  readonly settings: JsonRecord;
}): SettingsChanged => ({ type: "settingsChanged", ...message });

export const globalSettingsChanged = (settings: JsonRecord): GlobalSettingsChanged => ({
  type: "globalSettingsChanged",
  settings,
});

export const fromPropertyInspector = (message: {
  readonly action: ActionUUID;
  readonly context: Context;
  readonly payload: JsonRecord;
}): FromPropertyInspector => ({ type: "fromPropertyInspector", ...message });

export const queryButtons = (requestId: string): QueryButtons => ({
  type: "queryButtons",
  requestId,
});

// ---------------------------------------------------------------------------
// Builders (MacroGraph side)
// ---------------------------------------------------------------------------

export const helloAck = (version: number = PROTOCOL_VERSION): HelloAck => ({
  type: "helloAck",
  version,
});

export const setTitle = (context: Context, title: string, state?: number): SetTitle => ({
  type: "setTitle",
  context,
  title,
  ...(state === undefined ? {} : { state }),
});

export const setImage = (context: Context, image: string, state?: number): SetImage => ({
  type: "setImage",
  context,
  image,
  ...(state === undefined ? {} : { state }),
});

export const setState = (context: Context, state: number): SetState => ({
  type: "setState",
  context,
  state,
});

export const showOk = (context: Context): ShowOk => ({ type: "showOk", context });

export const showAlert = (context: Context): ShowAlert => ({ type: "showAlert", context });

export const setSettings = (context: Context, settings: JsonRecord): SetSettings => ({
  type: "setSettings",
  context,
  settings,
});

export const setProfile = (deviceId: string, profile: string | null): SetProfile => ({
  type: "setProfile",
  deviceId,
  profile,
});

export const switchToProfile = (
  deviceId: string,
  profile: string,
  page?: number,
): SwitchToProfile => ({
  type: "switchToProfile",
  deviceId,
  profile,
  ...(page === undefined ? {} : { page }),
});

export const sendToPropertyInspector = (message: {
  readonly action: ActionUUID;
  readonly context: Context;
  readonly payload: JsonRecord;
}): SendToPropertyInspector => ({ type: "sendToPropertyInspector", ...message });

export const openUrl = (url: string): OpenUrl => ({ type: "openUrl", url });

export const buttonList = (
  requestId: string,
  buttons: ReadonlyArray<{ readonly id: string; readonly name: string }>,
): ButtonList => ({ type: "buttonList", requestId, buttons });