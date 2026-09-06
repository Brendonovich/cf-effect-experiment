export const highVolumeSubscriptions = {
  InputVolumeMeters: 1 << 16,
  InputActiveStateChanged: 1 << 17,
  InputShowStateChanged: 1 << 18,
  SceneItemTransformChanged: 1 << 19,
} as const;

export type HighVolumeEvent = keyof typeof highVolumeSubscriptions;

// Canvas addressing and the Canvases subscription were added in 5.7.0.
// Unknown and prerelease versions are deliberately not assumed compatible.
export const supportsCanvases = (version: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 5 || (major === 5 && minor >= 7);
};

export const canvasRequests: ReadonlySet<string> = new Set([
  "GetSourceFilterList",
  "CreateSourceFilter",
  "RemoveSourceFilter",
  "SetSourceFilterName",
  "GetSourceFilter",
  "SetSourceFilterIndex",
  "SetSourceFilterSettings",
  "SetSourceFilterEnabled",
  "CreateInput",
  "GetSceneItemList",
  "GetGroupSceneItemList",
  "GetSceneItemId",
  "GetSceneItemSource",
  "CreateSceneItem",
  "RemoveSceneItem",
  "DuplicateSceneItem",
  "GetSceneItemTransform",
  "SetSceneItemTransform",
  "GetSceneItemEnabled",
  "SetSceneItemEnabled",
  "GetSceneItemLocked",
  "SetSceneItemLocked",
  "GetSceneItemIndex",
  "SetSceneItemIndex",
  "GetSceneItemBlendMode",
  "SetSceneItemBlendMode",
  "GetSceneList",
  "CreateScene",
  "RemoveScene",
  "SetSceneName",
  "GetSceneSceneTransitionOverride",
  "SetSceneSceneTransitionOverride",
  "GetSourceActive",
  "GetSourceScreenshot",
  "SaveSourceScreenshot",
  "OpenSourceProjector",
]);
