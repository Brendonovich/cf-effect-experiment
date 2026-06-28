import { Connection, Graph, Node, Project } from "@macrograph/core";
import { Effect, FileSystem, Layer, Path, Schema, Semaphore } from "effect";

import { Persistence, PersistenceError } from "../Persistence.ts";

const ProjectMeta = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});

export const layer = (dir: string) =>
  Layer.effect(
    Persistence.Service,
    Effect.gen(function* () {
      const { join } = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;

      const projectDir = dir;
      const graphsDir = join(projectDir, "graphs");
      const projectFilePath = join(projectDir, "project.json");
      const graphFilePath = (graphId: string) => join(graphsDir, `${graphId}.json`);

      const lock = yield* Semaphore.make(1);

      const saveProject = Effect.fnUntraced(function* (project: Project.Model) {
        yield* fs.makeDirectory(graphsDir, { recursive: true }).pipe(PersistenceError.refail);

        yield* fs
          .writeFileString(projectFilePath, JSON.stringify({ name: project.name }, null, 2))
          .pipe(PersistenceError.refail);

        for (const [graphId, graph] of Object.entries(project.graphs)) {
          yield* fs
            .writeFileString(graphFilePath(graphId), JSON.stringify(graph, null, 2))
            .pipe(PersistenceError.refail);
        }
      }, lock.withPermit);

      const loadProject = Effect.fnUntraced(function* () {
        const metaExists = yield* fs.exists(projectFilePath).pipe(PersistenceError.refail);
        if (!metaExists) return yield* new Project.NotFoundError();

        const metaRaw = yield* fs.readFileString(projectFilePath).pipe(PersistenceError.refail);
        const meta = yield* Schema.decodeUnknownEffect(ProjectMeta)(JSON.parse(metaRaw)).pipe(
          PersistenceError.refail,
        );

        const graphs: Record<string, Graph.Model> = {};
        const graphsExist = yield* fs.exists(graphsDir).pipe(PersistenceError.refail);
        if (graphsExist) {
          const graphFiles = yield* fs.readDirectory(graphsDir).pipe(PersistenceError.refail);
          for (const file of graphFiles) {
            if (!file.endsWith(".json")) continue;
            const graphId = file.slice(0, -5);
            const content = yield* fs
              .readFileString(graphFilePath(graphId))
              .pipe(PersistenceError.refail);
            const graph = yield* Schema.decodeUnknownEffect(Graph.Model)(JSON.parse(content)).pipe(
              PersistenceError.refail,
            );
            graphs[graphId] = graph;
          }
        }

        return new Project.Model({
          // id: ProjectId.make(meta.id),
          name: meta.name,
          graphs,
        });
      }, lock.withPermit);

      const loadGraph = Effect.fnUntraced(function* (graphId: string) {
        const exists = yield* fs.exists(graphFilePath(graphId)).pipe(PersistenceError.refail);
        if (!exists) return yield* new Graph.NotFoundError({ id: graphId });

        const content = yield* fs
          .readFileString(graphFilePath(graphId))
          .pipe(PersistenceError.refail);
        return yield* Schema.decodeUnknownEffect(Graph.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
      }, lock.withPermit);

      const loadNode = Effect.fnUntraced(function* (graphId: string, nodeId: string) {
        const exists = yield* fs.exists(graphFilePath(graphId)).pipe(PersistenceError.refail);
        if (!exists) return yield* new Node.NotFoundError({ id: nodeId });

        const content = yield* fs
          .readFileString(graphFilePath(graphId))
          .pipe(PersistenceError.refail);
        const graph = yield* Schema.decodeUnknownEffect(Graph.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
        const node = graph.nodes[nodeId];
        if (!node) return yield* new Node.NotFoundError({ id: nodeId });
        return node;
      }, lock.withPermit);

      // const deleteProject = Effect.fnUntraced(function* () {
      // 	const exists = yield* fs.exists(projectDir).pipe(PersistenceError.refail);
      // 	if (exists) yield* fs.remove(projectDir, { recursive: true }).pipe(PersistenceError.refail);
      // }, lock.withPermit);

      const saveGraph = Effect.fnUntraced(function* (graph: Graph.Model) {
        yield* fs
          .writeFileString(graphFilePath(graph.id), JSON.stringify(graph, null, 2))
          .pipe(PersistenceError.refail);
      }, lock.withPermit);

      const deleteGraph = Effect.fnUntraced(function* (graphId: string) {
        const exists = yield* fs.exists(graphFilePath(graphId)).pipe(PersistenceError.refail);
        if (exists) yield* fs.remove(graphFilePath(graphId)).pipe(PersistenceError.refail);
      }, lock.withPermit);

      const saveNode = Effect.fnUntraced(function* (graphId: string, node: Node.Model) {
        const graphFile = graphFilePath(graphId);
        const content = yield* fs.readFileString(graphFile).pipe(PersistenceError.refail);
        const graph = yield* Schema.decodeUnknownEffect(Graph.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
        const updatedGraph = new Graph.Model({
          ...graph,
          nodes: { ...graph.nodes, [node.id]: node },
        });
        yield* fs
          .writeFileString(graphFile, JSON.stringify(updatedGraph, null, 2))
          .pipe(PersistenceError.refail);
      }, lock.withPermit);

      const deleteNode = Effect.fnUntraced(function* (graphId: string, nodeId: string) {
        const graphFile = graphFilePath(graphId);
        const content = yield* fs.readFileString(graphFile).pipe(PersistenceError.refail);
        const graph = yield* Schema.decodeUnknownEffect(Graph.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
        const { [nodeId]: _, ...nodes } = graph.nodes;
        const updatedGraph = new Graph.Model({ ...graph, nodes });
        yield* fs
          .writeFileString(graphFile, JSON.stringify(updatedGraph, null, 2))
          .pipe(PersistenceError.refail);
      }, lock.withPermit);

      const saveConnection = Effect.fnUntraced(function* (
        graphId: string,
        connection: Connection.Model,
      ) {
        const graphFile = graphFilePath(graphId);
        const content = yield* fs.readFileString(graphFile).pipe(PersistenceError.refail);
        const graph = yield* Schema.decodeUnknownEffect(Graph.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
        const updatedGraph = new Graph.Model({
          ...graph,
          connections: [...graph.connections, connection],
        });
        yield* fs
          .writeFileString(graphFile, JSON.stringify(updatedGraph, null, 2))
          .pipe(PersistenceError.refail);
      }, lock.withPermit);

      const deleteConnection = Effect.fnUntraced(function* (graphId: string, connectionId: string) {
        const graphFile = graphFilePath(graphId);
        const content = yield* fs.readFileString(graphFile).pipe(PersistenceError.refail);
        const graph = yield* Schema.decodeUnknownEffect(Graph.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
        const connections = graph.connections.filter((c) => c.id !== connectionId);
        const updatedGraph = new Graph.Model({ ...graph, connections });
        yield* fs
          .writeFileString(graphFile, JSON.stringify(updatedGraph, null, 2))
          .pipe(PersistenceError.refail);
      }, lock.withPermit);

      return Persistence.Service.of({
        saveProject,
        loadProject,
        loadGraph,
        loadNode,
        // deleteProject,
        saveGraph,
        deleteGraph,
        saveNode,
        deleteNode,
        saveConnection,
        deleteConnection,
      });
    }),
  );

export * as JsonPersistence from "./JsonPersistence.ts";
