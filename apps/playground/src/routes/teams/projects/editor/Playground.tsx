import { BrowserSocket } from "@effect/platform-browser";
import { IoId, Package, type SchemaRef } from "@macrograph/core";
import { EditorRpc } from "@macrograph/editor";
import { ClientState as KofiClientState, KofiEngine } from "@macrograph/plugin-kofi/Definition";
import KofiSettings from "@macrograph/plugin-kofi/Settings";
import {
  ClientState as TwitchClientState,
  TwitchEngine,
} from "@macrograph/plugin-twitch/Definition";
import TwitchSettings from "@macrograph/plugin-twitch/Settings";
import { Effect, Fiber, Schedule, Schema, Stream } from "effect";
import { Rpc, RpcClient, RpcClientError, RpcSchema, RpcSerialization } from "effect/unstable/rpc";
import {
  For,
  Show,
  Loading,
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  refresh,
  untrack,
} from "solid-js";

import { LoadingState } from "../../../../LoadingState";
import { EmptyContext, Sidebar, TabLayout } from "./components/Layout";
import { NodeCreationMenu } from "./components/NodeCreationMenu";
import {
  GRAPH_NODE_FIRST_IO_Y,
  GRAPH_NODE_IO_SPACING,
  GraphNode,
  graphNodeWidth,
} from "./GraphNode";
import { RpcMethod } from "./RpcMethod";
import { createPlaygroundStore } from "./store";

const WorkspaceRpcs = EditorRpc.EditorRpcs.merge(KofiEngine.ClientRpcs, TwitchEngine.ClientRpcs);
type WorkspaceClient = RpcClient.FromGroup<typeof WorkspaceRpcs, RpcClientError.RpcClientError>;

interface PlaygroundProps {
  wsUrl: string;
  activeTab: "rpcs" | "graphs" | "plugin";
  selectedGraphId: string | undefined;
  onSelectionChange: (
    tab: "rpcs" | "graphs" | "plugin",
    graphId?: string,
    replace?: boolean,
  ) => void;
}

interface RuntimeEndpoint {
  readonly id: string;
  readonly url: string;
  readonly handlerId: string;
  readonly instanceKey: string;
  readonly metadata: unknown;
}

