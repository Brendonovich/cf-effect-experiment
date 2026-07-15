import { Connection, Graph, Node, Package, Position, Project } from "@macrograph/core";
import { EditorEvent } from "@macrograph/editor";
import { createStore } from "solid-js/store";

type MutableGraph = {
  id: Graph.GraphId;
  name: string;
  nodes: Record<string, Node.Model>;
  connections: Connection.Model[];
};

type MutableProject = {
  name: string;
  graphs: Record<string, MutableGraph>;
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
    setStore("events", (events) => [event, ...events]);

    if (!store.project) return;

    switch (event._tag) {
      case "GraphCreated":
        setStore("project", "graphs", event.graph.id, event.graph as MutableGraph);
        break;
      case "GraphDeleted": {
        const graphs = { ...store.project.graphs };
        delete graphs[event.graphId];
        setStore("project", "graphs", graphs);
        break;
      }
      case "NodeCreated": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        setStore("project", "graphs", event.graphId, "nodes", {
          ...graph.nodes,
          [event.node.id]: event.node,
        });
        break;
      }
      case "NodeDeleted": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        const nodes = { ...graph.nodes };
        delete nodes[event.nodeId];
        setStore("project", "graphs", event.graphId, "nodes", nodes);
        break;
      }
      case "NodeNameChanged": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        const node = graph.nodes[event.nodeId];
        if (!node) break;
        const updated = { ...node, name: event.name };
        setStore("project", "graphs", event.graphId, "nodes", {
          ...graph.nodes,
          [event.nodeId]: updated,
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
        setStore("project", "graphs", event.graphId, "nodes", {
          ...graph.nodes,
          [event.nodeId]: updated,
        });
        break;
      }
      case "ConnectionCreated": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        setStore("project", "graphs", event.graphId, "connections", [
          ...graph.connections,
          event.connection,
        ]);
        break;
      }
      case "ConnectionDeleted": {
        const graph = store.project.graphs[event.graphId];
        if (!graph) break;
        setStore(
          "project",
          "graphs",
          event.graphId,
          "connections",
          graph.connections.filter((c: Connection.Model) => c.id !== event.connectionId),
        );
        break;
      }
    }
  }

  function updateNodePosition(graphId: string, nodeId: string, x: number, y: number) {
    if (!store.project) return;
    const graph = store.project.graphs[graphId];
    if (!graph) return;
    const node = graph.nodes[nodeId];
    if (!node) return;
    setStore("project", "graphs", graphId, "nodes", nodeId, {
      ...node,
      position: { x, y },
    });
  }

  function setProject(project: Project.Model) {
    setStore("project", structuredClone(project) as MutableProject);
  }

  function setPackages(packages: Package.Model[]) {
    setStore("packages", packages);
  }

  return { store, applyEvent, updateNodePosition, setProject, setPackages };
}
