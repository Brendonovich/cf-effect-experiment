import type { EditorEvent, Presence } from "@macrograph/editor";

import { IoId, type Graph, type Node } from "@macrograph/core";
import { Effect } from "effect";
import { createMemo, createSignal, onSettled } from "solid-js";

import type { EditorRpcClient } from "../Editor";
import type { createEditorStore } from "../store";

import { runFork } from "../../observability/browserTracing";
import { createPresence } from "../../ui/createPresence";
import { createStateMachine } from "../../ui/createStateMachine";
import { findSnapTarget, type PortDirection, type PortEndpoint } from "./connectionAuthoring";
import {
  GRAPH_NODE_IO_SPACING,
  type GraphPort,
  connectedPortIds as graphConnectedPortIds,
  graphConnections as presentGraphConnections,
  graphNodeInputs,
  graphNodeOutputs,
  graphNodeWidth,
  handlePosition as graphHandlePosition,
  visibleNodePorts as graphVisibleNodePorts,
} from "./graphPresentation";
import { zoomOriginAt } from "../workspace/workspace";

export interface EditorCanvasOptions {
  readonly editor: ReturnType<typeof createEditorStore>;
  readonly client: () => EditorRpcClient | null;
  readonly canEdit: () => boolean;
  readonly publishPointer: (cursor: Presence.Cursor | null, final?: boolean) => void;
  readonly selectedGraphId: () => string | null;
  readonly selectedGraph: () => Graph.Model | null;
  readonly nodes: () => ReadonlyArray<Node.Model>;
  readonly selectedNodeIds: () => string[];
  readonly setSelectedNodeIds: (next: string[] | ((current: string[]) => string[])) => void;
  readonly canvasScale: () => number;
  readonly setCanvasScale: (next: number) => void;
  readonly canvasOrigin: () => { x: number; y: number };
  readonly setCanvasOrigin: (
    next:
      | { x: number; y: number }
      | ((current: { x: number; y: number }) => { x: number; y: number }),
  ) => void;
}

