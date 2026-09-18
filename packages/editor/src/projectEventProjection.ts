import { Function as GraphFunction, Node, Project } from "@macrograph/core";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { Effect } from "effect";

import { EditorEvent } from "./EditorEvent.ts";

export type ApplyError = PersistenceError;

export const apply = (
  persistence: Persistence.Interface,
  event: EditorEvent.EditorEvent,
): Effect.Effect<void, ApplyError> => {
  switch (event._tag) {
    case "TypeDefinitionsUpdated":
      return Effect.gen(function* () {
        const project = yield* persistence.loadProject();
        const graphs = { ...project.graphs };
        for (const [graphId, connectionIds] of Object.entries(event.deletedConnectionIds)) {
          const graph = graphs[graphId];
          if (graph === undefined) continue;
          const deleted = new Set(connectionIds);
          graphs[graphId] = {
            ...graph,
            connections: graph.connections.filter((connection) => !deleted.has(connection.id)),
          };
        }
        return yield* persistence.saveProject({ ...project, types: event.types, graphs });
      }).pipe(PersistenceError.refail);

    case "FragmentPasted":
    case "FragmentDeleted":
      return Effect.gen(function* () {
        const graph = yield* persistence.loadGraph(event.graphId);
        const nodes = { ...graph.nodes };
        if (event._tag === "FragmentPasted") {
          for (const node of event.nodes) nodes[node.id] = node;
          const existing = new Set(graph.connections.map((connection) => connection.id));
          return yield* persistence.saveGraph({
            ...graph,
            nodes,
            connections: [
              ...graph.connections,
              ...event.connections.filter((connection) => !existing.has(connection.id)),
            ],
          });
        }
        for (const id of event.nodeIds) delete nodes[id];
        const deleted = new Set(event.deletedConnectionIds);
        return yield* persistence.saveGraph({
          ...graph,
          nodes,
          connections: graph.connections.filter((connection) => !deleted.has(connection.id)),
        });
      }).pipe(PersistenceError.refail);
    case "GraphCreated":
      return persistence.saveGraph(event.graph);

    case "GraphDeleted":
      return Effect.gen(function* () {
        const project = yield* persistence.loadProject();
        const { [event.graphId]: _graph, ...graphs } = project.graphs;
        const { [event.graphId]: _function, ...functions } = project.functions;
        yield* persistence.deleteGraph(event.graphId);
        return yield* persistence.saveProject({ ...project, graphs, functions });
      }).pipe(PersistenceError.refail);

    case "GraphNameChanged":
      return Effect.gen(function* () {
        const graph = yield* persistence.loadGraph(event.graphId);
        const updated = { ...graph, name: event.name };
        return yield* persistence.saveGraph(updated);
      }).pipe(PersistenceError.refail);

    case "FunctionCreated":
      return Effect.gen(function* () {
        const project = yield* persistence.loadProject();
        return yield* persistence.saveProject({
          ...project,
          functions: { ...project.functions, [event.fn.canvas.id]: event.fn },
        });
      }).pipe(PersistenceError.refail);

    case "FunctionUpdated":
      return Effect.gen(function* () {
        const project = yield* persistence.loadProject();
        const deleted = new Set(event.deletedConnectionIds);
        const fn = {
          ...event.fn,
          canvas: {
            ...event.fn.canvas,
            connections: event.fn.canvas.connections.filter(
              (connection) => !deleted.has(connection.id),
            ),
          },
        };
        return yield* persistence.saveProject({
          ...project,
          functions: { ...project.functions, [fn.canvas.id]: fn },
        });
      }).pipe(PersistenceError.refail);

    case "NodeCreated":
      return persistence.saveNode(event.graphId, event.node);

    case "NodeNameChanged":
      return Effect.gen(function* () {
        const node = yield* persistence.loadNode(event.graphId, event.nodeId);
        const updated: Node.Model = { ...node, name: event.name };
        return yield* persistence.saveNode(event.graphId, updated);
      }).pipe(PersistenceError.refail);

    case "NodePositionChanged":
      return Effect.gen(function* () {
        if (GraphFunction.isBoundaryNodeId(event.nodeId)) {
          const project = yield* persistence.loadProject();
          const fn = project.functions[event.graphId];
          if (fn === undefined) return yield* new Node.NotFoundError({ id: event.nodeId });
          const position = { x: event.x, y: event.y };
          return yield* persistence.saveProject({
            ...project,
            functions: {
              ...project.functions,
              [event.graphId]:
                event.nodeId === GraphFunction.InputBoundaryNodeId
                  ? { ...fn, inputPosition: position }
                  : { ...fn, outputPosition: position },
            },
          });
        }
        const node = yield* persistence.loadNode(event.graphId, event.nodeId);
        const updated: Node.Model = {
          ...node,
          position: { x: event.x, y: event.y },
        };
        return yield* persistence.saveNode(event.graphId, updated);
      }).pipe(PersistenceError.refail);

    case "NodeScopeSplitChanged":
      return Effect.gen(function* () {
        const node = yield* persistence.loadNode(event.graphId, event.nodeId);
        return yield* persistence.saveNode(event.graphId, {
          ...node,
          splitScopeOutputs: event.splitScopeOutputs,
        });
      }).pipe(PersistenceError.refail);

    case "NodeFoldPinsChanged":
      return Effect.gen(function* () {
        const node = yield* persistence.loadNode(event.graphId, event.nodeId);
        const updated: Node.Model = { ...node, foldPins: event.foldPins };
        return yield* persistence.saveNode(event.graphId, updated);
      }).pipe(PersistenceError.refail);

    case "NodePropertyUpdated":
      return Effect.gen(function* () {
        const graph = yield* persistence.loadGraph(event.graphId);
        const node = graph.nodes[event.nodeId];
        if (node === undefined) return yield* new Node.NotFoundError({ id: event.nodeId });
        const updated: Node.Model = {
          ...node,
          properties: event.properties,
          inputDefaults: event.inputDefaults,
        };
        const deleted = new Set(event.deletedConnectionIds);
        return yield* persistence.saveGraph({
          ...graph,
          nodes: { ...graph.nodes, [updated.id]: updated },
          connections: graph.connections.filter((connection) => !deleted.has(connection.id)),
        });
      }).pipe(PersistenceError.refail);

    case "InputDefaultUpdated":
      return Effect.gen(function* () {
        const node = yield* persistence.loadNode(event.graphId, event.nodeId);
        return yield* persistence.saveNode(event.graphId, {
          ...node,
          inputDefaults: event.inputDefaults,
        });
      }).pipe(PersistenceError.refail);

    case "NodeDeleted":
      return Effect.gen(function* () {
        const graph = yield* persistence.loadGraph(event.graphId);
        const { [event.nodeId]: _, ...nodes } = graph.nodes;
        const deleted = new Set(event.deletedConnectionIds);
        return yield* persistence.saveGraph({
          ...graph,
          nodes,
          connections: graph.connections.filter((connection) => !deleted.has(connection.id)),
        });
      }).pipe(PersistenceError.refail);

    case "ConnectionCreated":
      return persistence.saveConnection(event.graphId, event.connection);

    case "ConnectionDeleted":
      return persistence.deleteConnection(event.graphId, event.connectionId);

    case "EngineStateChanged":
      return Effect.gen(function* () {
        const project = yield* persistence.loadProject();
        return yield* persistence.saveProject({
          ...project,
          engines: { ...project.engines, [event.moduleId]: event.state },
        });
      }).pipe(PersistenceError.refail);

    case "ResourceConstantCreated":
      return Effect.gen(function* () {
        const project = yield* persistence.loadProject();
        return yield* persistence.saveProject({
          ...project,
          constants: { ...project.constants, [event.constant.id]: event.constant },
        });
      }).pipe(PersistenceError.refail);

    case "ResourceConstantDefaultChanged":
      return Effect.gen(function* () {
        const project = yield* persistence.loadProject();
        const constants = { ...project.constants };
        for (const constant of event.constants) constants[constant.id] = constant;
        return yield* persistence.saveProject({ ...project, constants });
      }).pipe(PersistenceError.refail);

    case "ResourceConstantUpdated":
      return Effect.gen(function* () {
        const project = yield* persistence.loadProject();
        let updatedProject = project;
        for (const [graphId, defaultsByNode] of Object.entries(event.inputDefaults)) {
          const graph = Project.canvases(updatedProject)[graphId];
          if (graph === undefined) continue;
          const nodes = { ...graph.nodes };
          for (const [nodeId, inputDefaults] of Object.entries(defaultsByNode)) {
            const node = nodes[nodeId];
            if (node !== undefined) nodes[nodeId] = { ...node, inputDefaults };
          }
          updatedProject = Project.replaceCanvas(updatedProject, { ...graph, nodes });
        }
        for (const [graphId, connectionIds] of Object.entries(event.deletedConnectionIds)) {
          const graph = Project.canvases(updatedProject)[graphId];
          if (graph === undefined) continue;
          const deleted = new Set(connectionIds);
          updatedProject = Project.replaceCanvas(updatedProject, {
            ...graph,
            connections: graph.connections.filter((connection) => !deleted.has(connection.id)),
          });
        }
        return yield* persistence.saveProject({
          ...updatedProject,
          constants: { ...project.constants, [event.constant.id]: event.constant },
        });
      }).pipe(PersistenceError.refail);

    case "ResourceConstantDeleted":
      return Effect.gen(function* () {
        const project = yield* persistence.loadProject();
        const constants = { ...project.constants };
        delete constants[event.constantId];
        return yield* persistence.saveProject({ ...project, constants });
      }).pipe(PersistenceError.refail);

    case "ResourceValuesUpdated":
    case "ModuleClientStateDirty":
      return Effect.void;
  }
};
