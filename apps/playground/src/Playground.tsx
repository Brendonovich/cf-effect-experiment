import { BrowserSocket } from "@effect/platform-browser";
import { Package } from "@macrograph/core";
import { EditorRpc } from "@macrograph/editor";
import { Effect, Fiber, Schedule, Stream } from "effect";
import { Rpc, RpcClient, RpcSchema, RpcSerialization } from "effect/unstable/rpc";
import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";

import { CreateGraphPopover } from "./CreateGraphPopover";
import { CreateNodePopover } from "./CreateNodePopover";
import { EventLog } from "./EventLog";
import { GraphNode } from "./GraphNode";
import { RpcMethod } from "./RpcMethod";
import { createPlaygroundStore } from "./store";

interface PlaygroundProps {
  group: { readonly requests: ReadonlyMap<string, Rpc.Any> };
  wsUrl: string;
}

function tabClass(active: boolean): string {
  const base = "px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors";
  return active
    ? `${base} text-blue-700 border-b-2 border-blue-500 bg-white`
    : `${base} text-gray-500 hover:text-gray-700`;
}

function graphTabClass(active: boolean): string {
  const base = "px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors";
  return active
    ? `${base} text-blue-700 border-b-2 border-blue-500 bg-white`
    : `${base} text-gray-500 hover:text-gray-700`;
}

