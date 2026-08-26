import { DataType } from "@macrograph/plugin/DataType";
import type * as Registration from "@macrograph/plugin/Registration";
import { Effect } from "effect";

import { OBSEngine, OBSSocket } from "./Definition.ts";

type Context = Registration.PluginContext<typeof OBSEngine>;

type Kind = "string" | "int" | "float" | "bool" | "strings" | "json";
type Field = {
  readonly id: string;
  readonly kind: Kind;
  readonly name?: string;
  readonly optional?: boolean;
  readonly defaultValue?: string | number | boolean;
};
type Request = {
  readonly id: string;
  readonly name?: string;
  readonly inputs?: ReadonlyArray<Field>;
  readonly outputs?: ReadonlyArray<Field>;
};
type Event = {
  readonly id: string;
  readonly name?: string;
  readonly outputs: ReadonlyArray<Field>;
};

const s = (id: string, name?: string): Field => ({
  id,
  kind: "string",
  ...(name ? { name } : {}),
});
const i = (id: string, name?: string): Field => ({
  id,
  kind: "int",
  ...(name ? { name } : {}),
});
const f = (id: string, name?: string): Field => ({
  id,
  kind: "float",
  ...(name ? { name } : {}),
});
const b = (id: string, name?: string): Field => ({
  id,
  kind: "bool",
  ...(name ? { name } : {}),
});
const ss = (id: string, name?: string): Field => ({
  id,
  kind: "strings",
  ...(name ? { name } : {}),
});
const j = (id: string, name?: string): Field => ({
  id,
  kind: "json",
  ...(name ? { name } : {}),
});
const optional = (
  field: Field,
  defaultValue: string | number | boolean,
): Field => ({
  ...field,
  optional: true,
  defaultValue,
});

const words = (value: string) => value.replace(/([a-z\d])([A-Z])/g, "$1 $2");
const label = (field: Field) =>
  field.name ??
  words(field.id)
    .replace(/^./, (value) => value.toUpperCase())
    .replace(/\b(Id|Uuid|Obs|Rpc|Cpu|Fps)\b/g, (value) => value.toUpperCase())
    .replace(/\bDb\b/g, "dB");
const type = (kind: Kind): DataType.Any => {
  switch (kind) {
    case "string":
    case "json":
      return DataType.String;
    case "int":
      return DataType.Int;
    case "float":
      return DataType.Float;
    case "bool":
      return DataType.Bool;
    case "strings":
      return DataType.List(DataType.String);
  }
};

const socketProperty = {
  socket: {
    name: "OBS Socket",
    description: "The configured OBS WebSocket connection used by this node.",
    resource: OBSSocket,
  },
} as const;

const event = (id: string, ...outputs: ReadonlyArray<Field>): Event => ({
  id,
  outputs,
});