export function createEditorCanvas(options: EditorCanvasOptions) {
  const {
    editor,
    client,
    canEdit,
    publishPointer,
    selectedGraphId,
    selectedGraph,
    nodes,
    selectedNodeIds,
    setSelectedNodeIds,
    canvasScale,
    setCanvasScale,
    canvasOrigin,
    setCanvasOrigin,
  } = options;
  const { store, applyEvent, updateNodePosition } = editor;
  const applyMutation = <Event extends EditorEvent.EditorEvent, Error, Requirements>(
    effect: Effect.Effect<Event, Error, Requirements>,
  ) => effect.pipe(Effect.tap((event) => Effect.sync(() => applyEvent(event))));
  const ephemeralSendIntervalMs = 24;

  const gridForScale = (scale: number) => {
    const level = -Math.log2(scale);
    const fineLevel = Math.floor(level);
    const levelProgress = level - fineLevel;
    const fineSpacing = 40 * 2 ** fineLevel * scale;
    return {
      fineLevel,
      fineSpacing,
      coarseSpacing: fineSpacing * 2,
      additionalOpacity: levelProgress < 0.5 ? 1 : 0,
    };
  };

  type NodeMenu = {
    screen: { x: number; y: number };
    graph: { x: number; y: number };
    source?: PortEndpoint;
  };
  type NodeContextMenu = {
    nodeId: string;
    screen: { x: number; y: number };
  };
  type SelectionRect = {
    start: { x: number; y: number };
    current: { x: number; y: number };
  };
  type ConnectionDrag = {
    readonly pointerId: number;
    readonly source: PortEndpoint;
    readonly pointer: { readonly x: number; readonly y: number };
    readonly target?: PortEndpoint;
  };
  type CanvasInteraction = {
    readonly context: { nodeMenu?: NodeMenu };
    mode:
      | { readonly type: "idle" }
      | { readonly type: "node-menu" }
      | { readonly type: "node-creation"; readonly id: symbol }
      | { readonly type: "node-context-menu"; readonly value: NodeContextMenu }
      | { readonly type: "selection"; readonly value: SelectionRect }
      | { readonly type: "connection"; readonly value: ConnectionDrag };
  };
  const [canvasInteraction, canvasActions] = createStateMachine(
    {
      context: {},
      mode: { type: "idle" },
    } as CanvasInteraction,
    {
      setNodeMenu(state, value: NodeMenu | undefined) {
        if (value !== undefined) {
          state.context.nodeMenu = value;
          state.mode = { type: "node-menu" };
        } else if (state.mode.type === "node-menu") state.mode = { type: "idle" };
      },
      beginNodeCreation(state, id: symbol) {
        if (state.mode.type === "node-menu") state.mode = { type: "node-creation", id };
      },
      endNodeCreation(state, id: symbol) {
        if (state.mode.type === "node-creation" && state.mode.id === id)
          state.mode = { type: "idle" };
      },
      setNodeContextMenu(state, value: NodeContextMenu | undefined) {
        if (value !== undefined) state.mode = { type: "node-context-menu", value };
        else if (state.mode.type === "node-context-menu") state.mode = { type: "idle" };
      },
      setSelectionRect(state, value: SelectionRect | undefined) {
        if (value !== undefined) state.mode = { type: "selection", value };
        else if (state.mode.type === "selection") state.mode = { type: "idle" };
      },
      setConnectionDrag(
        state,
        next:
          | ConnectionDrag
          | undefined
          | ((current: ConnectionDrag | undefined) => ConnectionDrag | undefined),
      ) {
        const active = state.mode.type === "connection" ? state.mode.value : undefined;
        const value = typeof next === "function" ? next(active) : next;
        if (value !== undefined) state.mode = { type: "connection", value };
        else if (state.mode.type === "connection") state.mode = { type: "idle" };
      },
    },
  );
  const nodeMenu = createMemo(() => {
    return canvasInteraction.mode.type === "node-menu"
      ? canvasInteraction.context.nodeMenu
      : undefined;
  });
  const setNodeMenu = canvasActions.setNodeMenu;
  const nodeContextMenu = createMemo(() => {
    const mode = canvasInteraction.mode;
    return mode.type === "node-context-menu" ? mode.value : undefined;
  });
  const setNodeContextMenu = canvasActions.setNodeContextMenu;
  const selectionRect = createMemo(() => {
    const mode = canvasInteraction.mode;
    return mode.type === "selection" ? mode.value : undefined;
  });
  const setSelectionRect = canvasActions.setSelectionRect;
  const connectionDrag = createMemo(() => {
    const mode = canvasInteraction.mode;
    return mode.type === "connection" ? mode.value : undefined;
  });
  const setConnectionDrag = canvasActions.setConnectionDrag;
  const connectionPreview = createMemo(() => {
    const mode = canvasInteraction.mode;
    if (mode.type === "connection") return mode.value;
    if (mode.type !== "node-menu" && mode.type !== "node-creation") return;
    const menu = canvasInteraction.context.nodeMenu;
    if (menu?.source === undefined) return;
    return { source: menu.source, pointer: menu.graph, target: undefined };
  });
  const createNodeFromMenu = async (create: (menu: NodeMenu) => Promise<void> | undefined) => {
    const menu = nodeMenu();
    if (menu === undefined) return;
    const id = Symbol();
    canvasActions.beginNodeCreation(id);
    try {
      await create(menu);
    } finally {
      canvasActions.endNodeCreation(id);
    }
  };
  const presentNodeMenu = () => canvasInteraction.context.nodeMenu;
  const [nodeMenuElement, setNodeMenuElement] = createSignal<HTMLDivElement | null>(null);
  const nodeMenuPresence = createPresence({
    show: () => nodeMenu() !== undefined,
    element: nodeMenuElement,
  });

  const schemaForNode = (node: { schema: { package: string; schema: string } }) =>
    store.packages
      .find((pkg) => pkg.id === node.schema.package)
      ?.schemas.find((schema) => schema.id === node.schema.schema);

  const ioForNode = (nodeId: string) => {
    const graphId = selectedGraphId();
    return graphId === null ? undefined : store.nodeIO[graphId]?.[nodeId];
  };

  const connectedPortIds = (nodeId: string, direction: PortDirection) => {
    const graph = selectedGraph();
    return graph === null ? new Set<string>() : graphConnectedPortIds(graph, nodeId, direction);
  };

  const visibleNodePorts = (nodeId: string, direction: PortDirection) => {
    const graph = selectedGraph();
    return graph === null ? [] : graphVisibleNodePorts(graph, ioForNode, nodeId, direction);
  };

  const handlePosition = (
    nodeId: string,
    ioId: string,
    direction: PortDirection,
    kind: GraphPort["kind"],
  ) => {
    const graph = selectedGraph();
    return graph === null
      ? undefined
      : graphHandlePosition(graph, ioForNode, nodeId, ioId, direction, kind);
  };

  const graphConnections = createMemo(() => {
    const graph = selectedGraph();
    return graph === null ? [] : presentGraphConnections(graph, ioForNode);
  });

  let graphCanvas: HTMLDivElement | undefined;
  const setGraphCanvas = (element: HTMLDivElement) => {
    graphCanvas = element;
  };

  const canvasPosition = (clientX: number, clientY: number) => {
    const bounds = graphCanvas?.getBoundingClientRect();
    if (!bounds) return { x: clientX, y: clientY };
    return {
      x: (clientX - bounds.left) / canvasScale() + canvasOrigin().x,
      y: (clientY - bounds.top) / canvasScale() + canvasOrigin().y,
    };
  };

  const portEndpoints = (): ReadonlyArray<PortEndpoint> => {
    const graph = selectedGraph();
    if (!graph) return [];
    return Object.values(graph.nodes).flatMap((node) => {
      const inputs = visibleNodePorts(node.id, "input").flatMap((port) => {
        const position = handlePosition(node.id, port.id, "input", port.kind);
        return position === undefined
          ? []
          : [
              {
                nodeId: node.id,
                direction: "input" as const,
                port,
                position,
                occupied: graph.connections.some(
                  (connection) => connection.inNodeId === node.id && connection.inIoId === port.id,
                ),
              },
            ];
      });
      const outputs = visibleNodePorts(node.id, "output").flatMap((port) => {
        const position = handlePosition(node.id, port.id, "output", port.kind);
        return position === undefined
          ? []
          : [{ nodeId: node.id, direction: "output" as const, port, position }];
      });
      return [...inputs, ...outputs];
    });
  };

  const snapTargetAt = (
    source: PortEndpoint,
    pointer: { readonly x: number; readonly y: number },
  ) => findSnapTarget(source, portEndpoints(), pointer, 32 / canvasScale());

  const onConnectionMove = (event: PointerEvent) => {
    const pointer = canvasPosition(event.clientX, event.clientY);
    setConnectionDrag((current) => {
      if (current === undefined || current.pointerId !== event.pointerId) return current;
      const target = snapTargetAt(current.source, pointer);
      return target === undefined
        ? { pointerId: current.pointerId, source: current.source, pointer }
        : {
            pointerId: current.pointerId,
            source: current.source,
            pointer,
            target,
          };
    });
  };

  const cancelConnection = () => {
    setConnectionDrag(undefined);
    window.removeEventListener("pointermove", onConnectionMove);
    window.removeEventListener("pointerup", endConnection);
    window.removeEventListener("pointercancel", endConnection);
  };

  const endConnection = (event: PointerEvent) => {
    const drag = connectionDrag();
    if (!drag || drag.pointerId !== event.pointerId) return;
    cancelConnection();
    if (event.type === "pointercancel") return;

    const pointer = canvasPosition(event.clientX, event.clientY);
    const target = snapTargetAt(drag.source, pointer);
    const graphId = selectedGraphId();
    const c = client();
    if (!c || !graphId || !canEdit()) return;
    if (target === undefined) {
      setNodeMenu({
        screen: { x: event.clientX, y: event.clientY },
        graph: pointer,
        source: drag.source,
      });
      return;
    }

    const output = drag.source.direction === "output" ? drag.source : target;
    const input = drag.source.direction === "input" ? drag.source : target;

    runFork(
      applyMutation(
        c.CreateConnection({
          graphId,
          connection: {
            outNodeId: output.nodeId,
            outIoId: IoId.make(output.port.id),
            inNodeId: input.nodeId,
            inIoId: IoId.make(input.port.id),
          },
        }),
      ).pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
    );
  };

  const startConnection = (
    event: PointerEvent,
    nodeId: string,
    ioId: string,
    kind: GraphPort["kind"],
    direction: PortDirection,
  ) => {
    if (!canEdit()) return;
    cancelConnection();
    if (
      direction === "input" &&
      selectedGraph()?.connections.some(
        (connection) => connection.inNodeId === nodeId && connection.inIoId === ioId,
      )
    )
      return;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    const bounds = handle.getBoundingClientRect();
    const position = canvasPosition(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    const ports =
      direction === "input"
        ? graphNodeInputs(ioForNode(nodeId))
        : graphNodeOutputs(ioForNode(nodeId));
    const port = ports.find((candidate) => candidate.id === ioId && candidate.kind === kind);
    if (port === undefined) return;
    const source: PortEndpoint = { nodeId, direction, port, position };
    const pointer = canvasPosition(event.clientX, event.clientY);
    const target = snapTargetAt(source, pointer);
    setConnectionDrag(
      target === undefined
        ? { pointerId: event.pointerId, source, pointer }
        : { pointerId: event.pointerId, source, pointer, target },
    );
    window.addEventListener("pointermove", onConnectionMove);
    window.addEventListener("pointerup", endConnection);
    window.addEventListener("pointercancel", endConnection);
  };

  type NodeDragState = {
    pointerId: number;
    graphId: string;
    startClientX: number;
    startClientY: number;
    items: Array<{ nodeId: string; origX: number; origY: number }>;
    lastSend: number;
    pending: Array<{ nodeId: string; x: number; y: number }> | null;
    current: Array<{ nodeId: string; x: number; y: number }>;
  };
  const [getDragState, setDragState] = createSignal<NodeDragState | null>(null);

  const sendEphemeral = (
    graphId: string,
    positions: ReadonlyArray<{
      readonly nodeId: string;
      readonly x: number;
      readonly y: number;
    }>,
  ) => {
    const c = client();
    if (c === null || !canEdit()) return;
    for (const position of positions) {
      runFork(
        c
          .SetNodePosition({ graphId, ...position, ephemeral: true })
          .pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
      );
    }
  };

  const publishDragPointer = (event: PointerEvent, final = false) => {
    if (event.pointerType === "touch") return;
    const bounds = graphCanvas?.getBoundingClientRect();
    const outside =
      bounds !== undefined &&
      (event.clientX < bounds.left ||
        event.clientX >= bounds.right ||
        event.clientY < bounds.top ||
        event.clientY >= bounds.bottom);
    publishPointer(
      outside || event.type === "pointercancel"
        ? null
        : canvasPosition(event.clientX, event.clientY),
      final,
    );
  };

  const onDragMove = (e: PointerEvent) => {
    const currentDrag = getDragState();
    if (!currentDrag || currentDrag.pointerId !== e.pointerId) return;
    publishDragPointer(e);
    const dx = (e.clientX - currentDrag.startClientX) / canvasScale();
    const dy = (e.clientY - currentDrag.startClientY) / canvasScale();
    const positions = currentDrag.items.map((item) => ({
      nodeId: item.nodeId,
      x: item.origX + dx,
      y: item.origY + dy,
    }));
    positions.forEach((position) => {
      updateNodePosition(currentDrag.graphId, position.nodeId, position.x, position.y);
    });
    currentDrag.current = positions;
    const now = performance.now();
    if (now - currentDrag.lastSend >= ephemeralSendIntervalMs) {
      currentDrag.lastSend = now;
      currentDrag.pending = null;
      [positions].forEach((value) => sendEphemeral(currentDrag.graphId, value));
    } else {
      currentDrag.pending = positions;
    }
  };

  const onDragEnd = (e: PointerEvent) => {
    const currentDrag = getDragState();
    if (!currentDrag || currentDrag.pointerId !== e.pointerId) return;
    publishDragPointer(e, true);
    const ds = currentDrag;
    setDragState(null);
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    const positions =
      e.type === "pointercancel"
        ? ds.current
        : ds.items.map((item) => ({
            nodeId: item.nodeId,
            x: item.origX + (e.clientX - ds.startClientX) / canvasScale(),
            y: item.origY + (e.clientY - ds.startClientY) / canvasScale(),
          }));
    const c = client();
    if (c) {
      positions.forEach((position) => {
        runFork(
          applyMutation(
            c.SetNodePosition({
              graphId: ds.graphId,
              ...position,
            }),
          ).pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
        );
      });
    }
  };

  const cancelNodeDrag = () => {
    const ds = getDragState();
    if (ds === null) return;
    setDragState(null);
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    const positions = ds.items.map((item) => ({
      nodeId: item.nodeId,
      x: item.origX,
      y: item.origY,
    }));
    positions.forEach((position) => {
      updateNodePosition(ds.graphId, position.nodeId, position.x, position.y);
    });
    [positions].forEach((value) => sendEphemeral(ds.graphId, value));
  };

  const onNodeMouseDown = (
    e: PointerEvent,
    node: { id: string; position: { x: number; y: number } },
  ) => {
    if (!canEdit()) return;
    cancelNodeDrag();
    e.preventDefault();
    e.stopPropagation();
    const graphId = selectedGraphId();
    if (!graphId) return;
    const graph = selectedGraph();
    const ids = selectedNodeIds().includes(node.id) ? selectedNodeIds() : [node.id];
    if (!selectedNodeIds().includes(node.id)) {
      setSelectedNodeIds([node.id]);
    }
    setDragState({
      pointerId: e.pointerId,
      graphId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      items: ids.flatMap((id) => {
        const item = graph?.nodes[id];
        return item ? [{ nodeId: id, origX: item.position.x, origY: item.position.y }] : [];
      }),
      lastSend: performance.now(),
      pending: null,
      current: ids.flatMap((id) => {
        const item = graph?.nodes[id];
        return item ? [{ nodeId: id, x: item.position.x, y: item.position.y }] : [];
      }),
    });
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
  };

  const selectNode = (nodeId: string, additive: boolean) => {
    if (!additive) {
      setSelectedNodeIds([nodeId]);
      return;
    }
    setSelectedNodeIds((ids) =>
      ids.includes(nodeId) ? ids.filter((id) => id !== nodeId) : [...ids, nodeId],
    );
  };

  const selectNodesInArea = (
    startGraph: { x: number; y: number },
    current: { x: number; y: number },
    additive: boolean,
  ) => {
    const left = Math.min(startGraph.x, current.x);
    const right = Math.max(startGraph.x, current.x);
    const top = Math.min(startGraph.y, current.y);
    const bottom = Math.max(startGraph.y, current.y);
    const selected = nodes()
      .filter((node) => {
        const io = ioForNode(node.id);
        const width = graphNodeWidth(io, node.name);
        const height =
          38 +
          Math.max(
            visibleNodePorts(node.id, "input").length,
            visibleNodePorts(node.id, "output").length,
          ) *
            GRAPH_NODE_IO_SPACING;
        return (
          node.position.x >= left &&
          node.position.y >= top &&
          node.position.x + width <= right &&
          node.position.y + height <= bottom
        );
      })
      .map((node) => node.id);
    const next = additive ? Array.from(new Set([...selectedNodeIds(), ...selected])) : selected;
    setSelectedNodeIds(next);
  };

  type TouchPoint = { x: number; y: number };
  let touchPointers = new Map<number, TouchPoint>();
  let touchStart:
    | {
        pointer: TouchPoint;
        graph: TouchPoint;
        origin: TouchPoint;
        moved: boolean;
        longPressed: boolean;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  let twoTouchStart:
    | {
        points: [TouchPoint, TouchPoint];
        origin: TouchPoint;
        scale: number;
      }
    | undefined;

  const stopTouchGesture = () => {
    if (touchStart) clearTimeout(touchStart.timer);
    touchStart = undefined;
    twoTouchStart = undefined;
    touchPointers = new Map();
    setSelectionRect(undefined);
    window.removeEventListener("pointermove", onTouchMove);
    window.removeEventListener("pointerup", onTouchEnd);
    window.removeEventListener("pointercancel", onTouchEnd);
  };

  const onTouchMove = (event: PointerEvent) => {
    if (!touchPointers.has(event.pointerId)) return;
    touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (touchPointers.size === 2 && twoTouchStart) {
      const current = Array.from(touchPointers.values()) as [TouchPoint, TouchPoint];
      const [startA, startB] = twoTouchStart.points;
      const [currentA, currentB] = current;
      const startDistance = Math.hypot(startB.x - startA.x, startB.y - startA.y);
      const currentDistance = Math.hypot(currentB.x - currentA.x, currentB.y - currentA.y);
      const nextScale = Math.min(
        2,
        Math.max(0.25, twoTouchStart.scale * (currentDistance / Math.max(1, startDistance))),
      );
      const bounds = graphCanvas?.getBoundingClientRect();
      if (!bounds) return;
      const startMidpoint = {
        x: (startA.x + startB.x) / 2 - bounds.left,
        y: (startA.y + startB.y) / 2 - bounds.top,
      };
      const currentMidpoint = {
        x: (currentA.x + currentB.x) / 2 - bounds.left,
        y: (currentA.y + currentB.y) / 2 - bounds.top,
      };
      setCanvasScale(nextScale);
      setCanvasOrigin(
        zoomOriginAt(
          twoTouchStart.origin,
          twoTouchStart.scale,
          nextScale,
          startMidpoint,
          currentMidpoint,
        ),
      );
      return;
    }

    if (!touchStart || touchStart.longPressed) return;
    const distance = Math.hypot(
      event.clientX - touchStart.pointer.x,
      event.clientY - touchStart.pointer.y,
    );
    if (!touchStart.moved && distance <= 3) return;
    touchStart.moved = true;
    clearTimeout(touchStart.timer);
    setSelectionRect({
      start: touchStart.pointer,
      current: { x: event.clientX, y: event.clientY },
    });
    selectNodesInArea(touchStart.graph, canvasPosition(event.clientX, event.clientY), false);
  };

  const onTouchEnd = (event: PointerEvent) => {
    if (!touchPointers.has(event.pointerId)) return;
    stopTouchGesture();
  };

  const onCanvasTouchDown = (event: PointerEvent) => {
    event.preventDefault();
    if (touchPointers.size >= 2) return;
    setNodeMenu(undefined);
    setNodeContextMenu(undefined);
    touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (touchPointers.size === 2) {
      if (touchStart) clearTimeout(touchStart.timer);
      setSelectionRect(undefined);
      twoTouchStart = {
        points: Array.from(touchPointers.values()) as [TouchPoint, TouchPoint],
        origin: canvasOrigin(),
        scale: canvasScale(),
      };
      return;
    }

    setSelectedNodeIds([]);
    const pointer = { x: event.clientX, y: event.clientY };
    touchStart = {
      pointer,
      graph: canvasPosition(event.clientX, event.clientY),
      origin: canvasOrigin(),
      moved: false,
      longPressed: false,
      timer: setTimeout(() => {
        if (!touchStart || touchStart.moved || touchPointers.size !== 1) return;
        touchStart.longPressed = true;
        setNodeMenu({ screen: pointer, graph: touchStart.graph });
      }, 300),
    };
    window.addEventListener("pointermove", onTouchMove);
    window.addEventListener("pointerup", onTouchEnd);
    window.addEventListener("pointercancel", onTouchEnd);
  };

  let cancelCanvasGesture: () => void = () => {};
  const onCanvasPointerDown = (event: PointerEvent) => {
    // Canvas gestures prevent the browser's default focus clearing.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) focused.blur();

    if (event.pointerType === "touch") {
      onCanvasTouchDown(event);
      return;
    }
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    event.preventDefault();
    setNodeMenu(undefined);
    setNodeContextMenu(undefined);
    const startScreen = { x: event.clientX, y: event.clientY };
    const startGraph = canvasPosition(event.clientX, event.clientY);
    const startOrigin = canvasOrigin();
    const additive = event.shiftKey;
    let moved = false;
    cancelCanvasGesture();

    if (event.button === 0) {
      if (!additive) {
        setSelectedNodeIds([]);
      }
    }

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startScreen.x;
      const dy = moveEvent.clientY - startScreen.y;
      moved ||= Math.hypot(dx, dy) > 5;
      if (event.button === 1 || event.button === 2) {
        setCanvasOrigin({
          x: startOrigin.x - dx / canvasScale(),
          y: startOrigin.y - dy / canvasScale(),
        });
        return;
      }
      if (!moved) return;

      setSelectionRect({
        start: startScreen,
        current: { x: moveEvent.clientX, y: moveEvent.clientY },
      });
      selectNodesInArea(startGraph, canvasPosition(moveEvent.clientX, moveEvent.clientY), additive);
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setSelectionRect(undefined);
      if (cancelCanvasGesture === cleanup) cancelCanvasGesture = () => {};
    };
    const up = (upEvent: PointerEvent) => {
      cleanup();
      if (event.button === 2 && !moved) {
        setNodeMenu({
          screen: { x: upEvent.clientX, y: upEvent.clientY },
          graph: canvasPosition(upEvent.clientX, upEvent.clientY),
        });
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    cancelCanvasGesture = cleanup;
  };

  const onWheel = (event: WheelEvent & { currentTarget: HTMLDivElement }) => {
    graphCanvas = event.currentTarget;
    event.preventDefault();
    const legacyEvent = event as WheelEvent & {
      readonly wheelDeltaX?: number;
      readonly wheelDeltaY?: number;
    };
    let deltaX = event.deltaX;
    let deltaY = event.deltaY;
    const isTouchpad =
      legacyEvent.wheelDeltaY !== undefined &&
      Math.abs(legacyEvent.wheelDeltaY) === Math.abs(event.deltaY) * 3;
    if (
      isTouchpad &&
      legacyEvent.wheelDeltaX !== undefined &&
      legacyEvent.wheelDeltaY !== undefined
    ) {
      deltaX = -legacyEvent.wheelDeltaX / 3;
      deltaY = -legacyEvent.wheelDeltaY / 3;
    }
    if (event.ctrlKey || event.metaKey) {
      const bounds = graphCanvas?.getBoundingClientRect();
      if (!bounds) return;
      const currentScale = canvasScale();
      const divisor = 500;
      const next = Math.min(
        2,
        Math.max(0.25, currentScale + ((isTouchpad ? 1 : -1) * deltaY) / divisor),
      );
      setCanvasScale(next);
      setCanvasOrigin(
        zoomOriginAt(canvasOrigin(), currentScale, next, {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        }),
      );
    } else {
      setCanvasOrigin((origin) => ({
        x: origin.x + deltaX / canvasScale(),
        y: origin.y + deltaY / canvasScale(),
      }));
    }
  };

  onSettled(() => {
    return () => {
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onDragEnd);
      window.removeEventListener("pointercancel", onDragEnd);
      cancelNodeDrag();
      cancelConnection();
      stopTouchGesture();
      cancelCanvasGesture();
    };
  });

  return {
    schemaForNode,
    ioForNode,
    connectedPortIds,
    visibleNodePorts,
    handlePosition,
    graphConnections,
    gridForScale,
    graphCanvas: () => graphCanvas,
    setGraphCanvas,
    canvasPosition,
    nodeMenu,
    setNodeMenu,
    presentNodeMenu,
    nodeMenuPresence,
    setNodeMenuElement,
    nodeContextMenu,
    setNodeContextMenu,
    selectionRect,
    connectionDrag,
    connectionPreview,
    createNodeFromMenu,
    startConnection,
    cancelConnection,
    onNodeMouseDown,
    selectNode,
    onCanvasPointerDown,
    onWheel,
    isDragging: () => getDragState() !== null,
    isNodeDragging: (nodeId: string) => {
      const drag = getDragState();
      return (
        drag !== null &&
        drag.graphId === selectedGraphId() &&
        drag.items.some((item) => item.nodeId === nodeId)
      );
    },
    cancelNodeDrag,
  };
}
