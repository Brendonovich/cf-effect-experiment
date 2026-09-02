import type { EditorEvent } from "@macrograph/editor";

import { Clipboard, IoId, type ResourceConstant, type SchemaRef } from "@macrograph/core";
import { QueryClient, useMutation } from "@tanstack/solid-query";
import { Effect, Result, type Schema } from "effect";
import { createSignal, onCleanup } from "solid-js";

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
  const { selectedGraphId, selectedGraph, selectedNodeId, setSelectedGraphId, setSelectedNodeIds } =
    workspace;
  const applyMutation = <Event extends EditorEvent.EditorEvent, Error, Requirements>(
    effect: Effect.Effect<Event, Error, Requirements>,
  ) => effect.pipe(Effect.tap((event) => Effect.sync(() => editor.applyEvent(event))));
  const [editingName, setEditingName] = createSignal<
    { type: "graph"; id: string } | { type: "node"; id: string } | null
  >(null);
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { networkMode: "always" } },
  });
  onCleanup(() => queryClient.clear());
  const clipboardMutation = useMutation(
    () => ({
      mutationFn: (operation: () => Promise<void>) => operation(),
      // Do not replay clipboard writes or editor mutations automatically.
      retry: false,
    }),
    () => queryClient,
  );
  const [clipboardRebind, setClipboardRebind] =
    createSignal<ReadonlyArray<Clipboard.RebindRequest>>();
  const [clipboardMissingSchemas, setClipboardMissingSchemas] =
    createSignal<ReadonlyArray<Clipboard.MissingSchema>>();
  let resolveRebind: ((bindings: ReadonlyArray<Clipboard.Binding> | undefined) => void) | undefined;
  let resolveMissingSchemas: ((force: boolean) => void) | undefined;
  const finishClipboardRebind = (bindings?: ReadonlyArray<Clipboard.Binding>) => {
    setClipboardRebind(undefined);
    resolveRebind?.(bindings);
    resolveRebind = undefined;
  };
  const finishClipboardMissingSchemas = (force: boolean) => {
    setClipboardMissingSchemas(undefined);
    resolveMissingSchemas?.(force);
    resolveMissingSchemas = undefined;
  };
  onCleanup(() => {
    finishClipboardRebind();
    finishClipboardMissingSchemas(false);
  });
  const copyNodes = async (nodeIds: ReadonlyArray<string>, cut = false) => {
    const graph = selectedGraph();
    const graphId = selectedGraphId();
    const c = client();
    if (clipboardMutation.isPending || !graph || !graphId || (cut && (!c || !canEdit()))) return;
    const nodes = nodeIds.flatMap((id) => {
      const node = graph.nodes[id];
      if (!node) return [];
      const schema = editor.store.packages
        .find((pkg) => pkg.id === node.schema.package)
        ?.schemas.find((schema) => schema.id === node.schema.schema);
      return schema?.internal === true ? [] : [node];
    });
    const ids = new Set(nodes.map((node) => String(node.id)));
    const capturedIO = Object.fromEntries(
      nodes.flatMap((node) => {
        const io = editor.store.nodeIO[graphId]?.[node.id];
        return io === undefined ? [] : [[node.id, io]];
      }),
    );
    const externalConnections = graph.connections.filter(
      (connection) => ids.has(connection.inNodeId) !== ids.has(connection.outNodeId),
    );
    const internalConnections = graph.connections.filter(
      (connection) => ids.has(connection.inNodeId) && ids.has(connection.outNodeId),
    );
    return clipboardMutation
      .mutateAsync(async () => {
        try {
          if (nodes.length === 0) return;
          const session = c ? await runPromise(c.GetClipboardIdentity()) : undefined;
          const text = JSON.stringify({
            format: "macrograph/nodes",
            version: 1,
            nodes,
            connections: internalConnections,
            externalConnections,
            nodeIO: capturedIO,
            ...(session === undefined ? {} : { source: { session, graphId } }),
          });
          await runPromise(Clipboard.decode(text));
          await navigator.clipboard.writeText(text);
          // Graph, client and IDs were captured before awaiting clipboard permission.
          if (cut && c) {
            if (!canEdit() || client() !== c)
              throw new Error("Editor connection changed; source nodes were not cut");
            await runPromise(applyMutation(c.DeleteFragment({ graphId, nodeIds: [...ids] })));
            if (selectedGraphId() === graphId)
              setSelectedNodeIds((selected) => selected.filter((id) => !ids.has(id)));
          }
        } catch (error) {
          throw new Error(
            `${cut ? "Cut" : "Copy"} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })
      .catch(() => {}); // Errors are rendered from the mutation state.
  };
  const pasteNodes = async (position: { x: number; y: number }) => {
    const graphId = selectedGraphId();
    const c = client();
    if (clipboardMutation.isPending || !graphId || !c || !canEdit()) return;
    const anchor = snapGraphPosition(position, false);
    return clipboardMutation
      .mutateAsync(async () => {
        try {
          const text = await navigator.clipboard.readText();
          await runPromise(Clipboard.decode(text));
          if (!canEdit() || client() !== c)
            throw new Error("Editor connection changed; nothing was pasted");
          let bindings: ReadonlyArray<Clipboard.Binding> = [];
          let forceMissingSchemas = false;
          let result = await runPromise(
            c
              .PasteFragment({ graphId, text, position: anchor, bindings, forceMissingSchemas })
              .pipe(Effect.result),
          );
          while (Result.isFailure(result)) {
            if (result.failure._tag === "ClipboardMissingSchemas") {
              setClipboardMissingSchemas(result.failure.schemas);
              forceMissingSchemas = await new Promise<boolean>((resolve) => {
                resolveMissingSchemas = resolve;
              });
              if (!forceMissingSchemas) return;
            } else if (result.failure._tag === "ClipboardRebindRequired") {
              setClipboardRebind(result.failure.requests);
              const chosen = await new Promise<ReadonlyArray<Clipboard.Binding> | undefined>(
                (resolve) => {
                  resolveRebind = resolve;
                },
              );
              if (chosen === undefined) return;
              bindings = [
                ...bindings.filter(
                  (binding) =>
                    !chosen.some(
                      (next) =>
                        next.nodeId === binding.nodeId && next.property === binding.property,
                    ),
                ),
                ...chosen,
              ];
            } else break;
            if (!canEdit() || client() !== c)
              throw new Error("Editor connection changed; nothing was pasted");
            result = await runPromise(
              c
                .PasteFragment({ graphId, text, position: anchor, bindings, forceMissingSchemas })
                .pipe(Effect.result),
            );
          }
          if (Result.isFailure(result))
            throw new Error(
              "reason" in result.failure ? String(result.failure.reason) : result.failure._tag,
            );
          const event = result.success;
          editor.applyEvent(event);
          if (selectedGraphId() === graphId) setSelectedNodeIds(event.nodes.map((node) => node.id));
        } catch (error) {
          throw new Error(
            `Paste failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })
      .catch(() => {}); // Errors are rendered from the mutation state.
  };
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
      return runPromise(
        applyMutation(c.RenameResourceConstant({ constantId, name })).pipe(Effect.asVoid),
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
  const setDefaultConstant = (constantId: string) => {
    const c = client();
    if (c && canEdit())
      runFork(
        applyMutation(c.SetDefaultResourceConstant({ constantId })).pipe(
          Effect.tapError(Effect.log),
        ),
      );
  };
  const deleteNode = (nodeId: string) => {
    const c = client();
    const graphId = selectedGraphId();
    if (!c || !graphId || !canEdit()) return;
    runFork(
      applyMutation(c.DeleteNode({ graphId, nodeId })).pipe(
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
    );
    setSelectedNodeIds((ids) => ids.filter((id) => id !== nodeId));
  };
  const createGraph = () => {
    const c = client();
    if (!c || !canEdit()) return;
    runFork(
      applyMutation(c.CreateGraph({ graph: {} })).pipe(
        Effect.tap((event) => Effect.sync(() => setSelectedGraphId(event.graph.id))),
        Effect.tapError(Effect.log),
        Effect.tapDefect(Effect.log),
      ),
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
      applyMutation(c.DeleteGraph({ graphId })).pipe(
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
    copyNodes,
    pasteNodes,
    clipboardMutation,
    clipboardError: () => clipboardMutation.error?.message,
    clipboardRebind,
    finishClipboardRebind,
    clipboardMissingSchemas,
    finishClipboardMissingSchemas,
    dismissClipboardError: () => {
      if (!clipboardMutation.isPending) clipboardMutation.reset();
    },
    isNodePositioning: (nodeId: string) =>
      positioningNodes().some(
        (node) => node.graphId === selectedGraphId() && node.nodeId === nodeId,
      ),
    setEditingName,
    editingGraphNameId,
    editingNodeNameId,
    createConstant,
    renameConstant,
    selectConstant,
    setDefaultConstant,
    deleteConstant,
    createGraph,
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