export function Playground(props: PlaygroundProps) {
  const isMobile = matchMedia("(max-width: 767px)").matches;
  const clientId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const [client, setClient] = createSignal<WorkspaceClient | null>(null);

  const [reconnecting, setReconnecting] = createSignal(false);
  const { store, applyEvent, updateNodePosition, setProject, setPackages } =
    createPlaygroundStore();
  const emptyPluginData = {
    endpoints: [] as ReadonlyArray<RuntimeEndpoint>,
    kofi: { webhooks: [] } as typeof KofiClientState.Type,
    twitch: {
      transport: "webhook",
      accounts: [],
    } as typeof TwitchClientState.Type,
  };
  const pluginData = createMemo(async () => {
    const c = client();
    if (c === null) return emptyPluginData;
    return Effect.runPromise(
      Effect.gen(function* () {
        const [kofiUnknown, twitchUnknown, endpoints] = yield* Effect.all([
          c.GetPluginClientState({ pluginId: "kofi" }),
          c.GetPluginClientState({ pluginId: "twitch" }),
          c.GetIngressEndpoints({}),
        ]);
        const [kofi, twitch] = yield* Effect.all([
          Schema.decodeUnknownEffect(KofiClientState)(kofiUnknown),
          Schema.decodeUnknownEffect(TwitchClientState)(twitchUnknown),
        ]);
        return { endpoints, kofi, twitch };
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Failed to load plugin settings", cause).pipe(Effect.as(emptyPluginData)),
        ),
      ),
    );
  });
  const ingressEndpoints = () => pluginData().endpoints;
  const kofiState = () => pluginData().kofi;
  const twitchState = () => pluginData().twitch;
  const [selectedGraphId, setSelectedGraphIdRaw] = createSignal<string | null>(
    untrack(() => props.selectedGraphId ?? null),
  );
  const [navSection, setNavSection] = createSignal<"graphs" | "packages" | null>(
    isMobile ? null : "graphs",
  );
  const [navSearch, setNavSearch] = createSignal("");
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = createSignal<string[]>([]);
  const [canvasScale, setCanvasScale] = createSignal(1);
  const [canvasOrigin, setCanvasOrigin] = createSignal({ x: 0, y: 0 });
  const [openGraphIds, setOpenGraphIds] = createSignal<string[]>([]);
  const [openPackageIds, setOpenPackageIds] = createSignal<string[]>([]);
  const [selectedPackageId, setSelectedPackageId] = createSignal<string | null>(null);
  const [paneZoomed, setPaneZoomed] = createSignal(false);
  const [inspectorOpen, setInspectorOpen] = createSignal(!isMobile);
  const [nodeMenu, setNodeMenu] = createSignal<{
    screen: { x: number; y: number };
    graph: { x: number; y: number };
    source?: { nodeId: string; ioId: string };
  }>();
  const [nodeContextMenu, setNodeContextMenu] = createSignal<{
    nodeId: string;
    screen: { x: number; y: number };
  }>();
  const [foldedNodeIds, setFoldedNodeIds] = createSignal<string[]>([]);
  const [selectionRect, setSelectionRect] = createSignal<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  }>();
  const [paneDomain, setPaneDomain] = createSignal<"rpcs" | "graphs" | "plugin">(
    untrack(() => props.activeTab),
  );
  createEffect(
    () => props.activeTab,
    (tab) => {
      setPaneDomain(tab);
    },
  );
  const setSelectedGraphId = (id: string | null) => {
    setPaneDomain("graphs");
    setSelectedGraphIdRaw(id);
    if (id !== null) setOpenGraphIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    props.onSelectionChange("graphs", id ?? undefined);
  };
  let fiber: any = null;

  createEffect(
    () => {
      const graphId = props.selectedGraphId;
      return {
        activeTab: props.activeTab,
        graphExists:
          graphId === undefined ||
          store.project === null ||
          store.project.graphs[graphId] !== undefined,
        graphId,
        onSelectionChange: props.onSelectionChange,
      };
    },
    ({ activeTab, graphExists, graphId, onSelectionChange }) => {
      if (graphId === undefined) {
        if (activeTab === "graphs") setSelectedGraphIdRaw(null);
        return;
      }

      setSelectedGraphIdRaw(graphId);
      setOpenGraphIds((ids) => (ids.includes(graphId) ? ids : [...ids, graphId]));
      if (!graphExists) onSelectionChange("graphs", undefined, true);
    },
  );

  onSettled(() => {
    const makeClient = Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(WorkspaceRpcs);
        setClient(client);

        yield* Effect.gen(function* () {
          const project = yield* client.GetProject({});
          setProject(project);
          const initialGraphId = props.selectedGraphId ?? Object.keys(project.graphs)[0];
          if (initialGraphId !== undefined) {
            setSelectedGraphIdRaw(initialGraphId);
            setOpenGraphIds([initialGraphId]);
            if (props.activeTab === "graphs" && props.selectedGraphId === undefined) {
              props.onSelectionChange("graphs", initialGraphId, true);
            }
          }
          const packages = yield* client.GetPackages({});
          setPackages(packages as Package.Model[]);

          setReconnecting(false);

          yield* client.ProjectEventsStream().pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event._tag === "NodePositionChanged" && event.clientId === clientId) return;
                applyEvent(event);
              }).pipe(
                Effect.andThen(
                  event._tag === "EngineStateChanged"
                    ? Effect.sync(() => refresh(pluginData))
                    : Effect.void,
                ),
              ),
            ),
          );
        }).pipe(
          Effect.tapError(() => Effect.sync(() => setReconnecting(true))),
          Effect.retry(Schedule.spaced(1000)),
        );
      }),
    ).pipe(
      Effect.provide(RpcClient.layerProtocolSocket()),
      Effect.provide([RpcSerialization.layerJsonRpc(), BrowserSocket.layerWebSocket(props.wsUrl)]),
    );

    fiber = Effect.runFork(
      makeClient.pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
    );
    return () => {
      if (fiber) {
        Effect.runFork(Fiber.interrupt(fiber));
        fiber = null;
      }
    };
  });

  const entries = () =>
    Array.from(WorkspaceRpcs.requests.entries()).sort(([a], [b]) => a.localeCompare(b)) as Array<
      [string, Rpc.AnyWithProps]
    >;

  const unary = () => entries().filter(([, rpc]) => !RpcSchema.isStreamSchema(rpc.successSchema));
  const streaming = () =>
    entries().filter(([, rpc]) => RpcSchema.isStreamSchema(rpc.successSchema));

  const graphs = () => {
    if (!store.project) return [];
    return Object.entries(store.project.graphs).sort(([a], [b]) => a.localeCompare(b));
  };

  const selectedGraph = () => {
    const id = selectedGraphId();
    if (!id || !store.project) return null;
    return store.project.graphs[id] ?? null;
  };

  const nodes = () => {
    const graph = selectedGraph();
    if (!graph) return [];
    return Object.values(graph.nodes);
  };

  const selectedNode = () => {
    const id = selectedNodeId();
    return id ? (selectedGraph()?.nodes[id] ?? null) : null;
  };

  const filteredGraphs = () => {
    const query = navSearch().trim().toLowerCase();
    return query.length === 0
      ? graphs()
      : graphs().filter(([, graph]) => graph.name.toLowerCase().includes(query));
  };

  const filteredPackages = () => {
    const query = navSearch().trim().toLowerCase();
    return query.length === 0
      ? store.packages
      : store.packages.filter((pkg) => pkg.name.toLowerCase().includes(query));
  };

  const schemaForNode = (node: { schema: { package: string; schema: string } }) =>
    store.packages
      .find((pkg) => pkg.id === node.schema.package)
      ?.schemas.find((schema) => schema.id === node.schema.schema);

  const handlePosition = (nodeId: string, ioId: string, direction: "input" | "output") => {
    const graph = selectedGraph();
    const node = graph?.nodes[nodeId];
    if (!node) return undefined;
    const schema = schemaForNode(node);
    const ports = direction === "input" ? schema?.executionInputs : schema?.executionOutputs;
    const index = ports?.findIndex((port) => port.id === ioId) ?? -1;
    if (index < 0) return undefined;
    return {
      x: node.position.x + (direction === "output" ? graphNodeWidth(schema, node.name) : 0),
      y: node.position.y + GRAPH_NODE_FIRST_IO_Y + index * GRAPH_NODE_IO_SPACING,
    };
  };

  const pathFor = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const control = Math.min(180, Math.max(60, Math.abs(to.x - from.x) / 2));
    return `M ${from.x} ${from.y} C ${from.x + control} ${from.y}, ${to.x - control} ${to.y}, ${to.x} ${to.y}`;
  };

  const execConnections = () => {
    const graph = selectedGraph();
    if (!graph) return [];
    return graph.connections.flatMap((connection) => {
      const from = handlePosition(connection.outNodeId, connection.outIoId, "output");
      const to = handlePosition(connection.inNodeId, connection.inIoId, "input");
      return from && to ? [{ connection, from, to }] : [];
    });
  };

  type ExecConnectionDrag = {
    readonly nodeId: string;
    readonly ioId: string;
    readonly from: { x: number; y: number };
    readonly to: { x: number; y: number };
  };
  const [execConnectionDrag, setExecConnectionDrag] = createSignal<ExecConnectionDrag>();
  let graphCanvas: HTMLDivElement | undefined;

  const canvasPosition = (clientX: number, clientY: number) => {
    const bounds = graphCanvas?.getBoundingClientRect();
    if (!bounds) return { x: clientX, y: clientY };
    return {
      x: (clientX - bounds.left) / canvasScale() + canvasOrigin().x,
      y: (clientY - bounds.top) / canvasScale() + canvasOrigin().y,
    };
  };

  const onExecConnectionMove = (event: PointerEvent) => {
    setExecConnectionDrag((current) =>
      current ? { ...current, to: canvasPosition(event.clientX, event.clientY) } : current,
    );
  };

  const endExecConnection = (event: PointerEvent) => {
    const drag = execConnectionDrag();
    setExecConnectionDrag(undefined);
    window.removeEventListener("pointermove", onExecConnectionMove);
    window.removeEventListener("pointerup", endExecConnection);
    window.removeEventListener("pointercancel", endExecConnection);
    if (!drag) return;

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-exec-input='true']");
    const inNodeId = target?.dataset.nodeId;
    const inIoId = target?.dataset.ioId;
    const graphId = selectedGraphId();
    const c = client();
    if (!c || !graphId) return;
    if (!inNodeId || !inIoId) {
      setNodeMenu({
        screen: { x: event.clientX, y: event.clientY },
        graph: canvasPosition(event.clientX, event.clientY),
        source: { nodeId: drag.nodeId, ioId: drag.ioId },
      });
      return;
    }
    if (inNodeId === drag.nodeId) return;

    Effect.runFork(
      c
        .CreateConnection({
          graphId,
          connection: {
            outNodeId: drag.nodeId,
            outIoId: IoId.make(drag.ioId),
            inNodeId,
            inIoId: IoId.make(inIoId),
          },
        })
        .pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
    );
  };

  const startExecConnection = (event: PointerEvent, nodeId: string, ioId: string) => {
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    const bounds = handle.getBoundingClientRect();
    const from = canvasPosition(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    setExecConnectionDrag({
      nodeId,
      ioId,
      from,
      to: canvasPosition(event.clientX, event.clientY),
    });
    window.addEventListener("pointermove", onExecConnectionMove);
    window.addEventListener("pointerup", endExecConnection);
    window.addEventListener("pointercancel", endExecConnection);
  };

  let dragState: {
    graphId: string;
    startClientX: number;
    startClientY: number;
    items: Array<{ nodeId: string; origX: number; origY: number }>;
    lastSend: number;
    pending: Array<{ nodeId: string; x: number; y: number }> | null;
  } | null = null;

  const sendEphemeral = (graphId: string, nodeId: string, x: number, y: number) => {
    const c = client();
    if (!c) return;
    Effect.runFork(
      c
        .SetNodePosition({ graphId, nodeId, x, y, ephemeral: true, clientId })
        .pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
    );
  };

  const deleteNode = (nodeId: string) => {
    const c = client();
    const graphId = selectedGraphId();
    if (!c || !graphId) return;
    Effect.runFork(
      c
        .DeleteNode({ graphId, nodeId })
        .pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
    );
    setSelectedNodeIds((ids) => ids.filter((id) => id !== nodeId));
    if (selectedNodeId() === nodeId) setSelectedNodeId(null);
  };

  const createGraph = () => {
    const c = client();
    if (!c) return;
    Effect.runFork(
      c.CreateGraph({ graph: {} }).pipe(
        Effect.tap((event) =>
          Effect.sync(() => {
            setSelectedGraphId(event.graph.id);
            setSelectedNodeId(null);
          }),
        ),
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };

  const createNode = (
    schema: SchemaRef,
    name: string,
    position: { x: number; y: number },
    source?: { nodeId: string; ioId: string },
  ) => {
    const c = client();
    const graphId = selectedGraphId();
    if (!c || !graphId) return;
    Effect.runFork(
      c.CreateNode({ graphId, node: { name, schema, position } }).pipe(
        Effect.tap((event) => {
          const input = store.packages
            .find((pkg) => pkg.id === schema.package)
            ?.schemas.find((candidate) => candidate.id === schema.schema)?.executionInputs[0];
          return source && input
            ? c.CreateConnection({
                graphId,
                connection: {
                  outNodeId: source.nodeId,
                  outIoId: IoId.make(source.ioId),
                  inNodeId: event.node.id,
                  inIoId: input.id,
                },
              })
            : Effect.void;
        }),
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };

  const renameNode = (name: string) => {
    const c = client();
    const graphId = selectedGraphId();
    const nodeId = selectedNodeId();
    if (!c || !graphId || !nodeId || name.trim().length === 0) return;
    Effect.runFork(
      c
        .SetNodeName({ graphId, nodeId, name: name.trim() })
        .pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
    );
  };

  const disconnectIo = (direction: "input" | "output", nodeId: string, ioId: string) => {
    const c = client();
    const graph = selectedGraph();
    const graphId = selectedGraphId();
    if (!c || !graph || !graphId) return;
    const connection = graph.connections.find((candidate) =>
      direction === "input"
        ? candidate.inNodeId === nodeId && candidate.inIoId === ioId
        : candidate.outNodeId === nodeId && candidate.outIoId === ioId,
    );
    if (!connection) return;
    Effect.runFork(
      c
        .DeleteConnection({ graphId, connectionId: connection.id })
        .pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
    );
  };

  const onDragMove = (e: PointerEvent) => {
    if (!dragState) return;
    const dx = (e.clientX - dragState.startClientX) / canvasScale();
    const dy = (e.clientY - dragState.startClientY) / canvasScale();
    const positions = dragState.items.map((item) => ({
      nodeId: item.nodeId,
      x: item.origX + dx,
      y: item.origY + dy,
    }));
    for (const position of positions) {
      updateNodePosition(dragState.graphId, position.nodeId, position.x, position.y);
    }
    const now = performance.now();
    if (now - dragState.lastSend >= 33) {
      dragState.lastSend = now;
      dragState.pending = null;
      for (const position of positions) {
        sendEphemeral(dragState.graphId, position.nodeId, position.x, position.y);
      }
    } else {
      dragState.pending = positions;
    }
  };

  const flushPending = () => {
    if (!dragState || !dragState.pending) return;
    const positions = dragState.pending;
    dragState.pending = null;
    dragState.lastSend = performance.now();
    for (const position of positions) {
      sendEphemeral(dragState.graphId, position.nodeId, position.x, position.y);
    }
  };

  const onDragEnd = (e: PointerEvent) => {
    if (!dragState) return;
    flushPending();
    const ds = dragState;
    dragState = null;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    const dx = (e.clientX - ds.startClientX) / canvasScale();
    const dy = (e.clientY - ds.startClientY) / canvasScale();
    const c = client();
    if (c) {
      for (const item of ds.items) {
        Effect.runFork(
          c
            .SetNodePosition({
              graphId: ds.graphId,
              nodeId: item.nodeId,
              x: item.origX + dx,
              y: item.origY + dy,
            })
            .pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
        );
      }
    }
  };

  const onNodeMouseDown = (
    e: PointerEvent,
    node: { id: string; position: { x: number; y: number } },
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const graphId = selectedGraphId();
    if (!graphId) return;
    const graph = selectedGraph();
    const ids = selectedNodeIds().includes(node.id) ? selectedNodeIds() : [node.id];
    if (!selectedNodeIds().includes(node.id)) {
      setSelectedNodeIds([node.id]);
      setSelectedNodeId(node.id);
    }
    dragState = {
      graphId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      items: ids.flatMap((id) => {
        const item = graph?.nodes[id];
        return item ? [{ nodeId: id, origX: item.position.x, origY: item.position.y }] : [];
      }),
      lastSend: performance.now(),
      pending: null,
    };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
  };

  const selectNode = (nodeId: string, additive: boolean) => {
    if (!additive) {
      setSelectedNodeIds([nodeId]);
      setSelectedNodeId(nodeId);
      return;
    }
    setSelectedNodeIds((ids) => {
      const next = ids.includes(nodeId) ? ids.filter((id) => id !== nodeId) : [...ids, nodeId];
      setSelectedNodeId(next.at(-1) ?? null);
      return next;
    });
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
        const schema = schemaForNode(node);
        const width = graphNodeWidth(schema, node.name);
        const height =
          38 +
          Math.max(schema?.executionInputs.length ?? 0, schema?.executionOutputs.length ?? 0) *
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
    setSelectedNodeId(next.at(-1) ?? null);
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
      const anchor = {
        x: twoTouchStart.origin.x + startMidpoint.x / twoTouchStart.scale,
        y: twoTouchStart.origin.y + startMidpoint.y / twoTouchStart.scale,
      };
      setCanvasScale(nextScale);
      setCanvasOrigin({
        x: anchor.x - currentMidpoint.x / nextScale,
        y: anchor.y - currentMidpoint.y / nextScale,
      });
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
    setSelectedNodeId(null);
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

  const onCanvasPointerDown = (event: PointerEvent) => {
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

    if (event.button === 0) {
      if (!additive) {
        setSelectedNodeIds([]);
        setSelectedNodeId(null);
      }
      setSelectionRect({ start: startScreen, current: startScreen });
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

      setSelectionRect({
        start: startScreen,
        current: { x: moveEvent.clientX, y: moveEvent.clientY },
      });
      selectNodesInArea(
        startGraph,
        canvasPosition(moveEvent.clientX, moveEvent.clientY),
        additive,
      );
    };

    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setSelectionRect(undefined);
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
  };

  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && paneZoomed()) {
        setPaneZoomed(false);
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return;
      for (const nodeId of selectedNodeIds()) deleteNode(nodeId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onDragEnd);
      window.removeEventListener("pointermove", onExecConnectionMove);
      window.removeEventListener("pointerup", endExecConnection);
      window.removeEventListener("pointercancel", endExecConnection);
      stopTouchGesture();
    };
  });

  const paneTabs = () => {
    const graphTabs = openGraphIds().flatMap((id) => {
      const graph = store.project?.graphs[id];
      return graph ? [{ id: `graph:${id}`, title: graph.name }] : [];
    });
    const packageTabs = openPackageIds().flatMap((id) => {
      const pkg = store.packages.find((candidate) => candidate.id === id);
      return pkg ? [{ id: `package:${id}`, title: pkg.name, description: "Plugin" }] : [];
    });
    const utilityTabs = props.activeTab === "rpcs" ? [{ id: "developer", title: "Developer" }] : [];
    return [...graphTabs, ...packageTabs, ...utilityTabs];
  };

  const selectedPaneId = () => {
    if (paneDomain() === "graphs")
      return selectedGraphId() ? `graph:${selectedGraphId()}` : undefined;
    if (paneDomain() === "rpcs") return "developer";
    return selectedPackageId() ? `package:${selectedPackageId()}` : undefined;
  };

  const selectPane = (id: string) => {
    if (id.startsWith("graph:")) {
      setSelectedGraphId(id.slice("graph:".length));
      return;
    }
    if (id.startsWith("package:")) {
      setPaneDomain("plugin");
      setSelectedPackageId(id.slice("package:".length));
      props.onSelectionChange("plugin");
      return;
    }
    if (id === "developer") {
      setPaneDomain("rpcs");
      props.onSelectionChange("rpcs");
    }
  };

  const closePane = (id: string) => {
    if (id.startsWith("graph:")) {
      const graphId = id.slice("graph:".length);
      const remaining = openGraphIds().filter((candidate) => candidate !== graphId);
      setOpenGraphIds(remaining);
      if (selectedGraphId() === graphId) setSelectedGraphId(remaining.at(-1) ?? null);
      return;
    }
    if (id.startsWith("package:")) {
      const packageId = id.slice("package:".length);
      setOpenPackageIds((ids) => ids.filter((candidate) => candidate !== packageId));
      if (selectedPackageId() === packageId) setSelectedPackageId(null);
      return;
    }
    const graphId = openGraphIds().at(-1);
    if (graphId) setSelectedGraphId(graphId);
  };

  const editorReady = () => client() !== null && store.project !== null;

  return (
    <div class="dark dark-theme relative flex h-full w-full flex-col overflow-hidden bg-gray-2 text-sm text-gray-12 [color-scheme:dark] *:cursor-default *:select-none">
      <div
        class={`absolute inset-0 z-50 grid place-items-center bg-gray-2 transition-opacity duration-100 ${
          editorReady() ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-hidden={editorReady() ? "true" : "false"}
      >
        <span class="text-xs text-gray-11">
          {client() === null ? "Connecting to editor" : "Loading project"}
        </span>
      </div>
      <div
        class={`flex h-full min-h-0 flex-col divide-y divide-gray-5 transition-opacity duration-100 ${
          editorReady() ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <Show when={reconnecting()}>
          <div class="bg-amber-9 px-3 py-1.5 text-center text-xs font-medium text-black">
            Reconnecting...
          </div>
        </Show>

        <Show
          when={client()}
          fallback={<LoadingState label="Connecting to editor" class="flex-1" />}
        >
          <div class="relative flex min-h-0 flex-1">
            <Sidebar
              side="left"
              open={navSection() !== null && !paneZoomed()}
              onClose={() => setNavSection(null)}
            >
              <div class="shrink-0">
                <div class="flex h-8 flex-row items-stretch divide-x divide-gray-5">
                  <For each={["graphs", "packages"] as const}>
                    {(section) => (
                      <button
                        type="button"
                        class={`focus-ring flex-1 border-b text-xs font-medium transition-colors ${
                          navSection() === section
                            ? "border-b-transparent bg-gray-2 text-gray-12"
                            : "border-b-gray-5 bg-transparent text-gray-10 hover:text-gray-12"
                        }`}
                        aria-pressed={navSection() === section ? "true" : "false"}
                        onClick={() => setNavSection(section)}
                      >
                        {section === "graphs" ? "Graphs" : "Plugins"}
                      </button>
                    )}
                  </For>
                </div>
                <div class="flex h-8 flex-row items-stretch bg-gray-2">
                  <div class="group/search flex min-w-0 flex-1 flex-row items-stretch">
                    <IconTablerSearch class="my-auto ml-2 size-3.5 shrink-0 text-gray-9 transition-colors group-focus-within/search:text-mg-focus" />
                    <input
                      class="h-full min-w-0 flex-1 bg-transparent px-1.5 text-xs outline-none placeholder:text-gray-9"
                      placeholder={navSection() === "graphs" ? "Search Graphs" : "Search Plugins"}
                      value={navSearch()}
                      onInput={(event) => setNavSearch(event.currentTarget.value)}
                    />
                  </div>
                  <Show when={navSection() === "graphs"}>
                    <button
                      type="button"
                      class="focus-ring h-full shrink-0 bg-transparent px-2 text-xs font-medium text-gray-11 hover:text-gray-12"
                      onClick={createGraph}
                    >
                      New
                    </button>
                  </Show>
                </div>
              </div>
              <div class="min-h-0 flex-1 overflow-y-auto">
                <Show when={navSection() === "graphs"}>
                  <For each={filteredGraphs()}>
                    {([id, graph]) => (
                      <button
                        class={`focus-ring block w-full p-1 px-2 text-left text-xs ${
                          selectedPaneId() === `graph:${id}`
                            ? "bg-gray-2"
                            : "bg-transparent hover:bg-gray-2"
                        }`}
                        onClick={() => {
                          setSelectedGraphId(id);
                          setSelectedNodeId(null);
                        }}
                      >
                        {graph.name}
                      </button>
                    )}
                  </For>
                </Show>
                <Show when={navSection() === "packages"}>
                  <For each={filteredPackages()}>
                    {(pkg) => (
                      <button
                        type="button"
                        class={`focus-ring block w-full p-1 px-2 text-left text-xs ${
                          selectedPaneId() === `package:${pkg.id}`
                            ? "bg-gray-2"
                            : "bg-transparent hover:bg-gray-2"
                        }`}
                        onClick={() => {
                          setPaneDomain("plugin");
                          setSelectedPackageId(pkg.id);
                          setOpenPackageIds((ids) =>
                            ids.includes(pkg.id) ? ids : [...ids, pkg.id],
                          );
                          props.onSelectionChange("plugin");
                        }}
                      >
                        {pkg.name}
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Sidebar>

            <Show when={navSection() === null && !paneZoomed()}>
              <button
                type="button"
                class="focus-ring absolute left-2 top-2 z-20 rounded-full border border-gray-6 bg-gray-3 px-2.5 py-1 text-[11px] font-medium text-gray-12 shadow-md md:hidden"
                onClick={() => {
                  setInspectorOpen(false);
                  setNavSection("graphs");
                }}
              >
                Browse
              </button>
            </Show>

            <main
              class={`flex min-w-0 flex-1 bg-gray-2 ${
                paneZoomed() ? "absolute inset-0 z-30 m-2 border border-gray-5" : ""
              }`}
            >
              <TabLayout
                tabs={paneTabs()}
                selectedId={selectedPaneId()}
                onSelect={selectPane}
                onClose={closePane}
                zoomed={paneZoomed()}
                onZoom={() => setPaneZoomed((value) => !value)}
              >
                <Show when={props.activeTab === "graphs"}>
                  <div class="flex h-full min-h-0 flex-col">
                    <div
                      ref={graphCanvas}
                      class="relative flex min-h-0 flex-1 touch-none flex-col items-start overflow-hidden bg-gray-2"
                      onWheel={(event) => {
                        event.preventDefault();
                        if (event.ctrlKey || event.metaKey) {
                          const before = canvasPosition(event.clientX, event.clientY);
                          const bounds = graphCanvas?.getBoundingClientRect();
                          if (!bounds) return;
                          const next = Math.min(
                            2,
                            Math.max(0.25, canvasScale() * (event.deltaY < 0 ? 1.1 : 0.9)),
                          );
                          setCanvasScale(next);
                          setCanvasOrigin({
                            x: before.x - (event.clientX - bounds.left) / next,
                            y: before.y - (event.clientY - bounds.top) / next,
                          });
                        } else {
                          setCanvasOrigin((origin) => ({
                            x: origin.x + event.deltaX / canvasScale(),
                            y: origin.y + event.deltaY / canvasScale(),
                          }));
                        }
                      }}
                      onPointerDown={onCanvasPointerDown}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      <Show
                        when={selectedGraph()}
                        fallback={
                          <div class="grid h-full w-full flex-1 place-items-center text-xs text-gray-11">
                            {graphs().length === 0 ? "Create a graph to begin" : "Select a graph"}
                          </div>
                        }
                      >
                        <div
                          class="absolute inset-0 h-full w-full origin-top-left"
                          style={{ transform: `scale(${canvasScale()})` }}
                        >
                          <div
                            class="absolute inset-0 h-full w-full"
                            style={{
                              transform: `translate(${-canvasOrigin().x}px, ${-canvasOrigin().y}px)`,
                            }}
                          >
                            <svg
                              class="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                              aria-hidden="true"
                            >
                              <For each={execConnections()}>
                                {(edge) => (
                                  <path
                                    d={pathFor(edge.from, edge.to)}
                                    fill="none"
                                    stroke="white"
                                    stroke-width="2"
                                    opacity="0.75"
                                  />
                                )}
                              </For>
                              <Show when={execConnectionDrag()} keyed>
                                {(drag) => (
                                  <path
                                    d={pathFor(drag.from, drag.to)}
                                    fill="none"
                                    stroke="white"
                                    stroke-width="2"
                                    opacity="0.375"
                                  />
                                )}
                              </Show>
                            </svg>
                            <For each={nodes()}>
                              {(node) => (
                                <GraphNode
                                  node={node}
                                  schema={schemaForNode(node)}
                                  selected={selectedNodeIds().includes(node.id)}
                                  folded={foldedNodeIds().includes(node.id)}
                                  pendingOutput={execConnectionDrag()}
                                  onSelect={selectNode}
                                  onDragStart={onNodeMouseDown}
                                  onExecOutputPointerDown={startExecConnection}
                                  onDisconnect={disconnectIo}
                                  onContextMenu={(event, nodeId) => {
                                    selectNode(nodeId, false);
                                    setNodeContextMenu({
                                      nodeId,
                                      screen: { x: event.clientX, y: event.clientY },
                                    });
                                  }}
                                  onExpand={(nodeId) =>
                                    setFoldedNodeIds((ids) => ids.filter((id) => id !== nodeId))
                                  }
                                />
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                      <Show when={selectionRect()}>
                        {(rect) => {
                          const bounds = () => graphCanvas?.getBoundingClientRect();
                          return (
                            <div
                              class="pointer-events-none absolute left-0 top-0 border border-yellow-500 bg-yellow-500/10"
                              style={{
                                width: `${Math.abs(rect().current.x - rect().start.x)}px`,
                                height: `${Math.abs(rect().current.y - rect().start.y)}px`,
                                transform: `translate(${Math.min(rect().start.x, rect().current.x) - (bounds()?.left ?? 0)}px, ${Math.min(rect().start.y, rect().current.y) - (bounds()?.top ?? 0)}px)`,
                              }}
                            />
                          );
                        }}
                      </Show>
                      <Show when={nodeMenu()}>
                        {(menu) => (
                          <NodeCreationMenu
                            packages={store.packages}
                            screenPosition={menu().screen}
                            onClose={() => setNodeMenu(undefined)}
                            onCreate={(schema, name) =>
                              createNode(schema, name, menu().graph, menu().source)
                            }
                          />
                        )}
                      </Show>
                      <Show when={nodeContextMenu()}>
                        {(menu) => (
                          <div
                            class="fixed z-50 flex min-w-40 flex-col rounded-lg border border-gray-3 bg-gray-1 p-1 text-sm outline-none"
                            style={{ left: `${menu().screen.x}px`, top: `${menu().screen.y}px` }}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              class="focus-ring w-full rounded bg-transparent p-1 text-left hover:bg-gray-12/10"
                              onClick={() => {
                                setFoldedNodeIds((ids) =>
                                  ids.includes(menu().nodeId)
                                    ? ids.filter((id) => id !== menu().nodeId)
                                    : [...ids, menu().nodeId],
                                );
                                setNodeContextMenu(undefined);
                              }}
                            >
                              {foldedNodeIds().includes(menu().nodeId) ? "Expand" : "Collapse"}
                            </button>
                            <button
                              type="button"
                              class="focus-ring w-full rounded bg-transparent p-1 text-left hover:bg-gray-12/10"
                              onClick={() => {
                                for (const nodeId of selectedNodeIds()) deleteNode(nodeId);
                                setNodeContextMenu(undefined);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </Show>
                    </div>
                  </div>
                </Show>

                <Show when={props.activeTab === "rpcs"}>
                  <div class="h-full overflow-y-auto bg-gray-2 p-4">
                    <div class="mx-auto max-w-[48rem] space-y-2">
                      <h2 class="mb-4 text-sm font-semibold">Developer RPC console</h2>
                      <For each={unary()}>
                        {([tag, rpc]) => (
                          <RpcMethod
                            tag={tag}
                            rpc={rpc}
                            client={client()}
                            packages={store.packages}
                          />
                        )}
                      </For>
                      <For each={streaming()}>
                        {([tag, rpc]) => (
                          <RpcMethod
                            tag={tag}
                            rpc={rpc}
                            client={client()}
                            packages={store.packages}
                          />
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={props.activeTab === "plugin"}>
                  <Show
                    when={store.packages.find((pkg) => pkg.id === selectedPackageId())}
                    fallback={<EmptyContext />}
                  >
                    {(pkg) => (
                      <div class="h-full overflow-y-auto bg-gray-2">
                        <Loading
                          fallback={<LoadingState label="Loading plugin settings" class="h-full" />}
                        >
                          <div class="flex w-full max-w-[56rem] flex-col items-stretch gap-6 p-4">
                            <Show when={pkg().id === "kofi"}>
                              <KofiSettings
                                state={kofiState()}
                                endpoints={ingressEndpoints()}
                                rpc={client()!}
                                onChanged={() => Promise.resolve(refresh(pluginData))}
                              />
                            </Show>
                            <Show when={pkg().id === "twitch"}>
                              <TwitchSettings
                                state={twitchState()}
                                rpc={client()!}
                                onChanged={() => Promise.resolve(refresh(pluginData))}
                              />
                            </Show>
                            <Show when={pkg().id !== "kofi" && pkg().id !== "twitch"}>
                              <div>
                                <h2 class="font-medium text-gray-12">{pkg().name}</h2>
                                <p class="mt-1 text-xs text-gray-11">
                                  This plugin has no configurable editor settings.
                                </p>
                              </div>
                            </Show>
                          </div>
                        </Loading>
                      </div>
                    )}
                  </Show>
                </Show>
              </TabLayout>
            </main>

            <Show
              when={
                props.activeTab === "graphs" &&
                selectedGraph() &&
                !inspectorOpen() &&
                !paneZoomed()
              }
            >
              <button
                type="button"
                class="focus-ring absolute right-2 top-2 z-20 rounded-full border border-gray-6 bg-gray-3 px-2.5 py-1 text-[11px] font-medium text-gray-12 shadow-md md:hidden"
                onClick={() => {
                  setNavSection(null);
                  setInspectorOpen(true);
                }}
              >
                Inspect
              </button>
            </Show>

            <Show when={props.activeTab === "graphs" && selectedGraph()}>
              <Sidebar
                side="right"
                open={inspectorOpen() && !paneZoomed()}
                onClose={() => setInspectorOpen(false)}
              >
                <Show
                  when={selectedNode()}
                  fallback={
                    <Show when={selectedGraph()} fallback={<EmptyContext />}>
                      {(graph) => (
                        <div class="flex flex-col items-stretch gap-1.5 p-2">
                          <span class="text-xs font-semibold text-gray-12">Graph Info</span>
                          <div class="flex flex-col gap-0.5">
                            <span class="text-[11px] font-medium text-gray-11">Name</span>
                            <span class="text-xs text-gray-12">{graph().name}</span>
                          </div>
                          <div class="flex flex-col gap-0.5">
                            <span class="text-[11px] font-medium text-gray-11">Total Nodes</span>
                            <span class="text-xs text-gray-12">
                              {Object.keys(graph().nodes).length}
                            </span>
                          </div>
                        </div>
                      )}
                    </Show>
                  }
                >
                  {(node) => {
                    const schema = () => schemaForNode(node());
                    const pkg = () =>
                      store.packages.find((candidate) => candidate.id === node().schema.package);
                    return (
                      <div class="flex flex-col items-stretch gap-1.5 p-2">
                        <span class="text-xs font-semibold text-gray-12">Node Info</span>
                        <div class="flex flex-col gap-0.5">
                          <span class="text-[11px] font-medium text-gray-11">Name</span>
                          <input
                            class="focus-ring h-6 rounded-sm bg-gray-2 px-1 text-xs ring-1 ring-gray-6"
                            value={node().name}
                            onChange={(event) => renameNode(event.currentTarget.value)}
                          />
                        </div>
                        <Show when={schema()}>
                          {(schema) => (
                            <div class="mt-1 flex flex-col">
                              <span class="mb-1 block text-[11px] font-medium text-gray-11">
                                Schema
                              </span>
                              <div class="flex h-9 items-center overflow-hidden rounded-sm border border-gray-6">
                                <div
                                  class={`h-full w-1.5 ${
                                    schema().type === "event"
                                      ? "bg-red-700"
                                      : schema().type === "exec"
                                        ? "bg-blue-600"
                                        : "bg-emerald-700"
                                  }`}
                                />
                                <div class="min-w-0 flex-1 px-1">
                                  <span class="block truncate text-xs font-medium text-gray-12">
                                    {schema().name}
                                  </span>
                                  <span class="block truncate text-xs text-gray-11">
                                    {pkg()?.name ?? "Unknown Plugin"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </Show>
                      </div>
                    );
                  }}
                </Show>
              </Sidebar>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