export const events: ReadonlyArray<Event> = [
  event(
    "CurrentProgramSceneChanged",
    s("sceneName", "Scene Name"),
    s("sceneUuid", "Scene UUID"),
  ),
  event("ExitStarted"),
  event("CustomEvent", j("eventData", "Event Data (JSON)")),
  event("CurrentSceneCollectionChanging", s("sceneCollectionName")),
  event("CurrentSceneCollectionChanged", s("sceneCollectionName")),
  event("SceneCollectionListChanged", ss("sceneCollections")),
  event("CurrentProfileChanging", s("profileName")),
  event("CurrentProfileChanged", s("profileName")),
  event("ProfileListChanged", ss("profiles")),
  event("SourceFilterListReindexed", s("sourceName"), j("filters")),
  event(
    "SourceFilterCreated",
    s("sourceName"),
    s("filterName"),
    s("filterKind"),
    i("filterIndex"),
    j("filterSettings"),
    j("defaultFilterSettings"),
  ),
  event("SourceFilterRemoved", s("sourceName"), s("filterName")),
  event(
    "SourceFilterNameChanged",
    s("sourceName"),
    s("oldFilterName"),
    s("filterName"),
  ),
  event(
    "SourceFilterSettingsChanged",
    s("sourceName"),
    s("filterName"),
    j("filterSettings"),
  ),
  event(
    "SourceFilterEnableStateChanged",
    s("sourceName"),
    s("filterName"),
    b("filterEnabled"),
  ),
  event(
    "InputCreated",
    s("inputName"),
    s("inputUuid"),
    s("inputKind"),
    s("unversionedInputKind"),
    i("inputKindCaps"),
    j("inputSettings"),
    j("defaultInputSettings"),
  ),
  event("InputRemoved", s("inputName"), s("inputUuid")),
  event("InputNameChanged", s("inputUuid"), s("oldInputName"), s("inputName")),
  event(
    "InputSettingsChanged",
    s("inputName"),
    s("inputUuid"),
    j("inputSettings"),
  ),
  event(
    "InputMuteStateChanged",
    s("inputName"),
    s("inputUuid"),
    b("inputMuted"),
  ),
  event(
    "InputVolumeChanged",
    s("inputName"),
    s("inputUuid"),
    f("inputVolumeMul"),
    f("inputVolumeDb"),
  ),
  event(
    "InputAudioBalanceChanged",
    s("inputName"),
    s("inputUuid"),
    f("inputAudioBalance"),
  ),
  event(
    "InputAudioSyncOffsetChanged",
    s("inputName"),
    s("inputUuid"),
    i("inputAudioSyncOffset"),
  ),
  event(
    "InputAudioTracksChanged",
    s("inputName"),
    s("inputUuid"),
    j("inputAudioTracks"),
  ),
  event(
    "InputAudioMonitorTypeChanged",
    s("inputName"),
    s("inputUuid"),
    s("monitorType"),
  ),
  event("MediaInputPlaybackStarted", s("inputName"), s("inputUuid")),
  event("MediaInputPlaybackEnded", s("inputName"), s("inputUuid")),
  event(
    "MediaInputActionTriggered",
    s("inputName"),
    s("inputUuid"),
    s("mediaAction"),
  ),
  event("StreamStateChanged", b("outputActive"), s("outputState")),
  event(
    "RecordStateChanged",
    b("outputActive"),
    s("outputState"),
    s("outputPath"),
  ),
  event("ReplayBufferStateChanged", b("outputActive"), s("outputState")),
  {
    ...event("VirtualcamStateChanged", b("outputActive"), s("outputState")),
    name: "Virtual Camera State Changed",
  },
  event("ReplayBufferSaved", s("savedReplayPath")),
  event(
    "SceneItemCreated",
    s("sceneName"),
    s("sceneUuid"),
    s("sourceName"),
    s("sourceUuid"),
    i("sceneItemId"),
    i("sceneItemIndex"),
  ),
  event(
    "SceneItemRemoved",
    s("sceneName"),
    s("sceneUuid"),
    s("sourceName"),
    s("sourceUuid"),
    i("sceneItemId"),
  ),
  event(
    "SceneItemListReindexed",
    s("sceneName"),
    s("sceneUuid"),
    j("sceneItems"),
  ),
  event(
    "SceneItemEnableStateChanged",
    s("sceneName"),
    s("sceneUuid"),
    i("sceneItemId"),
    b("sceneItemEnabled"),
  ),
  event(
    "SceneItemLockStateChanged",
    s("sceneName"),
    s("sceneUuid"),
    i("sceneItemId"),
    b("sceneItemLocked"),
  ),
  event("SceneItemSelected", s("sceneName"), s("sceneUuid"), i("sceneItemId")),
  event("SceneCreated", s("sceneName"), s("sceneUuid"), b("isGroup")),
  event("SceneRemoved", s("sceneName"), s("sceneUuid"), b("isGroup")),
  event("SceneNameChanged", s("sceneUuid"), s("oldSceneName"), s("sceneName")),
  event("CurrentPreviewSceneChanged", s("sceneName"), s("sceneUuid")),
  event("SceneListChanged", j("scenes")),
  event(
    "CurrentSceneTransitionChanged",
    s("transitionName"),
    s("transitionUuid"),
  ),
  event("CurrentSceneTransitionDurationChanged", i("transitionDuration")),
  event("SceneTransitionStarted", s("transitionName"), s("transitionUuid")),
  event("SceneTransitionEnded", s("transitionName"), s("transitionUuid")),
  event("SceneTransitionVideoEnded", s("transitionName"), s("transitionUuid")),
  event("StudioModeStateChanged", b("studioModeEnabled")),
  event("ScreenshotSaved", s("savedScreenshotPath")),
  event("VendorEvent", s("vendorName"), s("eventType"), j("eventData")),
];

