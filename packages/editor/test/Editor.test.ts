import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Graph, Node, Package, PackageId, Position, Project, SchemaId, SchemaRef } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer, PubSub } from "effect";

import { Editor, Packages, ProjectPubSub } from "../src/index";

const schemaRef = new SchemaRef({
  package: PackageId.make("pkg"),
  schema: SchemaId.make("schema"),
});

const TestPackage = new Package.Model({
  id: PackageId.make("pkg"),
  name: "Test",
  schemas: [new Package.SchemaModel({ id: SchemaId.make("schema"), name: "Schema" })],
});

const PackagesLayer = Layer.effect(
  Packages.Service,
  Effect.gen(function* () {
    const packages = yield* Packages.Service;
    yield* packages.loadPackage(TestPackage);
    return packages;
  }),
).pipe(Layer.provide(Packages.defaultLayer));

const SeedLayer = Layer.effectDiscard(
  Effect.flatMap(Persistence.Service, (db) =>
    db.saveProject(
      new Project.Model({
        name: "test",
        graphs: {},
      }),
    ),
  ),
);

const TestLayer = Editor.defaultLayer.pipe(
  Layer.provide(SeedLayer),
  Layer.provideMerge(PackagesLayer),
  Layer.provideMerge(Layer.mergeAll(Persistence.layerMemory, ProjectPubSub.defaultLayer)),
  Layer.provide(NodeServices.layer),
);

const makeEventPull = ProjectPubSub.Service.pipe(Effect.flatMap((p) => p.subscribe));

it.layer(TestLayer)((it) => {
  describe("Editor", () => {
    it.effect("createGraph publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const event = yield* editor.createGraph(new Graph.CreateInput({ name: "Test Graph" }));

        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("deleteGraph publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.createGraph(new Graph.CreateInput({ name: "Test Graph" }));
        yield* PubSub.take(events);

        const event = yield* editor.deleteGraph(graphEvent.graphId);
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("createNode publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.createGraph(new Graph.CreateInput({ name: "Test Graph" }));
        yield* PubSub.take(events);

        const event = yield* editor.createNode(
          graphEvent.graphId,
          new Node.CreateInput({
            name: "Test Node",
            position: new Position({ x: 100, y: 200 }),
            schema: schemaRef,
          }),
        );
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("deleteNode publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.createGraph(new Graph.CreateInput({ name: "Test Graph" }));
        yield* PubSub.take(events);

        const nodeEvent = yield* editor.createNode(
          graphEvent.graphId,
          new Node.CreateInput({ name: "Node", schema: schemaRef }),
        );
        yield* PubSub.take(events);

        const event = yield* editor.deleteNode(graphEvent.graphId, nodeEvent.nodeId);
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("setNodeName publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.createGraph(new Graph.CreateInput({ name: "Test Graph" }));
        yield* PubSub.take(events);

        const nodeEvent = yield* editor.createNode(
          graphEvent.graphId,
          new Node.CreateInput({ name: "Old Name", schema: schemaRef }),
        );
        yield* PubSub.take(events);

        const event = yield* editor.setNodeName(graphEvent.graphId, nodeEvent.nodeId, "New Name");
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("setNodePosition publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.createGraph(new Graph.CreateInput({ name: "Test Graph" }));
        yield* PubSub.take(events);

        const nodeEvent = yield* editor.createNode(
          graphEvent.graphId,
          new Node.CreateInput({ name: "Node", schema: schemaRef }),
        );
        yield* PubSub.take(events);

        const event = yield* editor.setNodePosition(graphEvent.graphId, nodeEvent.nodeId, 300, 400);
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );
  });
});
