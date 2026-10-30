import type { Actor } from "@macrograph/core";

import { Presence, type EditorEvent } from "@macrograph/editor";
import { createSignal, onCleanup, untrack } from "solid-js";

import type { createEditorStore } from "../store";

/** How long a remote edit stays highlighted on the canvas. */
export const activityHighlightMs = 1800;

/** Highlight colour for actors that are not in presence and have no user to derive one from. */
export const neutralActivityColor = "#a1a1aa";

export interface ActivityHighlight {
  readonly color: string;
  /** Changes on every edit so the highlight animation restarts. */
  readonly token: number;
}

export interface RemoteEdit {
  readonly graphId: string;
  /** Graph-space location of the edit, when it touched a node that still exists. */
  readonly position: { readonly x: number; readonly y: number } | null;
  readonly token: number;
}

type Targets = {
  readonly graphId: string;
  readonly nodeIds: ReadonlyArray<string>;
  readonly connectionIds: ReadonlyArray<string>;
  readonly position: { readonly x: number; readonly y: number } | null;
};

const highlightKey = (graphId: string, id: string) => `${graphId}\0${id}`;

/**
 * Tracks edits made by other actors: briefly highlights the nodes and connections they touched,
 * and remembers where each actor last edited so they can be followed without a live cursor.
 */
export function createEditorActivity(options: {
  editor: ReturnType<typeof createEditorStore>;
  presenceClients: () => ReadonlyArray<Presence.Client>;
  selfId: () => string | undefined;
}) {
  const { store } = options.editor;
  const [nodes, setNodes] = createSignal<ReadonlyMap<string, ActivityHighlight>>(new Map());
  const [connections, setConnections] = createSignal<ReadonlyMap<string, ActivityHighlight>>(
    new Map(),
  );
  const [edits, setEdits] = createSignal<ReadonlyMap<string, RemoteEdit>>(new Map());
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let token = 0;

  const colorFor = (actor: Actor.Client) =>
    untrack(() => {
      const clients = options.presenceClients();
      const client =
        clients.find((entry) => entry.id === actor.id) ??
        (actor.userId === null
          ? undefined
          : clients.find((entry) => entry.userId === actor.userId));
      if (client !== undefined) return client.color;
      return actor.userId === null ? neutralActivityColor : Presence.colorFor(actor.userId);
    });

  const nodePosition = (graphId: string, nodeId: string) =>
    store.project?.graphs[graphId]?.nodes[nodeId]?.position ?? null;

  const targetsOf = (event: EditorEvent.EditorEvent): Targets | undefined => {
    switch (event._tag) {
      case "NodeCreated":
        return {
          graphId: event.graphId,
          nodeIds: [event.node.id],
          connectionIds: [],
          position: event.node.position,
        };
      case "ScopeProjectionCreated":
        return {
          graphId: event.graphId,
          nodeIds: [event.node.id],
          connectionIds: [event.connection.id],
          position: event.node.position,
        };
      case "FragmentPasted":
        return {
          graphId: event.graphId,
          nodeIds: event.nodes.map((node) => node.id),
          connectionIds: event.connections.map((connection) => connection.id),
          position: event.nodes[0]?.position ?? null,
        };
      case "NodePositionChanged":
        return {
          graphId: event.graphId,
          nodeIds: [event.nodeId],
          connectionIds: [],
          position: { x: event.x, y: event.y },
        };
      case "NodeNameChanged":
      case "NodeFoldPinsChanged":
      case "NodeScopeSplitChanged":
      case "NodePropertyUpdated":
      case "InputDefaultUpdated":
        return {
          graphId: event.graphId,
          nodeIds: [event.nodeId],
          connectionIds: [],
          position: nodePosition(event.graphId, event.nodeId),
        };
      case "ConnectionCreated":
        return {
          graphId: event.graphId,
          nodeIds: [],
          connectionIds: [event.connection.id],
          position: nodePosition(event.graphId, event.connection.inNodeId),
        };
      case "NodeDeleted":
      case "FragmentDeleted":
      case "ConnectionDeleted":
        return { graphId: event.graphId, nodeIds: [], connectionIds: [], position: null };
      case "GraphCreated":
      case "FunctionCreated":
        return { graphId: event.graph.id, nodeIds: [], connectionIds: [], position: null };
      case "GraphNameChanged":
        return { graphId: event.graphId, nodeIds: [], connectionIds: [], position: null };
      default:
        return undefined;
    }
  };

  const highlight = (
    set: typeof setNodes,
    kind: string,
    graphId: string,
    ids: ReadonlyArray<string>,
    value: ActivityHighlight,
  ) => {
    if (ids.length === 0) return;
    const keys = ids.map((id) => highlightKey(graphId, id));
    set((current) => {
      const next = new Map(current);
      for (const key of keys) next.set(key, value);
      return next;
    });
    for (const key of keys) {
      const timerKey = `${kind}\0${key}`;
      const existing = timers.get(timerKey);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        timerKey,
        setTimeout(() => {
          timers.delete(timerKey);
          set((current) => {
            if (current.get(key) !== value) return current;
            const next = new Map(current);
            next.delete(key);
            return next;
          });
        }, activityHighlightMs),
      );
    }
  };

  /** Records an event received from the project stream; the caller's own edits are ignored. */
  const record = (event: EditorEvent.EditorEvent) => {
    const actor = event.actor;
    if (actor.type !== "CLIENT" || actor.id === untrack(options.selfId)) return;
    const targets = targetsOf(event);
    if (targets === undefined) return;
    const value: ActivityHighlight = { color: colorFor(actor), token: ++token };
    highlight(setNodes, "node", targets.graphId, targets.nodeIds, value);
    highlight(setConnections, "connection", targets.graphId, targets.connectionIds, value);
    setEdits((current) =>
      new Map(current).set(actor.id, {
        graphId: targets.graphId,
        position: targets.position,
        token: value.token,
      }),
    );
  };

  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });

  return {
    record,
    nodeHighlight: (graphId: string, nodeId: string) => nodes().get(highlightKey(graphId, nodeId)),
    connectionHighlight: (graphId: string, connectionId: string) =>
      connections().get(highlightKey(graphId, connectionId)),
    /** Where an actor most recently edited, used to follow actors without a live viewport. */
    lastEdit: (actorId: string) => edits().get(actorId),
  };
}

export type EditorActivity = ReturnType<typeof createEditorActivity>;
