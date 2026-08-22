import { Connection, Graph, Node, Package, Project } from "@macrograph/core";
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
};

type MutablePlaygroundStore = {
  project: MutableProject | null;
  packages: Package.Model[];
  events: EditorEvent.EditorEvent[];
};

export function createPlaygroundStore() {
  const [store, setStore] = createStore<MutablePlaygroundStore>({
    project: null,
    packages: [],
    events: [],
  });

  function applyEvent(event: EditorEvent.EditorEvent) {
    setStore((store) => {
      store.events.unshift(event);
    });

    if (!store.project) return;

    switch (event._tag) {
      case "GraphCreated":
        setStore((store) => {
          if (store.project) store.project.graphs[event.graph.id] = event.graph as MutableGraph;
        });
        break;
      case "GraphDeleted": {
        const graphs = { ...store.project.graphs };
        delete graphs[event.graphId];
        setStore((store) => {
          if (store.project) store.project.graphs = graphs;
        });
        break;
      }
      case "NodeCreated": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        setStore((store) => {
          if (store.project) store.project.graphs[event.graphId]!.nodes[event.node.id] = event.node;
        });
        break;
      }
      case "NodeDeleted": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        const nodes = { ...graph.nodes };
        delete nodes[event.nodeId];
        setStore((store) => {
          if (store.project) store.project.graphs[event.graphId]!.nodes = nodes;
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
      case "ConnectionCreated": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        setStore((store) => {
          if (store.project)
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
    }
  }

  function updateNodePosition(graphId: string, nodeId: string, x: number, y: number) {
    if (!store.project) return;
    const graph = store.project.graphs[graphId];
    if (!graph) return;
    const node = graph.nodes[nodeId];
    if (!node) return;
    setStore((store) => {
      if (store.project) {
        store.project.graphs[graphId]!.nodes[nodeId] = {
          ...node,
          position: { x, y },
        };
      }
    });
  }

  function setProject(project: Project.Model) {
    setStore((store) => {
      store.project = structuredClone(project) as MutableProject;
    });
  }

  function setPackages(packages: Package.Model[]) {
    setStore((store) => {
      store.packages = packages;
    });
  }

  return { store, applyEvent, updateNodePosition, setProject, setPackages };
}
