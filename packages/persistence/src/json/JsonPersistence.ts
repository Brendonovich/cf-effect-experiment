import {
  Canvas,
  Connection,
  Function as GraphFunction,
  Graph,
  Node,
  Project,
  Queue,
  ResourceConstant,
  TypeDefinition,
} from "@macrograph/core";
import { Effect, FileSystem, Layer, Path, Schema, Semaphore } from "effect";

import { Persistence, PersistenceError } from "../Persistence.ts";

const FunctionMetadata = Schema.Union([
  Schema.Struct({
    arguments: Schema.Array(GraphFunction.Field),
    returns: Schema.Array(GraphFunction.Field),
    inputPosition: GraphFunction.Model.fields.inputPosition,
    outputPosition: GraphFunction.Model.fields.outputPosition,
  }),
  Schema.Struct({
    graphId: Schema.String,
    inputs: Schema.Array(GraphFunction.Field),
    outputs: Schema.Array(GraphFunction.Field),
    inputPosition: GraphFunction.Model.fields.inputPosition,
    outputPosition: GraphFunction.Model.fields.outputPosition,
  }),
]);
const QueueMetadata = Schema.Struct({
  arguments: Schema.Array(Queue.Field),
  returns: Schema.Array(Queue.Field),
  inputPosition: Queue.Model.fields.inputPosition,
  outputPosition: Queue.Model.fields.outputPosition,
});

const ProjectMeta = Schema.Struct({
  name: Schema.String,
  engines: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
  constants: Schema.optional(ResourceConstant.Collection),
  types: Schema.optional(TypeDefinition.Collection),
  functions: Schema.optional(Schema.Record(Schema.String, FunctionMetadata)),
  queues: Schema.Record(Schema.String, QueueMetadata).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
});

export const layer = (dir: string) =>
  Layer.effect(Persistence.Service)(
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
          .writeFileString(
            projectFilePath,
            JSON.stringify(
              {
                name: project.name,
                engines: project.engines,
                constants: project.constants,
                queues: Object.fromEntries(
                  Object.entries(project.queues).map(([id, queue]) => [
                    id,
                    {
                      arguments: queue.arguments,
                      returns: queue.returns,
                      inputPosition: queue.inputPosition,
                      outputPosition: queue.outputPosition,
                    },
                  ]),
                ),
                types: project.types,
                functions: Object.fromEntries(
                  Object.entries(project.functions).map(([id, fn]) => [
                    id,
                    {
                      arguments: fn.arguments,
                      returns: fn.returns,
                      inputPosition: fn.inputPosition,
                      outputPosition: fn.outputPosition,
                    },
                  ]),
                ),
              },
              null,
              2,
            ),
          )
          .pipe(PersistenceError.refail);

        for (const [graphId, graph] of Object.entries(Project.canvases(project))) {
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
        const functions: Record<string, GraphFunction.Model> = {};
        const queues: Record<string, Queue.Model> = {};
        const graphsExist = yield* fs.exists(graphsDir).pipe(PersistenceError.refail);
        if (graphsExist) {
          const graphFiles = yield* fs.readDirectory(graphsDir).pipe(PersistenceError.refail);
          for (const file of graphFiles) {
            if (!file.endsWith(".json")) continue;
            const graphId = file.slice(0, -5);
            const content = yield* fs
              .readFileString(graphFilePath(graphId))
              .pipe(PersistenceError.refail);
            const canvas = yield* Schema.decodeUnknownEffect(Canvas.Model)(
              JSON.parse(content),
            ).pipe(PersistenceError.refail);
            const metadata = meta.functions?.[graphId];
            const queueMetadata = meta.queues[graphId];
            if (metadata !== undefined)
              functions[graphId] = {
                canvas,
                arguments: "arguments" in metadata ? metadata.arguments : metadata.inputs,
                returns: "returns" in metadata ? metadata.returns : metadata.outputs,
                inputPosition: metadata.inputPosition,
                outputPosition: metadata.outputPosition,
              };
            else if (queueMetadata !== undefined) queues[graphId] = { canvas, ...queueMetadata };
            else graphs[graphId] = { canvas };
          }
        }

        return {
          // id: ProjectId.make(meta.id),
          name: meta.name,
          graphs,
          functions,
          engines: meta.engines ?? {},
          constants: meta.constants ?? {},
          queues,
          types: meta.types ?? {},
        };
      }, lock.withPermit);

      const loadGraph = Effect.fnUntraced(function* (graphId: string) {
        const exists = yield* fs.exists(graphFilePath(graphId)).pipe(PersistenceError.refail);
        if (!exists) return yield* new Graph.NotFoundError({ id: graphId });

        const content = yield* fs
          .readFileString(graphFilePath(graphId))
          .pipe(PersistenceError.refail);
        return yield* Schema.decodeUnknownEffect(Canvas.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
      }, lock.withPermit);

      const loadNode = Effect.fnUntraced(function* (graphId: string, nodeId: string) {
        const exists = yield* fs.exists(graphFilePath(graphId)).pipe(PersistenceError.refail);
        if (!exists) return yield* new Node.NotFoundError({ id: nodeId });

        const content = yield* fs
          .readFileString(graphFilePath(graphId))
          .pipe(PersistenceError.refail);
        const graph = yield* Schema.decodeUnknownEffect(Canvas.Model)(JSON.parse(content)).pipe(
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

      const saveGraph = Effect.fnUntraced(function* (graph: Canvas.Model) {
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
        const graph = yield* Schema.decodeUnknownEffect(Canvas.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
        const updatedGraph = {
          ...graph,
          nodes: { ...graph.nodes, [node.id]: node },
        };
        yield* fs
          .writeFileString(graphFile, JSON.stringify(updatedGraph, null, 2))
          .pipe(PersistenceError.refail);
      }, lock.withPermit);

      const deleteNode = Effect.fnUntraced(function* (graphId: string, nodeId: string) {
        const graphFile = graphFilePath(graphId);
        const content = yield* fs.readFileString(graphFile).pipe(PersistenceError.refail);
        const graph = yield* Schema.decodeUnknownEffect(Canvas.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
        const { [nodeId]: _, ...nodes } = graph.nodes;
        const updatedGraph = { ...graph, nodes };
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
        const graph = yield* Schema.decodeUnknownEffect(Canvas.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
        const updatedGraph = {
          ...graph,
          connections: [...graph.connections, connection],
        };
        yield* fs
          .writeFileString(graphFile, JSON.stringify(updatedGraph, null, 2))
          .pipe(PersistenceError.refail);
      }, lock.withPermit);

      const deleteConnection = Effect.fnUntraced(function* (graphId: string, connectionId: string) {
        const graphFile = graphFilePath(graphId);
        const content = yield* fs.readFileString(graphFile).pipe(PersistenceError.refail);
        const graph = yield* Schema.decodeUnknownEffect(Canvas.Model)(JSON.parse(content)).pipe(
          PersistenceError.refail,
        );
        const connections = graph.connections.filter((c) => c.id !== connectionId);
        const updatedGraph = { ...graph, connections };
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