const request = (
  id: string,
  inputs: ReadonlyArray<Field> = [],
  outputs: ReadonlyArray<Field> = [],
  name?: string,
): Request => ({
  id,
  inputs,
  outputs,
  ...(name === undefined ? {} : { name }),
});
const input = s("inputName", "Input Name");
const source = s("sourceName", "Source Name");
const scene = s("sceneName", "Scene Name");
const item = i("sceneItemId", "Scene Item ID");
const filter = s("filterName", "Filter Name");
const output = s("outputName", "Output Name");

export const requests: ReadonlyArray<Request> = [
  request("GetCurrentProgramScene", [], [s("sceneName"), s("sceneUuid")]),
  request("SetCurrentProgramScene", [scene]),
  request(
    "CreateInput",
    [
      scene,
      input,
      s("inputKind"),
      optional(j("inputSettings"), "{}"),
      optional(b("sceneItemEnabled"), true),
    ],
    [s("inputUuid"), i("sceneItemId")],
  ),
  request(
    "GetVersion",
    [],
    [
      s("obsVersion"),
      s("obsWebSocketVersion"),
      i("rpcVersion"),
      ss("availableRequests"),
      ss("supportedImageFormats"),
      s("platform"),
      s("platformDescription"),
    ],
  ),
  request(
    "GetStats",
    [],
    [
      f("cpuUsage"),
      f("memoryUsage"),
      f("availableDiskSpace"),
      f("activeFps"),
      f("averageFrameRenderTime"),
      i("renderSkippedFrames"),
      i("renderTotalFrames"),
      i("outputSkippedFrames"),
      i("outputTotalFrames"),
      i("webSocketSessionIncomingMessages"),
      i("webSocketSessionOutgoingMessages"),
    ],
  ),
  request("BroadcastCustomEvent", [j("eventData")]),
  request(
    "CallVendorRequest",
    [s("vendorName"), s("requestType"), optional(j("requestData"), "{}")],
    [s("vendorName"), s("requestType"), j("responseData")],
  ),
  request("Sleep", [
    optional(i("sleepMillis"), 0),
    optional(i("sleepFrames"), 0),
  ]),
  request("GetPersistentData", [s("realm"), s("slotName")], [j("slotValue")]),
  request("SetPersistentData", [s("realm"), s("slotName"), j("slotValue")]),
  request(
    "GetSceneCollectionList",
    [],
    [s("currentSceneCollectionName"), ss("sceneCollections")],
  ),
  request("SetCurrentSceneCollection", [s("sceneCollectionName")]),
  request("CreateSceneCollection", [s("sceneCollectionName")]),
  request("GetProfileList", [], [s("currentProfileName"), ss("profiles")]),
  request("SetCurrentProfile", [s("profileName")]),
  request("CreateProfile", [s("profileName")]),
  request("RemoveProfile", [s("profileName")]),
  request(
    "GetProfileParameter",
    [s("parameterCategory"), s("parameterName")],
    [s("parameterValue"), s("defaultParameterValue")],
  ),
  request("SetProfileParameter", [
    s("parameterCategory"),
    s("parameterName"),
    s("parameterValue"),
  ]),
  request(
    "GetVideoSettings",
    [],
    [
      i("fpsNumerator"),
      i("fpsDenominator"),
      i("baseWidth"),
      i("baseHeight"),
      i("outputWidth"),
      i("outputHeight"),
    ],
  ),
  request("SetVideoSettings", [
    optional(i("fpsNumerator"), 0),
    optional(i("fpsDenominator"), 0),
    optional(i("baseWidth"), 0),
    optional(i("baseHeight"), 0),
    optional(i("outputWidth"), 0),
    optional(i("outputHeight"), 0),
  ]),
  request(
    "GetStreamServiceSettings",
    [],
    [s("streamServiceType"), j("streamServiceSettings")],
  ),
  request("SetStreamServiceSettings", [
    s("streamServiceType"),
    j("streamServiceSettings"),
  ]),
  request("GetRecordDirectory", [], [s("recordDirectory")]),
  request("SetRecordDirectory", [s("recordDirectory")]),
  request(
    "GetStreamStatus",
    [],
    [
      b("outputActive"),
      b("outputReconnecting"),
      s("outputTimecode"),
      i("outputDuration"),
      f("outputCongestion"),
      i("outputBytes"),
      i("outputSkippedFrames"),
      i("outputTotalFrames"),
    ],
  ),
  request("ToggleStream", [], [b("outputActive")]),
  request("StartStream"),
  request("StopStream"),
  request("SendStreamCaption", [s("captionText")]),
  request(
    "GetRecordStatus",
    [],
    [
      b("outputActive"),
      b("outputPaused"),
      s("outputTimecode"),
      i("outputDuration"),
      i("outputBytes"),
    ],
  ),
  request("ToggleRecord", [], [b("outputActive")]),
  request("StartRecord"),
  request("StopRecord", [], [s("outputPath")]),
  request("ToggleRecordPause"),
  request("PauseRecord"),
  request("ResumeRecord"),
  request("SplitRecordFile"),
  request("CreateRecordChapter", [optional(s("chapterName"), "")]),
  request("GetReplayBufferStatus", [], [b("outputActive")]),
  request("ToggleReplayBuffer", [], [b("outputActive")]),
  request("StartReplayBuffer"),
  request("StopReplayBuffer"),
  request("SaveReplayBuffer"),
  request("GetLastReplayBufferReplay", [], [s("savedReplayPath")]),
  request("GetVirtualCamStatus", [], [b("outputActive")]),
  request("ToggleVirtualCam", [], [b("outputActive")]),
  request("StartVirtualCam"),
  request("StopVirtualCam"),
  request(
    "GetSceneList",
    [],
    [
      s("currentProgramSceneName"),
      s("currentProgramSceneUuid"),
      s("currentPreviewSceneName"),
      s("currentPreviewSceneUuid"),
      j("scenes"),
    ],
  ),
  request("GetGroupList", [], [ss("groups")]),
  request("GetCurrentPreviewScene", [], [s("sceneName"), s("sceneUuid")]),
  request("SetCurrentPreviewScene", [scene]),
  request("CreateScene", [scene], [s("sceneUuid")]),
  request("RemoveScene", [scene]),
  request("SetSceneName", [scene, s("newSceneName")]),
  request(
    "GetSceneSceneTransitionOverride",
    [scene],
    [s("transitionName"), i("transitionDuration")],
    "Get Scene Transition Override",
  ),
  request(
    "SetSceneSceneTransitionOverride",
    [scene, s("transitionName"), i("transitionDuration")],
    [],
    "Set Scene Transition Override",
  ),
  request("GetSceneItemList", [scene], [j("sceneItems")]),
  request("GetGroupSceneItemList", [scene], [j("sceneItems")]),
  request(
    "GetSceneItemId",
    [scene, source, optional(i("searchOffset"), 0)],
    [item],
    "Get Scene Item ID",
  ),
  request("GetSceneItemSource", [scene, item], [source, s("sourceUuid")]),
  request(
    "CreateSceneItem",
    [scene, source, optional(b("sceneItemEnabled"), true)],
    [item],
  ),
  request("RemoveSceneItem", [scene, item]),
  request(
    "DuplicateSceneItem",
    [scene, item, optional(s("destinationSceneName"), "")],
    [item],
  ),
  request("GetSceneItemTransform", [scene, item], [j("sceneItemTransform")]),
  request("SetSceneItemTransform", [scene, item, j("sceneItemTransform")]),
  request("GetSceneItemEnabled", [scene, item], [b("sceneItemEnabled")]),
  request("SetSceneItemEnabled", [scene, item, b("sceneItemEnabled")]),
  request("GetSceneItemLocked", [scene, item], [b("sceneItemLocked")]),
  request("SetSceneItemLocked", [scene, item, b("sceneItemLocked")]),
  request("GetSceneItemIndex", [scene, item], [i("sceneItemIndex")]),
  request("SetSceneItemIndex", [scene, item, i("sceneItemIndex")]),
  request("GetSceneItemBlendMode", [scene, item], [s("sceneItemBlendMode")]),
  request("SetSceneItemBlendMode", [scene, item, s("sceneItemBlendMode")]),
  request("GetInputList", [optional(s("inputKind"), "")], [j("inputs")]),
  request(
    "GetInputKindList",
    [optional(b("unversioned"), false)],
    [ss("inputKinds")],
  ),
  request(
    "GetSpecialInputs",
    [],
    [s("desktop1"), s("desktop2"), s("mic1"), s("mic2"), s("mic3"), s("mic4")],
  ),
  request("RemoveInput", [input]),
  request("SetInputName", [input, s("newInputName")]),
  request(
    "GetInputDefaultSettings",
    [s("inputKind")],
    [j("defaultInputSettings")],
  ),
  request("GetInputSettings", [input], [j("inputSettings"), s("inputKind")]),
  request("SetInputSettings", [
    input,
    j("inputSettings"),
    optional(b("overlay"), true),
  ]),
  request("GetInputMute", [input], [b("inputMuted")]),
  request("SetInputMute", [input, b("inputMuted")]),
  request("ToggleInputMute", [input], [b("inputMuted")]),
  request("GetInputVolume", [input], [f("inputVolumeMul"), f("inputVolumeDb")]),
  request("SetInputVolume", [input, f("inputVolumeMul")]),
  request("GetInputAudioBalance", [input], [f("inputAudioBalance")]),
  request("SetInputAudioBalance", [input, f("inputAudioBalance")]),
  request("GetInputAudioSyncOffset", [input], [i("inputAudioSyncOffset")]),
  request("SetInputAudioSyncOffset", [input, i("inputAudioSyncOffset")]),
  request("GetInputAudioMonitorType", [input], [s("monitorType")]),
  request("SetInputAudioMonitorType", [input, s("monitorType")]),
  request("GetInputAudioTracks", [input], [j("inputAudioTracks")]),
  request("SetInputAudioTracks", [input, j("inputAudioTracks")]),
  request(
    "GetInputPropertiesListPropertyItems",
    [input, s("propertyName")],
    [j("propertyItems")],
  ),
  request("PressInputPropertiesButton", [input, s("propertyName")]),
  request("GetInputDeinterlaceMode", [input], [s("inputDeinterlaceMode")]),
  request("SetInputDeinterlaceMode", [input, s("inputDeinterlaceMode")]),
  request(
    "GetInputDeinterlaceFieldOrder",
    [input],
    [s("inputDeinterlaceFieldOrder")],
  ),
  request("SetInputDeinterlaceFieldOrder", [
    input,
    s("inputDeinterlaceFieldOrder"),
  ]),
  request("GetSourceActive", [source], [b("videoActive"), b("videoShowing")]),
  request(
    "GetSourceScreenshot",
    [
      source,
      s("imageFormat"),
      optional(i("imageWidth"), 0),
      optional(i("imageHeight"), 0),
      optional(i("imageCompressionQuality"), -1),
    ],
    [s("imageData")],
  ),
  request("SaveSourceScreenshot", [
    source,
    s("imageFormat"),
    s("imageFilePath"),
    optional(i("imageWidth"), 0),
    optional(i("imageHeight"), 0),
    optional(i("imageCompressionQuality"), -1),
  ]),
  request("GetSourceFilterList", [source], [j("filters")]),
  request(
    "GetSourceFilterDefaultSettings",
    [s("filterKind")],
    [j("defaultFilterSettings")],
  ),
  request("CreateSourceFilter", [
    source,
    filter,
    s("filterKind"),
    optional(j("filterSettings"), "{}"),
  ]),
  request("RemoveSourceFilter", [source, filter]),
  request("SetSourceFilterName", [source, filter, s("newFilterName")]),
  request(
    "GetSourceFilter",
    [source, filter],
    [
      b("filterEnabled"),
      i("filterIndex"),
      s("filterKind"),
      j("filterSettings"),
    ],
  ),
  request("SetSourceFilterSettings", [
    source,
    filter,
    j("filterSettings"),
    optional(b("overlay"), true),
  ]),
  request("SetSourceFilterEnabled", [source, filter, b("filterEnabled")]),
  request("SetSourceFilterIndex", [source, filter, i("filterIndex")]),
  request("GetSourceFilterKindList", [], [ss("sourceFilterKinds")]),
  request(
    "GetSceneTransitionList",
    [],
    [
      s("currentSceneTransitionName"),
      s("currentSceneTransitionUuid"),
      s("currentSceneTransitionKind"),
      j("transitions"),
    ],
  ),
  request(
    "GetCurrentSceneTransition",
    [],
    [
      s("transitionName"),
      s("transitionUuid"),
      s("transitionKind"),
      b("transitionFixed"),
      i("transitionDuration"),
      b("transitionConfigurable"),
      j("transitionSettings"),
    ],
  ),
  request("SetCurrentSceneTransition", [s("transitionName")]),
  request("SetCurrentSceneTransitionDuration", [i("transitionDuration")]),
  request("SetCurrentSceneTransitionSettings", [
    j("transitionSettings"),
    optional(b("overlay"), true),
  ]),
  request("GetCurrentSceneTransitionCursor", [], [f("transitionCursor")]),
  request("TriggerStudioModeTransition"),
  request(
    "SetTBarPosition",
    [f("position"), optional(b("release"), true)],
    [],
    "Set T-Bar Position",
  ),
  request("GetTransitionKindList", [], [ss("transitionKinds")]),
  request("GetStudioModeEnabled", [], [b("studioModeEnabled")]),
  request("SetStudioModeEnabled", [b("studioModeEnabled")]),
  request("GetOutputList", [], [j("outputs")]),
  request(
    "GetOutputStatus",
    [output],
    [
      b("outputActive"),
      b("outputReconnecting"),
      s("outputTimecode"),
      i("outputDuration"),
      f("outputCongestion"),
      i("outputBytes"),
      i("outputSkippedFrames"),
      i("outputTotalFrames"),
    ],
  ),
  request("ToggleOutput", [output], [b("outputActive")]),
  request("StartOutput", [output]),
  request("StopOutput", [output]),
  request("GetOutputSettings", [output], [j("outputSettings")]),
  request("SetOutputSettings", [output, j("outputSettings")]),
  request(
    "GetMediaInputStatus",
    [input],
    [s("mediaState"), i("mediaDuration"), i("mediaCursor")],
  ),
  request("SetMediaInputCursor", [input, i("mediaCursor")]),
  request("OffsetMediaInputCursor", [input, i("mediaCursorOffset")]),
  request("TriggerMediaInputAction", [input, s("mediaAction")]),
  request("GetHotkeyList", [], [ss("hotkeys")]),
  request("TriggerHotkeyByName", [
    s("hotkeyName"),
    optional(s("contextName"), ""),
  ]),
  request("TriggerHotkeyByKeySequence", [
    s("keyId"),
    optional(j("keyModifiers"), "{}"),
  ]),
  request("GetMonitorList", [], [j("monitors")]),
  request("OpenInputPropertiesDialog", [input]),
  request("OpenInputFiltersDialog", [input]),
  request("OpenInputInteractDialog", [input]),
  request("OpenVideoMixProjector", [
    s("videoMixType"),
    optional(i("monitorIndex"), -1),
    optional(s("projectorGeometry"), ""),
  ]),
  request("OpenSourceProjector", [
    source,
    optional(i("monitorIndex"), -1),
    optional(s("projectorGeometry"), ""),
  ]),
];

