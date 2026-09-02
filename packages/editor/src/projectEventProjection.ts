import { Graph, Node } from "@macrograph/core";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { Effect } from "effect";

import { EditorEvent } from "./EditorEvent.ts";

export type ApplyError = PersistenceError;

export const apply = (
  persistence: Persistence.Service["Service"],
  event: EditorEvent.EditorEvent,
): Effect.Effect<void, ApplyError> => {
  switch (event._tag) {
    case "GraphCreated":
      return persistence.saveGraph(event.graph);

    case "GraphDeleted":
      return persistence.deleteGraph(event.graphId);

    case "GraphNameChanged":
      return Effect.gen(function* () {
        const graph = yield* persistence.loadGraph(event.graphId);
        const updated: Graph.Model = { ...graph, name: event.name };
        return yield* persistence.saveGraph(updated);
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
        const node = yield* persistence.loadNode(event.graphId, event.nodeId);
        const updated: Node.Model = {
          ...node,
          position: { x: event.x, y: event.y },
        };
        return yield* persistence.saveNode(event.graphId, updated);
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
          engines: { ...project.engines, [event.pluginId]: event.state },
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
        const graphs = { ...project.graphs };
        for (const [graphId, defaultsByNode] of Object.entries(event.inputDefaults)) {
          const graph = graphs[graphId];
          if (graph === undefined) continue;
          const nodes = { ...graph.nodes };
          for (const [nodeId, inputDefaults] of Object.entries(defaultsByNode)) {
            const node = nodes[nodeId];
            if (node !== undefined) nodes[nodeId] = { ...node, inputDefaults };
          }
          graphs[graphId] = { ...graph, nodes };
        }
        for (const [graphId, connectionIds] of Object.entries(event.deletedConnectionIds)) {
          const graph = graphs[graphId];
          if (graph === undefined) continue;
          const deleted = new Set(connectionIds);
          graphs[graphId] = {
            ...graph,
            connections: graph.connections.filter((connection) => !deleted.has(connection.id)),
          };
        }
        return yield* persistence.saveProject({
          ...project,
          graphs,
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
    case "PluginClientStateDirty":
      return Effect.void;
  }
};
