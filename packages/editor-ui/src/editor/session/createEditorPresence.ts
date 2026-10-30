import type { Presence } from "@macrograph/editor";

import { Effect } from "effect";
import { createEffect, createSignal, untrack } from "solid-js";

import type { EditorRpcClient } from "../Editor";
import type { createEditorStore } from "../store";
import type { WorkspaceTab } from "../workspace/workspace";

import { runFork } from "../../observability/browserTracing";

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

const sendIntervalMs = 40;

export function createEditorPresence(options: {
  client: () => EditorRpcClient | null;
  editor: ReturnType<typeof createEditorStore>;
  selectedGraphId: () => string | null;
  selectedNodeIds: () => string[];
  activeWorkspaceView: () => WorkspaceTab | { type: "empty" };
  canvasOrigin: () => { readonly x: number; readonly y: number };
  canvasScale: () => number;
  presenceClients: () => ReadonlyArray<Presence.Client>;
  selfId: () => string | undefined;
}) {
  const {
    client,
    editor: { store },
    selectedGraphId,
    selectedNodeIds,
    activeWorkspaceView,
    canvasOrigin,
    canvasScale,
    presenceClients,
    selfId,
  } = options;
  const [localCursor, setLocalCursor] = createSignal<Presence.Cursor | null>(null);
  // The active graph canvas reports its size so the viewport can be shared with followers.
  const [canvasSize, setCanvasSize] = createSignal<CanvasSize | null>(null);
  const activeGraph = () => {
    const graphId = activeWorkspaceView().type === "graph" ? selectedGraphId() : null;
    const graph = graphId === null ? undefined : store.project?.graphs[graphId];
    return graph === undefined ? null : { id: graphId!, graph };
  };
  const viewport = (): Presence.Viewport | null => {
    const size = canvasSize();
    if (size === null || size.width <= 0 || size.height <= 0) return null;
    const origin = canvasOrigin();
    const scale = canvasScale();
    return { x: origin.x, y: origin.y, width: size.width / scale, height: size.height / scale };
  };
  const remotePresence = () =>
    presenceClients().filter(
      (entry) =>
        activeWorkspaceView().type === "graph" &&
        entry.id !== selfId() &&
        entry.activeGraph === selectedGraphId(),
    );

  // Graph-local state is only reported while a graph is open; cursor and viewport are untracked
  // here because they change continuously and are throttled separately.
  const currentUpdate = (): Presence.Update => {
    const active = activeGraph();
    if (active === null)
      return { activeGraph: null, cursor: null, viewport: null, selectedNodeIds: [] };
    return {
      activeGraph: active.id,
      cursor: untrack(localCursor),
      viewport: untrack(viewport),
      selectedNodeIds: selectedNodeIds().filter(
        (nodeId) => active.graph.nodes[nodeId] !== undefined,
      ),
    };
  };
  const send = (update: Presence.Update) =>
    untrack(() => {
      const updatePresence = selfId() === undefined ? null : (client()?.UpdatePresence ?? null);
      if (updatePresence === null) return;
      runFork(updatePresence(update).pipe(Effect.tapError(Effect.log)));
    });

  let lastSend = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const flushPending = () => {
    pendingTimer = undefined;
    lastSend = performance.now();
    untrack(() => send(currentUpdate()));
  };
  const scheduleSend = (final = false) => {
    const elapsed = performance.now() - lastSend;
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    if (final || elapsed >= sendIntervalMs) flushPending();
    else pendingTimer = setTimeout(flushPending, sendIntervalMs - elapsed);
  };

  const publishPointer = (cursor: Presence.Cursor | null, final = false) => {
    setLocalCursor(cursor);
    scheduleSend(final);
  };
  createEffect(
    () => ({
      ready: selfId() !== undefined && client() !== null,
      update: currentUpdate(),
    }),
    ({ ready, update }) => {
      if (!ready) return;
      send(update);
    },
  );
  createEffect(viewport, () => scheduleSend());

  const dispose = () => {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    setLocalCursor(null);
  };

  return { publishPointer, setLocalCursor, setCanvasSize, canvasSize, remotePresence, dispose };
}