const json = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
};
const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
const inputValue = (field: Field, value: unknown) =>
  field.kind === "json" && typeof value === "string"
    ? Effect.try({ try: () => JSON.parse(value), catch: (cause) => cause })
    : Effect.succeed(value);
const outputValue = (
  field: Field,
  value: unknown,
): string | number | boolean | ReadonlyArray<string> => {
  switch (field.kind) {
    case "json":
      return json(value);
    case "string":
      return typeof value === "string"
        ? value
        : value == null
          ? ""
          : String(value);
    case "int":
    case "float":
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    case "bool":
      return value === true;
    case "strings":
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
  }
};
const isListField = (
  field: Field,
): field is Field & { readonly kind: "strings" } => field.kind === "strings";
const isScalarField = (
  field: Field,
): field is Field & { readonly kind: Exclude<Kind, "strings"> } =>
  field.kind !== "strings";

export const ids = [
  ...requests.map(({ id }) => id),
  ...events.map(({ id }) => id),
] as const;
export const count = ids.length;

export const register = Effect.fnUntraced(function* (context: Context) {
  for (const definition of requests) {
    const listOutputs = (definition.outputs ?? []).filter(isListField);
    if (listOutputs.length > 0) {
      const scalarOutputs = (definition.outputs ?? []).filter(isScalarField);
      yield* context.schema.register({
        id: definition.id,
        name: definition.name ?? words(definition.id),
        description: `${definition.id.startsWith("Get") ? "Gets data from" : "Sends a request to"} OBS using ${words(definition.id)}.`,
        properties: socketProperty,
        io: (io) => ({
          inputs: (definition.inputs ?? []).map((field) =>
            io.data.in(field.id, type(field.kind), {
              name: label(field),
              ...(field.defaultValue === undefined
                ? {}
                : { defaultValue: field.defaultValue }),
            }),
          ),
          scalarOutputs: scalarOutputs.map((field) =>
            io.data.out(field.id, type(field.kind), { name: label(field) }),
          ),
          listOutputs: listOutputs.map((field) =>
            io.data.out(field.id, DataType.List(DataType.String), {
              name: label(field),
            }),
          ),
        }),
        run: ({ io, properties, engine }) =>
          Effect.gen(function* () {
            const entries: Array<readonly [string, unknown]> = [];
            for (const [index, field] of (definition.inputs ?? []).entries()) {
              const raw = io.inputs[index];
              if (field.optional === true && Object.is(raw, field.defaultValue))
                continue;
              entries.push([field.id, yield* inputValue(field, raw)]);
            }
            const values = record(
              yield* engine.Call({
                address: properties.socket,
                requestType: definition.id,
                ...(entries.length === 0
                  ? {}
                  : { requestData: Object.fromEntries(entries) }),
              }),
            );
            for (const [index, field] of scalarOutputs.entries()) {
              const write = io.scalarOutputs[index];
              const value = outputValue(field, values[field.id]);
              if (write !== undefined && !Array.isArray(value)) write(value);
            }
            for (const [index, field] of listOutputs.entries()) {
              const write = io.listOutputs[index];
              const value = outputValue(field, values[field.id]);
              if (write !== undefined && Array.isArray(value)) write(value);
            }
          }),
      });
      continue;
    }
    yield* context.schema.register({
      id: definition.id,
      name: definition.name ?? words(definition.id),
      description: `${definition.id.startsWith("Get") ? "Gets data from" : "Sends a request to"} OBS using ${words(definition.id)}.`,
      properties: socketProperty,
      io: (io) => ({
        inputs: (definition.inputs ?? []).map((field) =>
          io.data.in(field.id, type(field.kind), {
            name: label(field),
            ...(field.defaultValue === undefined
              ? {}
              : { defaultValue: field.defaultValue }),
          }),
        ),
        outputs: (definition.outputs ?? []).map((field) =>
          io.data.out(field.id, type(field.kind), { name: label(field) }),
        ),
      }),
      run: ({ io, properties, engine }) =>
        Effect.gen(function* () {
          const entries: Array<readonly [string, unknown]> = [];
          for (const [index, field] of (definition.inputs ?? []).entries()) {
            const raw = io.inputs[index];
            if (field.optional === true && Object.is(raw, field.defaultValue))
              continue;
            entries.push([field.id, yield* inputValue(field, raw)]);
          }
          const result = yield* engine.Call({
            address: properties.socket,
            requestType: definition.id,
            ...(entries.length === 0
              ? {}
              : { requestData: Object.fromEntries(entries) }),
          });
          const values = record(result);
          for (const [index, field] of (definition.outputs ?? []).entries()) {
            const write = io.outputs[index];
            const value = outputValue(field, values[field.id]);
            if (write !== undefined && !Array.isArray(value)) write(value);
          }
        }),
    });
  }
  for (const definition of events) {
    const scalarOutputs = definition.outputs.filter(isScalarField);
    const listOutputs = definition.outputs.filter(isListField);
    yield* context.schema.register({
      id: definition.id,
      name: definition.name ?? words(definition.id),
      description: `Runs when OBS emits ${words(definition.id)} for the selected socket.`,
      type: "event",
      properties: socketProperty,
      event: (value, { properties }) =>
        Effect.succeed(
          value._tag === definition.id &&
            "address" in value &&
            value.address === properties.socket,
        ),
      io: (io) => ({
        scalarOutputs: scalarOutputs.map((field) =>
          io.data.out(field.id, type(field.kind), { name: label(field) }),
        ),
        listOutputs: listOutputs.map((field) =>
          io.data.out(field.id, DataType.List(DataType.String), {
            name: label(field),
          }),
        ),
      }),
      run: ({ event: value, io }) =>
        Effect.sync(() => {
          const values = record(value);
          for (const [index, field] of scalarOutputs.entries()) {
            const write = io.scalarOutputs[index];
            const value = outputValue(field, values[field.id]);
            if (write !== undefined && !Array.isArray(value)) write(value);
          }
          for (const [index, field] of listOutputs.entries()) {
            const write = io.listOutputs[index];
            const value = outputValue(field, values[field.id]);
            if (write !== undefined && Array.isArray(value)) write(value);
          }
        }),
    });
  }
});
