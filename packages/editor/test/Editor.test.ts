import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { PackageId, SchemaId } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer, PubSub } from "effect";

import { Editor, Packages, ProjectPubSub } from "../src/index";

const schemaRef = {
  package: PackageId.make("pkg"),
  schema: SchemaId.make("schema"),
};

const TestPackage = {
  id: PackageId.make("pkg"),
  name: "Test",
  schemas: [{ id: SchemaId.make("schema"), name: "Schema" }],
};

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
    db.saveProject({
      name: "test",
      graphs: {},
    }),
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

        const event = yield* editor.graph.create({ name: "Test Graph" });

        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("deleteGraph publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);

        const event = yield* editor.graph.delete({ graphID: graphEvent.graph.id });
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("createNode publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);

        const event = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: {
            name: "Test Node",
            position: { x: 100, y: 200 },
            schema: schemaRef,
          },
        });
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("deleteNode publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);

        const nodeEvent = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: { name: "Node", schema: schemaRef },
        });
        yield* PubSub.take(events);

        const event = yield* editor.node.delete({
          graphID: graphEvent.graph.id,
          nodeID: nodeEvent.node.id,
        });
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("setNodeName publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);

        const nodeEvent = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: { name: "Old Name", schema: schemaRef },
        });
        yield* PubSub.take(events);

        yield* editor.node.update({
          graphID: graphEvent.graph.id,
          nodeID: nodeEvent.node.id,
          name: "New Name",
        });
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual({
          _tag: "NodeNameChanged",
          graphId: graphEvent.graph.id,
          nodeId: nodeEvent.node.id,
          name: "New Name",
        });
      }),
    );

    it.effect("setNodePosition publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);

        const nodeEvent = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: { name: "Node", schema: schemaRef },
        });
        yield* PubSub.take(events);

        yield* editor.node.update({
          graphID: graphEvent.graph.id,
          nodeID: nodeEvent.node.id,
          position: { x: 300, y: 400 },
        });
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual({
          _tag: "NodePositionChanged",
          graphId: graphEvent.graph.id,
          nodeId: nodeEvent.node.id,
          x: 300,
          y: 400,
        });
      }),
    );

    it.effect("updates a graph", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const graphEvent = yield* editor.graph.create({ name: "Old Name" });

        yield* editor.graph.update({ graphID: graphEvent.graph.id, name: "New Name" });

        const project = yield* editor.project.get();
        expect(project.graphs[graphEvent.graph.id]?.name).toBe("New Name");
      }),
    );

    it.effect("registers plugin schemas", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const packages = yield* Packages.Service;

        yield* editor.plugin({
          id: "plugin",
          name: "Plugin",
          effect: (context) =>
            context.schema.register({
              id: "schema",
              name: "Schema",
              io: () => ({}),
              run: () => Effect.void,
            }),
        });

        const schema = yield* packages.getSchema({
          package: PackageId.make("plugin"),
          schema: SchemaId.make("schema"),
        });
        expect(schema.name).toBe("Schema");
      }),
    );
  });
});