export const Playground: Component<PlaygroundProps> = (props) => {
  const clientId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const [client, setClient] = createSignal<any>(null);
  const [reconnecting, setReconnecting] = createSignal(false);
  const { store, applyEvent, updateNodePosition, setProject, setPackages } =
    createPlaygroundStore();
  const [activeTab, setActiveTab] = createSignal<"rpcs" | "graphs">(
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem("playground:activeTab") as "rpcs" | "graphs" | null)) ||
      "rpcs",
  );
  createEffect(() => {
    localStorage.setItem("playground:activeTab", activeTab());
  });

  const [selectedGraphId, setSelectedGraphIdRaw] = createSignal<string | null>(
    typeof localStorage !== "undefined" ? localStorage.getItem("playground:selectedGraphId") : null,
  );
  const setSelectedGraphId = (id: string | null) => {
    setSelectedGraphIdRaw(id);
    if (typeof localStorage !== "undefined") {
      if (id) localStorage.setItem("playground:selectedGraphId", id);
      else localStorage.removeItem("playground:selectedGraphId");
    }
  };
  let fiber: any = null;

  onMount(() => {
    const makeClient = Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(EditorRpc.EditorRpcs);
        setClient(client);

        yield* Effect.gen(function* () {
          const project = yield* client.GetProject({});
          setProject(project);

          const packages = yield* client.GetPackages({});
          setPackages(packages as Package.Model[]);

          setReconnecting(false);

          yield* client.ProjectEventsStream().pipe(
            Stream.runForEach((event) =>
              Effect.sync(() => {
                if (event._tag === "NodePositionChanged" && event.clientId === clientId) return;
                applyEvent(event);
              }),
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
  });

  onCleanup(() => {
    if (fiber) {
      Effect.runFork(Fiber.interrupt(fiber));
      fiber = null;
    }
  });

  const entries = () =>
    Array.from(props.group.requests.entries()).sort(([a], [b]) => a.localeCompare(b)) as Array<
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

  let dragState: {
    nodeId: string;
    graphId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    lastSend: number;
    pending: { x: number; y: number } | null;
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
  };

  const onDragMove = (e: MouseEvent) => {
    if (!dragState) return;
    const x = dragState.origX + (e.clientX - dragState.startClientX);
    const y = dragState.origY + (e.clientY - dragState.startClientY);
    updateNodePosition(dragState.graphId, dragState.nodeId, x, y);
    const now = performance.now();
    if (now - dragState.lastSend >= 33) {
      dragState.lastSend = now;
      dragState.pending = null;
      sendEphemeral(dragState.graphId, dragState.nodeId, x, y);
    } else {
      dragState.pending = { x, y };
    }
  };

  const flushPending = () => {
    if (!dragState || !dragState.pending) return;
    const { x, y } = dragState.pending;
    dragState.pending = null;
    dragState.lastSend = performance.now();
    sendEphemeral(dragState.graphId, dragState.nodeId, x, y);
  };

  const onDragEnd = (e: MouseEvent) => {
    if (!dragState) return;
    flushPending();
    const ds = dragState;
    dragState = null;
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    const x = ds.origX + (e.clientX - ds.startClientX);
    const y = ds.origY + (e.clientY - ds.startClientY);
    const c = client();
    if (c) {
      Effect.runFork(
        c
          .SetNodePosition({ graphId: ds.graphId, nodeId: ds.nodeId, x, y })
          .pipe(Effect.tapError(Effect.log), Effect.tapDefect(Effect.log)),
      );
    }
  };

  const onNodeMouseDown = (
    e: MouseEvent,
    node: { id: string; position: { x: number; y: number } },
  ) => {
    e.preventDefault();
    const graphId = selectedGraphId();
    if (!graphId) return;
    dragState = {
      nodeId: node.id,
      graphId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: node.position.x,
      origY: node.position.y,
      lastSend: performance.now(),
      pending: null,
    };
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
  };

  onCleanup(() => {
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
  });

  return (
    <div class="h-screen w-screen flex overflow-hidden bg-white text-sm">
      <div class="w-full flex flex-col">
        <div class="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div>
            <h1 class="text-lg font-bold text-gray-900">Macrograph Playground</h1>
            <p class="text-xs text-gray-500 font-mono">{props.wsUrl}</p>
          </div>
          <span
            class={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              reconnecting() ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-800"
            }`}
          >
            {reconnecting() ? "Reconnecting" : "WebSocket"}
          </span>
        </div>

        <div class="flex border-b border-gray-200 bg-gray-50 shrink-0">
          <button onClick={() => setActiveTab("rpcs")} class={tabClass(activeTab() === "rpcs")}>
            RPCs
          </button>
          <button onClick={() => setActiveTab("graphs")} class={tabClass(activeTab() === "graphs")}>
            Graphs
          </button>
        </div>

        <div class="flex-1 overflow-y-auto">
          <Show when={client()} fallback={<div class="p-4 text-gray-400">Connecting...</div>}>
            <div class="h-full">
              <Show when={activeTab() === "rpcs"}>
                <div class="p-4 space-y-2">
                  <For each={unary()}>
                    {([tag, rpc]) => (
                      <RpcMethod tag={tag} rpc={rpc} client={client()} packages={store.packages} />
                    )}
                  </For>
                  <Show when={streaming().length > 0}>
                    <div class="mt-6 pt-4 border-t border-gray-200">
                      <h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                        Streaming RPCs
                      </h2>
                      <div class="space-y-2">
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
                </div>
              </Show>

              <Show when={activeTab() === "graphs"}>
                <div class="flex flex-col h-full">
                  {/* Toolbar */}
                  <div class="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
                    <span class="text-xs text-gray-500">
                      {graphs().length} graph{graphs().length !== 1 ? "s" : ""}
                    </span>
                    <Show when={client()}>
                      <CreateGraphPopover client={client()} />
                    </Show>
                  </div>

                  {/* Graph tabs */}
                  <div class="flex overflow-x-auto border-b border-gray-200 bg-gray-50 shrink-0">
                    <Show when={graphs().length === 0}>
                      <div class="px-4 py-2 text-xs text-gray-400 italic">
                        No graphs yet. Create one via the button above.
                      </div>
                    </Show>
                    <For each={graphs()}>
                      {([id, graph]) => (
                        <button
                          onClick={() => setSelectedGraphId(id)}
                          class={graphTabClass(selectedGraphId() === id)}
                        >
                          <Show
                            when={graph.name}
                            fallback={<pre class="text-gray-400 font-mono">{graph.id}</pre>}
                          >
                            {graph.name}
                          </Show>
                        </button>
                      )}
                    </For>
                  </div>

                  {/* Graph toolbar */}
                  <Show when={selectedGraph()}>
                    {(graph) => (
                      <div class="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white shrink-0">
                        <span class="text-xs text-gray-500">
                          {Object.keys(graph().nodes).length} node
                          {Object.keys(graph().nodes).length !== 1 ? "s" : ""}
                        </span>
                        <Show when={client()}>
                          <CreateNodePopover
                            client={client()}
                            graphId={selectedGraphId()!}
                            packages={store.packages}
                            position={{
                              x: 40 + (Object.keys(graph().nodes).length % 5) * 200,
                              y: 40 + Math.floor(Object.keys(graph().nodes).length / 5) * 100,
                            }}
                          />
                        </Show>
                      </div>
                    )}
                  </Show>

                  {/* Node canvas */}
                  <div class="relative flex-1 overflow-auto bg-neutral-900">
                    <Show
                      when={selectedGraph()}
                      fallback={
                        <div class="p-4 text-gray-400 text-xs italic">
                          <Show when={graphs().length > 0} fallback={null}>
                            Select a graph to see its nodes
                          </Show>
                        </div>
                      }
                    >
                      <div class="graph-canvas relative h-[2000px] w-[3000px] min-h-full min-w-full">
                        <For each={nodes()}>
                          {(node) => (
                            <GraphNode
                              node={node}
                              onDragStart={onNodeMouseDown}
                              onDelete={deleteNode}
                            />
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
      <EventLog events={store.events} />
    </div>
  );
};
