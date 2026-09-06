import type { SchemaAuthoring } from "@macrograph/core";
import type { Effect, Scope } from "effect";

import type { EditorConnection, ModuleSettingsDescriptor } from "./Editor";

import { createEditorCatalog } from "./catalog/createEditorCatalog";
import { createEditorCommands } from "./createEditorCommands";
import { createEditorConnection } from "./session/createEditorConnection";
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
  const catalog = createEditorCatalog(editor, layout.graphs, connection.moduleSettingsById);
  const commands = createEditorCommands(editor, connection, layout);

  return {
    editor,
    layout,
    connection,
    presence,
    catalog,
    commands,
    openProjectSettings: () => layout.openProjectSettings(layout.workspace().focusedPaneId),
    refreshModuleData: connection.refreshModuleData,
  };
}

export type EditorController = ReturnType<typeof createEditorController>;
