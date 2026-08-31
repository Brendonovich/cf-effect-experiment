import type { EditorEvent } from "@macrograph/editor";

import {
  FunctionGraph,
  IoId,
  type Graph,
  type ResourceConstant,
  type SchemaRef,
} from "@macrograph/core";
import { Cause, Effect, type Schema } from "effect";
import { createSignal } from "solid-js";

import type { createEditorConnection } from "./session/createEditorConnection";
import type { createEditorStore } from "./store";
import type { createEditorWorkspace } from "./workspace/createEditorWorkspace";

import { runFork, runPromise } from "../observability/browserTracing";
import { portsCompatible, type PortEndpoint } from "./graph/connectionAuthoring";
import {
  graphNodeInputs,
  graphNodeOutputs,
  graphNodeWidth,
  graphPortOffset,
  snapGraphPosition,
} from "./graph/graphPresentation";

export function createEditorCommands(
  editor: ReturnType<typeof createEditorStore>,
  connection: Pick<ReturnType<typeof createEditorConnection>, "client" | "canEdit">,
  workspace: Pick<
    ReturnType<typeof createEditorWorkspace>,
    | "selectedGraphId"
    | "selectedGraph"
    | "selectedNodeId"
    | "setSelectedGraphId"
    | "setSelectedNodeIds"
  >,
) {
  const { client, canEdit } = connection;
  const [queueError, setQueueError] = createSignal<string | null>(null);
  const queueAction = <A, E>(effect: Effect.Effect<A, E>) => {
    setQueueError(null);
    runFork(
      effect.pipe(
        Effect.catchCause((cause) => Effect.sync(() => setQueueError(String(Cause.squash(cause))))),
      ),
    );
  };
  const createQueue = () => {
    const c = client();
    if (c && canEdit()) queueAction(applyMutation(c.CreateQueue({ name: "New Queue" })));
  };
  const renameQueue = (queueId: string, name: string) => {
    const c = client();
    if (c && canEdit()) queueAction(applyMutation(c.RenameQueue({ queueId, name })));
  };
  const deleteQueue = (queueId: string) => {
    const c = client();
    if (c && canEdit()) queueAction(applyMutation(c.DeleteQueue({ queueId })));
  };
  const pauseQueue = (queueId: string, paused: boolean) => {
    const c = client();
    if (c && canEdit()) queueAction(c.SetQueuePaused({ queueId, paused }));
  };
  const advanceQueue = (queueId: string) => {
    const c = client();
    if (c && canEdit()) queueAction(c.AdvanceQueue({ queueId }));
  };
  const clearQueue = (queueId: string) => {
    const c = client();
    if (c && canEdit()) queueAction(c.ClearQueue({ queueId }));
  };
  const removeQueueItem = (queueId: string, itemId: string) => {
    const c = client();
    if (c && canEdit()) queueAction(c.RemoveQueueItem({ queueId, itemId }));
  };
  const { selectedGraphId, selectedGraph, selectedNodeId, setSelectedGraphId, setSelectedNodeIds } =
    workspace;
  const applyMutation = <Event extends EditorEvent.EditorEvent, Error, Requirements>(
    effect: Effect.Effect<Event, Error, Requirements>,
  ) => effect.pipe(Effect.tap((event) => Effect.sync(() => editor.applyEvent(event))));
  const [editingName, setEditingName] = createSignal<
    { type: "graph"; id: string } | { type: "node"; id: string } | null
  >(null);
  const [functionError, setFunctionError] = createSignal<string | null>(null);
  const reportFunctionError = (error: unknown) =>
    Effect.sync(() => {
      if (typeof error === "object" && error !== null && "reason" in error)
        setFunctionError(String(error.reason));
    });
  const [positioningNodes, setPositioningNodes] = createSignal<
    ReadonlyArray<{ graphId: string; nodeId: string }>
  >([]);
  const editingGraphNameId = () => {
    const editing = editingName();
    return editing?.type === "graph" ? editing.id : null;
  };
  const editingNodeNameId = () => {
    const editing = editingName();
    return editing?.type === "node" ? editing.id : null;
  };
  const createConstant = (resource: ResourceConstant.ResourceRef) => {
    const c = client();
    if (c && canEdit())
      runFork(
        applyMutation(c.CreateResourceConstant({ resource })).pipe(Effect.tapError(Effect.log)),
      );
  };
  const renameConstant = (constantId: string, name: string) => {
    const c = client();
    if (c && canEdit())
      runFork(
        applyMutation(c.RenameResourceConstant({ constantId, name })).pipe(
          Effect.tapError(Effect.log),
        ),
      );
  };
  const selectConstant = (constantId: string, value: Schema.Json) => {
    const c = client();
    if (c && canEdit())
      runFork(
        applyMutation(c.SelectResourceConstant({ constantId, value })).pipe(
          Effect.tapError(Effect.log),
        ),
      );
  };
  const deleteConstant = (constantId: string) => {
    const c = client();
    if (c && canEdit())
      runFork(
        applyMutation(c.DeleteResourceConstant({ constantId })).pipe(Effect.tapError(Effect.log)),
      );
  };
  const deleteNode = (nodeId: string) => {
    const c = client();
    const graphId = selectedGraphId();
    if (!c || !graphId || !canEdit()) return;
    const node = selectedGraph()?.nodes[nodeId];
    if (node && FunctionGraph.isBoundary(node)) return;
    runFork(
      applyMutation(c.DeleteNode({ graphId, nodeId })).pipe(
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
    setSelectedNodeIds((ids) => ids.filter((id) => id !== nodeId));
  };
  const createGraph = (kind: "ordinary" | "function" = "ordinary") => {
    const c = client();
    if (!c || !canEdit()) return;
    runFork(
      applyMutation(
        c.CreateGraph({
          graph: { kind, ...(kind === "function" ? { name: "New Function" } : {}) },
        }),
      ).pipe(
        Effect.tap((event) => Effect.sync(() => setSelectedGraphId(event.graph.id))),
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };
  const setFunctionSignature = (signature: Graph.FunctionSignature) => {
    const c = client();
    const graphId = selectedGraphId();
    if (!c || !graphId || !canEdit()) return;
    setFunctionError(null);
    runFork(
      applyMutation(
        c
          .SetFunctionSignature({ graphId, signature })
          .pipe(
            Effect.catchTag("FunctionImpact", (impact) =>
              window.confirm(impact.reason)
                ? c.SetFunctionSignature({ graphId, signature, force: true })
                : Effect.fail(impact),
            ),
          ),
      ).pipe(Effect.tapError(reportFunctionError), Effect.catchCause(Effect.log)),
    );
  };
  const createNode = (
    schema: SchemaRef,
    name: string,
    position: { x: number; y: number },
    source?: Pick<PortEndpoint, "nodeId" | "direction" | "port">,
    shiftKey = false,
  ) => {
    const c = client();
    const graphId = selectedGraphId();
    if (!c || !graphId || !canEdit()) return;
    return runPromise(
      applyMutation(
        c.CreateNode({
          graphId,
          node: {
            name,
            schema,
            position: snapGraphPosition(position, shiftKey),
          },
        }),
      ).pipe(
        Effect.flatMap((event) => {
          if (source === undefined) return Effect.void;
          const targetPorts =
            source.direction === "output" ? graphNodeInputs(event.io) : graphNodeOutputs(event.io);
          const targetPort = targetPorts.find((port) => portsCompatible(source.port, port));
          if (targetPort === undefined)
            return applyMutation(c.DeleteNode({ graphId, nodeId: event.node.id })).pipe(
              Effect.asVoid,
            );
          const output =
            source.direction === "output"
              ? { nodeId: source.nodeId, port: source.port }
              : { nodeId: event.node.id, port: targetPort };
          const input =
            source.direction === "input"
              ? { nodeId: source.nodeId, port: source.port }
              : { nodeId: event.node.id, port: targetPort };
          const offset = graphPortOffset(
            graphNodeWidth(event.io, event.node.name),
            source.direction === "output" ? "input" : "output",
            targetPorts.indexOf(targetPort),
          );
          const alignedPosition = snapGraphPosition(
            { x: position.x - offset.x, y: position.y - offset.y },
            shiftKey,
          );
          const positioning = { graphId, nodeId: event.node.id };
          setPositioningNodes((nodes) => [...nodes, positioning]);
          editor.updateNodePosition(graphId, event.node.id, alignedPosition.x, alignedPosition.y);
          return applyMutation(
            c.SetNodePosition({
              graphId,
              nodeId: event.node.id,
              ...alignedPosition,
            }),
          ).pipe(
            Effect.andThen(() =>
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
              ),
            ),
            Effect.catchCause((cause) =>
              applyMutation(c.DeleteNode({ graphId, nodeId: event.node.id })).pipe(
                Effect.catchCause(() => Effect.void),
                Effect.andThen(Effect.failCause(cause)),
              ),
            ),
            Effect.asVoid,
            Effect.ensuring(
              Effect.sync(() => {
                // Keep smoothing disabled through a paint, even when the local RPC finishes immediately.
                requestAnimationFrame(() =>
                  requestAnimationFrame(() =>
                    setPositioningNodes((nodes) => nodes.filter((node) => node !== positioning)),
                  ),
                );
              }),
            ),
          );
        }),
        Effect.catchCause(Effect.log),
      ),
    );
  };
  const setNodeFoldPins = (nodeId: string, foldPins: boolean) => {
    const c = client();
    const graphId = selectedGraphId();
    if (!c || !graphId || !canEdit()) return;
    runFork(
      applyMutation(c.SetNodeFoldPins({ graphId, nodeId, foldPins })).pipe(
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };
  const renameNode = (name: string) => {
    const c = client();
    const graphId = selectedGraphId();
    const nodeId = selectedNodeId();
    if (!c || !graphId || !nodeId || name.trim().length === 0 || !canEdit()) return;
    runFork(
      applyMutation(c.SetNodeName({ graphId, nodeId, name: name.trim() })).pipe(
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };
  const renameGraphById = (graphId: string, name: string) => {
    const c = client();
    if (!c || !graphId || name.trim().length === 0 || !canEdit()) return;
    runFork(
      applyMutation(c.SetGraphName({ graphId, name: name.trim() })).pipe(
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };
  const renameGraph = (name: string) => {
    const graphId = selectedGraphId();
    if (graphId) renameGraphById(graphId, name);
  };
  const deleteGraph = (graphId: string) => {
    const c = client();
    if (!c || !canEdit()) return;
    runFork(
      applyMutation(
        c
          .DeleteGraph({ graphId })
          .pipe(
            Effect.catchTag("FunctionImpact", (impact) =>
              window.confirm(impact.reason)
                ? c.DeleteGraph({ graphId, force: true })
                : Effect.fail(impact),
            ),
          ),
      ).pipe(
        Effect.tapError(reportFunctionError),
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };
  const setNodeProperty = (property: string, value: unknown) => {
    const c = client();
    const graphId = selectedGraphId();
    const nodeId = selectedNodeId();
    if (!c || !graphId || !nodeId || !canEdit()) return;
    runFork(
      applyMutation(c.SetNodeProperty({ graphId, nodeId, property, value })).pipe(
        Effect.tapError(reportFunctionError),
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };
  const clearNodeProperty = (property: string) => {
    const c = client();
    const graphId = selectedGraphId();
    const nodeId = selectedNodeId();
    if (!c || !graphId || !nodeId || !canEdit()) return;
    runFork(
      applyMutation(c.ClearNodeProperty({ graphId, nodeId, property })).pipe(
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };
  const setInputDefault = (nodeId: string, input: string, value: unknown) => {
    const c = client();
    const graphId = selectedGraphId();
    if (!c || !graphId || !canEdit()) return;
    runFork(
      applyMutation(c.SetInputDefault({ graphId, nodeId, input, value })).pipe(
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };
  const clearInputDefault = (nodeId: string, input: string) => {
    const c = client();
    const graphId = selectedGraphId();
    if (!c || !graphId || !canEdit()) return;
    runFork(
      applyMutation(c.ClearInputDefault({ graphId, nodeId, input })).pipe(
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
  };
  const getInputSuggestions = (nodeId: string, input: string) => {
    const c = client();
    const graphId = selectedGraphId();
    if (!c || !graphId) return Promise.resolve([] as ReadonlyArray<string>);
    return runPromise(
      c
        .GetInputSuggestions({ graphId, nodeId, input })
        .pipe(Effect.catchCause(() => Effect.succeed([]))),
    );
  };
  const disconnectIo = (direction: "input" | "output", nodeId: string, ioId: string) => {
    const c = client();
    const graph = selectedGraph();
    const graphId = selectedGraphId();
    if (!c || !graph || !graphId || !canEdit()) return;
    const connections = graph.connections.filter((candidate) =>
      direction === "input"
        ? candidate.inNodeId === nodeId && candidate.inIoId === ioId
        : candidate.outNodeId === nodeId && candidate.outIoId === ioId,
    );
    connections.forEach((connection) =>
      runFork(
        applyMutation(c.DeleteConnection({ graphId, connectionId: connection.id })).pipe(
          Effect.tapError(Effect.log),
          Effect.tapDefect(Effect.log),
        ),
      ),
    );
  };

  return {
    isNodePositioning: (nodeId: string) =>
      positioningNodes().some(
        (node) => node.graphId === selectedGraphId() && node.nodeId === nodeId,
      ),
    setEditingName,
    editingGraphNameId,
    editingNodeNameId,
    createConstant,
    queueError,
    createQueue,
    renameQueue,
    deleteQueue,
    pauseQueue,
    advanceQueue,
    clearQueue,
    removeQueueItem,
    renameConstant,
    selectConstant,
    deleteConstant,
    createGraph,
    createFunction: () => createGraph("function"),
    setFunctionSignature,
    functionError,
    createNode,
    deleteNode,
    setNodeFoldPins,
    renameNode,
    renameGraph,
    renameGraphById,
    deleteGraph,
    setNodeProperty,
    clearNodeProperty,
    setInputDefault,
    clearInputDefault,
    getInputSuggestions,
    disconnectIo,
  };
}
