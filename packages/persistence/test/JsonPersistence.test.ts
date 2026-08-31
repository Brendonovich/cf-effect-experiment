import { NodePath } from "@effect/platform-node";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  FunctionGraph,
  Graph,
  GraphId,
  Node,
  NodeId,
  PackageId,
  Project,
  SchemaId,
} from "@macrograph/core";
import { Effect, Layer, Schema } from "effect";

import { JsonPersistence, Persistence } from "../src/index";
import { MemoryFileSystem } from "./MemoryFileSystem";

const schema = {
  package: PackageId.make("pkg"),
  schema: SchemaId.make("schema"),
};

const TestLayer = Layer.provideMerge(
  JsonPersistence.layer("/test-project"),
  Layer.mergeAll(MemoryFileSystem.layerMemory, NodePath.layer),
);

describe("JsonPersistence", () => {
  it.effect("round-trips function kind, ordered signature, and stable boundary IDs", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;
      const graph = FunctionGraph.generate(
        {
          ...Graph.empty("function"),
          kind: "function",
          signature: {
            inputs: [{ id: "stable", name: "Value", type: { _tag: "String" } }],
            outputs: [],
          },
        },
        () => crypto.randomUUID(),
      );
      yield* persistence.saveProject({ ...Project.empty(), graphs: { function: graph } });
      expect((yield* persistence.loadProject()).graphs.function).toEqual(graph);
      yield* persistence.saveGraph({ ...graph, name: "Renamed" });
      expect((yield* persistence.loadGraph(graph.id)).signature).toEqual(graph.signature);
      const legacy = Schema.decodeUnknownSync(Graph.Model)({
        id: "legacy",
        name: "Legacy",
        nodes: {},
        connections: [],
      });
      expect(legacy.kind ?? "ordinary").toBe("ordinary");
    }).pipe(Effect.provide(TestLayer)),
  );
  it.effect("decodes projects written before resource constants were introduced", () =>
    Effect.gen(function* () {
      const project = yield* Schema.decodeUnknownEffect(Project.Model)({
        name: "Legacy",
        graphs: {},
        engines: {},
      });
      expect(project.constants).toEqual({});
    }),
  );

  it.effect("decodes nodes written before input defaults and folding were introduced", () =>
    Effect.gen(function* () {
      const node = yield* Schema.decodeUnknownEffect(Node.Model)({
        id: "legacy",
        name: "Legacy",
        properties: {},
        schema: { package: "pkg", schema: "schema" },
        position: { x: 0, y: 0 },
      });
      expect(node.inputDefaults).toEqual({});
      expect(node.foldPins).toBe(false);
    }),
  );

  it.effect("saveProject then loadProject", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;

      const graph = {
        id: GraphId.make("graph-1"),
        name: "My Graph",
        nodes: {},
        connections: [],
      };
      const project = {
        name: "My Project",
        graphs: { "graph-1": graph },
        engines: { twitch: { accounts: { one: { subscriptions: ["channel.ban"] } } } },
        constants: {},
      };
      yield* persistence.saveProject(project);

      const loaded = yield* persistence.loadProject();
      assert.strictEqual(loaded.name, "My Project");
      assert.ok(loaded.graphs["graph-1"]);
      assert.strictEqual(loaded.graphs["graph-1"].name, "My Graph");
      assert.deepStrictEqual(loaded.engines, project.engines);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("loadProject returns NotFoundError when missing", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;
      const result = yield* Effect.flip(persistence.loadProject());
      assert.ok(result instanceof Project.NotFoundError);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("saveGraph persists and is visible on loadProject", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;

      const project = {
        name: "Empty",
        graphs: {},
        engines: {},
        constants: {},
      };
      yield* persistence.saveProject(project);

      const graph = {
        id: GraphId.make("graph-2"),
        name: "Second Graph",
        nodes: {},
        connections: [],
      };
      yield* persistence.saveGraph(graph);

      const loaded = yield* persistence.loadProject();
      assert.ok(loaded.graphs["graph-2"]);
      assert.strictEqual(loaded.graphs["graph-2"].name, "Second Graph");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("saveNode updates a node in an existing graph", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;

      const graph = {
        id: GraphId.make("graph-1"),
        name: "G",
        nodes: {},
        connections: [],
      };
      const project = {
        name: "P",
        graphs: { "graph-1": graph },
        engines: {},
        constants: {},
      };
      yield* persistence.saveProject(project);

      const node = {
        id: NodeId.make("n1"),
        name: "original",
        position: { x: 0, y: 0 },
        properties: {},
        inputDefaults: {},
        foldPins: false,
        schema,
      };
      yield* persistence.saveNode("graph-1", node);

      const updatedNode = { ...node, name: "updated" };
      yield* persistence.saveNode("graph-1", updatedNode);

      const loaded = yield* persistence.loadProject();
      expect(loaded.graphs["graph-1"]?.nodes["n1"]?.name).toBe("updated");
    }).pipe(Effect.provide(TestLayer)),
  );

  // it.effect("deleteProject removes all data", () =>
  //   Effect.gen(function* () {
  //     const persistence = yield* Persistence.Service;

  //     const graph = ({
  //       id: GraphId.make("graph-1"),
  //       name: "G",
  //       nodes: {},
  //       connections: [],
  //     });
  //     const project = ({
  //       id: projectId,
  //       name: "P",
  //       graphs: { "graph-1": graph },
  //     });
  //     yield* persistence.saveProject(project);

  //     yield* persistence.deleteProject();

  //     const result = yield* Effect.flip(persistence.loadProject());
  //     assert.ok(result instanceof Project.NotFoundError);
  //   }).pipe(Effect.provide(TestLayer)),
  // );

  it.effect("round-trips node schemas and positions", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;

      const node = {
        id: NodeId.make("test-node"),
        name: "Test Node",
        position: { x: 42, y: 99 },
        properties: { foo: "bar", count: 3 },
        inputDefaults: { message: "hello" },
        foldPins: true,
        schema: {
          package: PackageId.make("my-pkg"),
          schema: SchemaId.make("my-schema"),
        },
      };
      const graph = {
        id: GraphId.make("graph-1"),
        name: "G",
        nodes: { "test-node": node },
        connections: [],
      };
      const project = {
        name: "P",
        graphs: { "graph-1": graph },
        engines: {},
        constants: {},
      };
      yield* persistence.saveProject(project);

      const loaded = yield* persistence.loadProject();
      const loadedNode = loaded.graphs["graph-1"]?.nodes["test-node"];
      assert(loadedNode !== undefined);

      expect(loadedNode.name).toBe("Test Node");
      expect(loadedNode.position.x).toBe(42);
      expect(loadedNode.position.y).toBe(99);
      expect(loadedNode.properties).toEqual({ foo: "bar", count: 3 });
      expect(loadedNode.inputDefaults).toEqual({ message: "hello" });
      expect(loadedNode.foldPins).toBe(true);
      expect(loadedNode.schema.package).toBe("my-pkg");
      expect(loadedNode.schema.schema).toBe("my-schema");
    }).pipe(Effect.provide(TestLayer)),
  );
});
