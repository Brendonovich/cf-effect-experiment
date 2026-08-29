import type { Presence } from "@macrograph/editor";

import { Effect } from "effect";
import { createEffect, createSignal, untrack } from "solid-js";

import type { EditorRpcClient } from "../Editor";
import type { createEditorStore } from "../store";
import type { WorkspaceTab } from "../workspace/workspace";

import { runFork } from "../../observability/browserTracing";

export function createEditorPresence(options: {
  client: () => EditorRpcClient | null;
  editor: ReturnType<typeof createEditorStore>;
  selectedGraphId: () => string | null;
  selectedNodeIds: () => string[];
  activeWorkspaceView: () => WorkspaceTab | { type: "empty" };
  presenceClients: () => ReadonlyArray<Presence.Client>;
  selfConnectionId: () => string | undefined;
}) {
  const {
    client,
    editor: { store },
    selectedGraphId,
    selectedNodeIds,
    activeWorkspaceView,
    presenceClients,
    selfConnectionId,
  } = options;
  const [localCursor, setLocalCursor] = createSignal<Presence.Cursor | null>(null);
  const remotePresence = () =>
    presenceClients().filter(
      (entry) =>
        activeWorkspaceView().type === "graph" &&
        entry.connectionId !== selfConnectionId() &&
        entry.activeGraph === selectedGraphId(),
    );
  const sendPresence = (cursor: Presence.Cursor | null) => {
    const c = client();
    const graphId = activeWorkspaceView().type === "graph" ? selectedGraphId() : null;
    const graph = graphId === null ? undefined : store.project?.graphs[graphId];
    const activeGraph = graph === undefined ? null : graphId;
    if (c === null || selfConnectionId() === undefined) return;
    runFork(
      c
        .UpdatePresence({
          activeGraph,
          cursor: activeGraph === null ? null : cursor,
          selectedNodeIds:
            graph === undefined
              ? []
              : selectedNodeIds().filter((nodeId) => graph.nodes[nodeId] !== undefined),
        })
        .pipe(Effect.tapError(Effect.log)),
    );
  };
  let lastPresencePointerSend = 0;
  let pendingPresenceTimer: ReturnType<typeof setTimeout> | undefined;
  const publishPointer = (cursor: Presence.Cursor | null, final = false) => {
    setLocalCursor(cursor);
    const elapsed = performance.now() - lastPresencePointerSend;
    if (pendingPresenceTimer !== undefined) clearTimeout(pendingPresenceTimer);
    if (final || elapsed >= 40) {
      pendingPresenceTimer = undefined;
      lastPresencePointerSend = performance.now();
      sendPresence(cursor);
      return;
    }
    pendingPresenceTimer = setTimeout(() => {
      pendingPresenceTimer = undefined;
      lastPresencePointerSend = performance.now();
      sendPresence(localCursor());
    }, 40 - elapsed);
  };
  createEffect(
    () => {
      const graphId = activeWorkspaceView().type === "graph" ? selectedGraphId() : null;
      const graph = graphId === null ? undefined : store.project?.graphs[graphId];
      return {
        updatePresence:
          selfConnectionId() === undefined ? null : (client()?.UpdatePresence ?? null),
        activeGraph: graph === undefined ? null : graphId,
        cursor: untrack(localCursor),
        selectedNodeIds:
          graph === undefined
            ? []
            : selectedNodeIds().filter((nodeId) => graph.nodes[nodeId] !== undefined),
      };
    },
    ({ updatePresence, activeGraph, cursor, selectedNodeIds }) => {
      if (updatePresence === null) return;
      runFork(
        updatePresence({
          activeGraph,
          cursor: activeGraph === null ? null : cursor,
          selectedNodeIds,
        }).pipe(Effect.tapError(Effect.log)),
      );
    },
  );
  const dispose = () => {
    if (pendingPresenceTimer !== undefined) clearTimeout(pendingPresenceTimer);
    setLocalCursor(null);
  };

  return { publishPointer, setLocalCursor, remotePresence, dispose };
}
