import type { Effect, Scope } from "effect";

import type { EditorConnection, PluginSettingsDescriptor } from "./Editor";

import { createEditorCatalog } from "./catalog/createEditorCatalog";
import { createEditorCommands } from "./createEditorCommands";
import { createEditorConnection } from "./session/createEditorConnection";
import { createEditorPresence } from "./session/createEditorPresence";
import { createEditorWorkspace } from "./workspace/createEditorWorkspace";
import { createEditorStore } from "./store";

export interface EditorControllerOptions {
  readonly connection: Effect.Effect<EditorConnection, unknown, Scope.Scope>;
  readonly workspaceId: string;
  readonly userId: string;
  readonly settingsDescriptors: ReadonlyArray<PluginSettingsDescriptor>;
  readonly reconnect?: boolean;
  readonly projectSettings?: boolean;
}

/** Construct in the parent's Solid scope; that scope owns the connection and model. */
export function createEditorController(options: EditorControllerOptions) {
  const editor = createEditorStore();
  const layout = createEditorWorkspace(options, editor, () => presence.setLocalCursor(null));
  const connection = createEditorConnection(options, editor, layout.onProjectSnapshot, () =>
    presence.dispose(),
  );
  const presence = createEditorPresence({
    editor,
    client: connection.client,
    presenceClients: connection.presenceClients,
    selfConnectionId: connection.selfConnectionId,
    selectedGraphId: layout.selectedGraphId,
    selectedNodeIds: layout.selectedNodeIds,
    activeWorkspaceView: layout.activeWorkspaceView,
  });
  const catalog = createEditorCatalog(editor, layout.graphs, connection.pluginSettingsById);
  const commands = createEditorCommands(editor, connection, layout);

  return {
    editor,
    layout,
    connection,
    presence,
    catalog,
    commands,
    openProjectSettings: () => layout.openProjectSettings(layout.workspace().focusedPaneId),
    refreshPluginData: connection.refreshPluginData,
  };
}

export type EditorController = ReturnType<typeof createEditorController>;
