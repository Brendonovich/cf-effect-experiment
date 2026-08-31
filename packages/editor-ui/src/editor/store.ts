import {
  Connection,
  Graph,
  Node,
  type NodeIO,
  Package,
  Project,
  ResourceConstant,
} from "@macrograph/core";
import { EditorEvent } from "@macrograph/editor";
import { createStore } from "solid-js";

type MutableGraph = {
  id: Graph.GraphId;
  name: string;
  nodes: Record<string, Node.Model>;
  connections: Connection.Model[];
};

type MutableProject = {
  name: string;
  graphs: Record<string, MutableGraph>;
  engines: Record<string, unknown>;
  constants: Record<string, ResourceConstant.Model>;
  types: Project.Model["types"];
};

type MutableEditorStore = {
  project: MutableProject | null;
  packages: Package.Model[];
  nodeIO: Record<string, Record<string, NodeIO>>;
  events: EditorEvent.EditorEvent[];
  resourceValues: Record<string, ResourceConstant.LiveValue[]>;
};

export const resourceValuesKey = (packageId: string, resourceId: string) =>
  JSON.stringify([packageId, resourceId]);

export function createEditorStore() {
  const [store, setStoreValue] = createStore<MutableEditorStore>({
    project: null,
    packages: [],
    nodeIO: {},
    events: [],
    resourceValues: {},
  });
  const setStore = (update: (store: MutableEditorStore) => MutableEditorStore | undefined | void) =>
    setStoreValue((current) => {
      const draft: MutableEditorStore = {
        project:
          current.project === null
            ? null
            : {
                ...current.project,
                graphs: Object.fromEntries(
                  Object.entries(current.project.graphs).map(([id, graph]) => [
                    id,
                    { ...graph, nodes: { ...graph.nodes }, connections: [...graph.connections] },
                  ]),
                ),
                engines: { ...current.project.engines },
                constants: { ...current.project.constants },
              },
        packages: [...current.packages],
        nodeIO: Object.fromEntries(
          Object.entries(current.nodeIO).map(([graphId, nodes]) => [graphId, { ...nodes }]),
        ),
        events: [...current.events],
        resourceValues: Object.fromEntries(
          Object.entries(current.resourceValues).map(([key, values]) => [key, [...values]]),
        ),
      };
      const result = update(draft);
      const next = result === undefined ? draft : result;
      // Solid's server store setter invokes the callback without reconciling its return value.
      if (current === store) Object.assign(current, next);
      return next;
    });

  function applyEvent(event: EditorEvent.EditorEvent) {
    setStore((store) => {
      store.events.unshift(event);
    });

    if (event._tag === "ResourceValuesUpdated") {
      setStore((store) => ({
        ...store,
        resourceValues: {
          ...store.resourceValues,
          [resourceValuesKey(event.package, event.resource)]: [...event.values],
        },
      }));
      return;
    }

    if (!store.project) return;

    switch (event._tag) {
      case "GraphCreated":
        setStore((store) => {
          if (store.project) {
            store.project.graphs[event.graph.id] = {
              ...event.graph,
              nodes: { ...event.graph.nodes },
              connections: [...event.graph.connections],
            };
          }
        });
        break;
      case "GraphDeleted": {
        const graphs = { ...store.project.graphs };
        delete graphs[event.graphId];
        setStore((store) => {
          if (store.project) {
            store.project.graphs = graphs;
            delete store.nodeIO[event.graphId];
          }
        });
        break;
      }
      case "GraphNameChanged": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        setStore((store) => {
          if (store.project) {
            store.project.graphs[event.graphId] = { ...graph, name: event.name };
          }
        });
        break;
      }
      case "NodeCreated": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        setStore((store) => {
          if (store.project) {
            store.project.graphs[event.graphId]!.nodes[event.node.id] = event.node;
            (store.nodeIO[event.graphId] ??= {})[event.node.id] = event.io;
          }
        });
        break;
      }
      case "NodeDeleted": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        const nodes = { ...graph.nodes };
        delete nodes[event.nodeId];
        setStore((store) => {
          if (store.project) {
            store.project.graphs[event.graphId]!.nodes = nodes;
            const deleted = new Set(event.deletedConnectionIds);
            store.project.graphs[event.graphId]!.connections = graph.connections.filter(
              (connection) => !deleted.has(connection.id),
            );
            delete store.nodeIO[event.graphId]?.[event.nodeId];
          }
        });
        break;
      }
      case "NodeNameChanged": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        const node = graph.nodes[event.nodeId];
        if (!node) break;
        const updated = { ...node, name: event.name };
        setStore((store) => {
          if (store.project) store.project.graphs[event.graphId]!.nodes[event.nodeId] = updated;
        });
        break;
      }
      case "NodePositionChanged": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        const node = graph.nodes[event.nodeId];
        if (!node) break;
        const updated = {
          ...node,
          position: { x: event.x, y: event.y },
        };
        setStore((store) => {
          if (store.project) store.project.graphs[event.graphId]!.nodes[event.nodeId] = updated;
        });
        break;
      }
      case "NodeFoldPinsChanged": {
        const graph = store.project.graphs[event.graphId];
        const node = graph?.nodes[event.nodeId];
        if (!node) break;
        setStore((store) => {
          if (store.project) {
            store.project.graphs[event.graphId]!.nodes[event.nodeId] = {
              ...node,
              foldPins: event.foldPins,
            };
          }
        });
        break;
      }
      case "NodePropertyUpdated": {
        const graph = store.project.graphs[event.graphId];
        const node = graph?.nodes[event.nodeId];
        if (!node) break;
        setStore((store) => {
          const project = store.project;
          const current = store.project?.graphs[event.graphId]?.nodes[event.nodeId];
          if (current && project) {
            project.graphs[event.graphId]!.nodes[event.nodeId] = {
              ...current,
              properties: event.properties,
              inputDefaults: event.inputDefaults,
            };
            const deleted = new Set(event.deletedConnectionIds);
            project.graphs[event.graphId]!.connections = project.graphs[
              event.graphId
            ]!.connections.filter((connection) => !deleted.has(connection.id));
            (store.nodeIO[event.graphId] ??= {})[event.nodeId] = event.io;
          }
        });
        break;
      }
      case "InputDefaultUpdated":
        setStore((store) => {
          const current = store.project?.graphs[event.graphId]?.nodes[event.nodeId];
          if (current && store.project) {
            store.project.graphs[event.graphId]!.nodes[event.nodeId] = {
              ...current,
              inputDefaults: event.inputDefaults,
            };
          }
        });
        break;
      case "ConnectionCreated": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        setStore((store) => {
          if (
            store.project &&
            !store.project.graphs[event.graphId]!.connections.some(
              (connection) => connection.id === event.connection.id,
            )
          )
            store.project.graphs[event.graphId]!.connections.push(event.connection);
        });
        break;
      }
      case "ConnectionDeleted": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        setStore((store) => {
          if (store.project) {
            store.project.graphs[event.graphId]!.connections = graph.connections.filter(
              (c: Connection.Model) => c.id !== event.connectionId,
            );
          }
        });
        break;
      }
      case "EngineStateChanged":
        setStore((store) => {
          if (store.project) store.project.engines[event.pluginId] = event.state;
        });
        break;
      case "ResourceConstantCreated":
        setStore((store) => {
          if (store.project) store.project.constants[event.constant.id] = event.constant;
        });
        break;
      case "ResourceConstantUpdated":
        setStore((store) => {
          if (!store.project) return;
          store.project.constants[event.constant.id] = event.constant;
          for (const [graphId, nodes] of Object.entries(event.nodeIO)) {
            for (const [nodeId, io] of Object.entries(nodes)) {
              (store.nodeIO[graphId] ??= {})[nodeId] = io;
            }
          }
          for (const [graphId, defaultsByNode] of Object.entries(event.inputDefaults)) {
            const graph = store.project.graphs[graphId];
            if (graph === undefined) continue;
            for (const [nodeId, inputDefaults] of Object.entries(defaultsByNode)) {
              const node = graph.nodes[nodeId];
              if (node !== undefined) graph.nodes[nodeId] = { ...node, inputDefaults };
            }
          }
          for (const [graphId, connectionIds] of Object.entries(event.deletedConnectionIds)) {
            const graph = store.project.graphs[graphId];
            if (graph === undefined) continue;
            const deleted = new Set(connectionIds);
            graph.connections = graph.connections.filter(
              (connection) => !deleted.has(connection.id),
            );
          }
        });
        break;
      case "ResourceConstantDeleted":
        setStore((store) => {
          if (store.project) delete store.project.constants[event.constantId];
        });
        break;
    }
  }

  function updateNodePosition(graphId: string, nodeId: string, x: number, y: number) {
    if (!store.project) return;
    const graph = store.project.graphs[graphId];
    if (!graph) return;
    const node = graph.nodes[nodeId];
    if (!node) return;
    setStoreValue((store) => {
      if (!store.project) return store;
      return {
        ...store,
        project: {
          ...store.project,
          graphs: {
            ...store.project.graphs,
            [graphId]: {
              ...graph,
              nodes: {
                ...graph.nodes,
                [nodeId]: { ...node, position: { x, y } },
              },
            },
          },
        },
      };
    });
  }

  function setProject(project: Project.Model, nodeIO: Record<string, Record<string, NodeIO>>) {
    setStore((store) => {
      const cloned = structuredClone(project);
      store.project = {
        ...cloned,
        graphs: Object.fromEntries(
          Object.entries(cloned.graphs).map(([id, graph]) => [
            id,
            { ...graph, nodes: { ...graph.nodes }, connections: [...graph.connections] },
          ]),
        ),
      };
      store.nodeIO = structuredClone(nodeIO);
    });
  }

  function setPackages(packages: Package.Model[]) {
    setStore((store) => {
      store.packages = packages;
    });
  }

  return { store, applyEvent, updateNodePosition, setProject, setPackages };
}
