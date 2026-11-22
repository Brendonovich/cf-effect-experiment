import type { SchemaAuthoring } from "@macrograph/core";

import { Effect, type Scope } from "effect";

import type { EditorConnection } from "./Editor";
import type { EditorModules } from "./modules/EditorModules";

import { createEditorCatalog } from "./catalog/createEditorCatalog";
import { createEditorCommands } from "./createEditorCommands";
import { createEditorActivity } from "./session/createEditorActivity";
import { createEditorConnection } from "./session/createEditorConnection";
import { createEditorFollow, viewForTarget } from "./session/createEditorFollow";
import { createEditorPresence } from "./session/createEditorPresence";
import { createEditorStore } from "./store";
import { createEditorWorkspace } from "./workspace/createEditorWorkspace";

export interface EditorControllerOptions<Connection extends EditorConnection = EditorConnection> {
  readonly connection: Effect.Effect<Connection, unknown, Scope.Scope>;
  readonly workspaceId: string;
  readonly userId: string;
  /** The module catalog source, UI loader and per-module RPC protocols. */
  readonly modules: EditorModules<Connection>;
  readonly reconnect?: boolean;
  readonly projectSettings?: boolean;
  readonly authoring?: SchemaAuthoring.Registry;
}

/** Construct in the parent's Solid scope; that scope owns the connection and model. */
export function createEditorController<Connection extends EditorConnection>(
  options: EditorControllerOptions<Connection>,
) {
  const editor = createEditorStore(options.authoring);
  const layout = createEditorWorkspace(options, editor, () => presence.setLocalCursor(null));
  const modules = options.modules;
  const connection = createEditorConnection(
    {
      connection: Effect.map(options.connection, (connection) => ({
        connection,
        modules: {
          catalog: modules.catalog(connection),
          rpcProtocol: modules.rpcProtocol(connection),
        },
      })),
      loader: modules.loader,
      ...(options.reconnect === undefined ? {} : { reconnect: options.reconnect }),
    },
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

  /** Opens a graph in the focused pane, centred on and selecting one of its nodes. */
  const revealNode = (graphId: string, nodeId: string) => {
    const node = editor.store.project?.graphs[graphId]?.nodes[nodeId];
    if (node === undefined) return;
    const reveal = () => {
      const view = viewForTarget({ graphId, point: node.position }, presence.canvasSize(), {
        origin: layout.canvasOrigin(),
        scale: layout.canvasScale(),
      });
      if (view !== null) layout.setCanvasOrigin(view.origin);
      layout.setSelectedNodeIds([nodeId]);
    };
    const view = layout.activeWorkspaceView();
    if (view.type === "graph" && view.graphId === graphId) return reveal();
    layout.setSelectedGraphId(graphId);
    // Opening a graph restores its saved view in a microtask; reveal the node after that.
    queueMicrotask(reveal);
  };

  return {
    editor,
    layout,
    connection,
    presence,
    activity,
    follow,
    catalog,
    commands,
    revealNode,
    openProjectSettings: () => layout.openProjectSettings(layout.workspace().focusedPaneId),
    refreshModuleData: connection.refreshModuleData,
  };
}

export type EditorController = ReturnType<typeof createEditorController>;
