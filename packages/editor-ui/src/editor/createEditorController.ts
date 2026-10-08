import type { SchemaAuthoring } from "@macrograph/core";
import type { Effect, Scope } from "effect";

import type { EditorConnection, ModuleSettingsDescriptor } from "./Editor";

import { createEditorCatalog } from "./catalog/createEditorCatalog";
import { createEditorCommands } from "./createEditorCommands";
import { createEditorActivity } from "./session/createEditorActivity";
import { createEditorConnection } from "./session/createEditorConnection";
import { createEditorFollow } from "./session/createEditorFollow";
import { createEditorPresence } from "./session/createEditorPresence";
import { createEditorStore } from "./store";
import { createEditorWorkspace } from "./workspace/createEditorWorkspace";

export interface EditorControllerOptions {
  readonly connection: Effect.Effect<EditorConnection, unknown, Scope.Scope>;
  readonly workspaceId: string;
  readonly userId: string;
  readonly settingsDescriptors: ReadonlyArray<ModuleSettingsDescriptor>;
  readonly reconnect?: boolean;
  readonly projectSettings?: boolean;
  readonly authoring?: SchemaAuthoring.Registry;
}

/** Construct in the parent's Solid scope; that scope owns the connection and model. */
export function createEditorController(options: EditorControllerOptions) {
  const editor = createEditorStore(options.authoring);
  const layout = createEditorWorkspace(options, editor, () => presence.setLocalCursor(null));
  const connection = createEditorConnection(
    options,
    editor,
    layout.onProjectSnapshot,
    () => presence.dispose(),
    (event) => activity.record(event),
  );
  const presence = createEditorPresence({
    editor,
    client: connection.client,
    presenceClients: connection.presenceClients,
    selfId: connection.selfId,
    selectedGraphId: layout.selectedGraphId,
    selectedNodeIds: layout.selectedNodeIds,
    activeWorkspaceView: layout.activeWorkspaceView,
    canvasOrigin: layout.canvasOrigin,
    canvasScale: layout.canvasScale,
  });
  const activity = createEditorActivity({
    editor,
    presenceClients: connection.presenceClients,
    selfId: connection.selfId,
  });
  const follow = createEditorFollow({
    editor,
    presenceClients: connection.presenceClients,
    selfId: connection.selfId,
    activity,
    canvasSize: presence.canvasSize,
    layout,
  });
  const catalog = createEditorCatalog(editor, layout.graphs);
  const commands = createEditorCommands(editor, connection, layout);

  return {
    editor,
    layout,
    connection,
    presence,
    activity,
    follow,
    catalog,
    commands,
    openProjectSettings: () => layout.openProjectSettings(layout.workspace().focusedPaneId),
    refreshModuleData: connection.refreshModuleData,
  };
}

export type EditorController = ReturnType<typeof createEditorController>;
