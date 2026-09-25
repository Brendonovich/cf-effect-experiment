import { describe, expect, it } from "@effect/vitest";
import {
  ConnectionId,
  Graph,
  GraphId,
  IoId,
  Node,
  NodeId,
  OutputRef,
  PackageId,
  Project,
  Queue,
  SchemaId,
} from "@macrograph/core";
import { Effect, Layer } from "effect";

import { Persistence } from "../src/index.ts";

const node = (id: string, name = id): Node.Model => ({
  id: NodeId.make(id),
  name,
  position: { x: 10, y: 20 },
  properties: { message: "hello" },
  inputDefaults: { value: 42 },
  foldPins: true,
  schema: {
    package: PackageId.make("contract-package"),
    schema: SchemaId.make("contract-schema"),
  },
});

const emptyProject = (): Project.Model => ({
  name: "Contract Project",
  graphs: {},
  functions: {},
  engines: {},
  constants: {},
  types: {},
  queues: {},
});

export const persistenceContract = <E>(
  name: string,
  layer: Layer.Layer<Persistence.Service, E, never>,
) => {
  const run = <A, Error>(effect: Effect.Effect<A, Error, Persistence.Service>) =>
    effect.pipe(Effect.provide(layer));

  describe(name, () => {
    it.effect("reports missing projects, graphs, and nodes", () =>
      run(
        Effect.gen(function* () {
          const persistence = yield* Persistence.Service;
          expect(yield* Effect.flip(persistence.loadProject())).toBeInstanceOf(
            Project.NotFoundError,
          );
          expect(yield* Effect.flip(persistence.loadGraph("missing"))).toBeInstanceOf(
            Graph.NotFoundError,
          );
          expect(yield* Effect.flip(persistence.loadNode("missing", "node"))).toBeInstanceOf(
            Node.NotFoundError,
          );
        }),
      ),
    );

    it.effect("round-trips a complete project", () =>
      run(
        Effect.gen(function* () {
          const persistence = yield* Persistence.Service;
          const firstNode = node("first", "First");
          const secondNode = node("second", "Second");
          const connection = {
            id: ConnectionId.make("connection"),
            outNodeId: firstNode.id,
            outIo: OutputRef.port("output"),
            inNodeId: secondNode.id,
            inIoId: IoId.make("input"),
          };
          const canvas = {
            id: GraphId.make("project-graph"),
            name: "Project Graph",
            nodes: { first: firstNode, second: secondNode },
            connections: [connection],
          };
          const functionCanvas = {
            id: GraphId.make("project-function"),
            name: "Project Function",
            nodes: {},
            connections: [],
          };
          const project: Project.Model = {
            ...emptyProject(),
            graphs: { [canvas.id]: { canvas } },
            functions: {
              [functionCanvas.id]: {
                canvas: functionCanvas,
                arguments: [],
                returns: [],
                inputPosition: { x: -100, y: 0 },
                outputPosition: { x: 100, y: 0 },
              },
            },
            engines: { example: { enabled: true } },
            queues: {
              work: {
                id: Queue.QueueId.make("work"),
                name: "Work",
              },
            },
          };

          yield* persistence.saveProject(project);
          expect(yield* persistence.loadProject()).toEqual(project);
          expect(yield* persistence.loadGraph(canvas.id)).toEqual(canvas);
          expect(yield* persistence.loadGraph(functionCanvas.id)).toEqual(functionCanvas);
          expect(yield* persistence.loadNode(canvas.id, firstNode.id)).toEqual(firstNode);
        }),
      ),
    );

    it.effect("supports incremental graph, node, and connection writes and deletes", () =>
      run(
        Effect.gen(function* () {
          const persistence = yield* Persistence.Service;
          yield* persistence.saveProject(emptyProject());

          const firstNode = node("first");
          const graph = {
            id: GraphId.make("incremental-graph"),
            name: "Incremental Graph",
            nodes: { first: firstNode },
            connections: [],
          };
          yield* persistence.saveGraph(graph);
          expect(yield* persistence.loadGraph(graph.id)).toEqual(graph);

          const secondNode = node("second");
          yield* persistence.saveNode(graph.id, secondNode);
          expect(yield* persistence.loadNode(graph.id, secondNode.id)).toEqual(secondNode);

          const connection = {
            id: ConnectionId.make("incremental-connection"),
            outNodeId: firstNode.id,
            outIo: OutputRef.port("output"),
            inNodeId: secondNode.id,
            inIoId: IoId.make("input"),
          };
          yield* persistence.saveConnection(graph.id, connection);
          expect((yield* persistence.loadGraph(graph.id)).connections).toEqual([connection]);

          yield* persistence.deleteConnection(graph.id, connection.id);
          expect((yield* persistence.loadGraph(graph.id)).connections).toEqual([]);
          yield* persistence.deleteNode(graph.id, secondNode.id);
          expect(yield* Effect.flip(persistence.loadNode(graph.id, secondNode.id))).toBeInstanceOf(
            Node.NotFoundError,
          );
          yield* persistence.deleteGraph(graph.id);
          expect(yield* Effect.flip(persistence.loadGraph(graph.id))).toBeInstanceOf(
            Graph.NotFoundError,
          );
        }),
      ),
    );
  });
};
