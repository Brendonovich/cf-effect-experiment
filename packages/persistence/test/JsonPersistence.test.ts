import { NodePath } from "@effect/platform-node";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  Graph,
  GraphId,
  Node,
  NodeId,
  PackageId,
  Position,
  Project,
  SchemaId,
  SchemaRef,
} from "@macrograph/core";
import { Effect, Layer } from "effect";

import { JsonPersistence, Persistence } from "../src/index";
import { MemoryFileSystem } from "./MemoryFileSystem";

const schema = new SchemaRef({
  package: PackageId.make("pkg"),
  schema: SchemaId.make("schema"),
});

const TestLayer = Layer.provideMerge(
  JsonPersistence.layer("/test-project"),
  Layer.mergeAll(MemoryFileSystem.layerMemory, NodePath.layer),
);

describe("JsonPersistence", () => {
  it.effect("saveProject then loadProject", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;

      const graph = new Graph.Model({
        id: GraphId.make("graph-1"),
        name: "My Graph",
        nodes: {},
        connections: [],
      });
      const project = new Project.Model({
        name: "My Project",
        graphs: { "graph-1": graph },
      });
      yield* persistence.saveProject(project);

      const loaded = yield* persistence.loadProject();
      assert.strictEqual(loaded.name, "My Project");
      assert.ok(loaded.graphs["graph-1"]);
      assert.strictEqual(loaded.graphs["graph-1"].name, "My Graph");
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

      const project = new Project.Model({
        name: "Empty",
        graphs: {},
      });
      yield* persistence.saveProject(project);

      const graph = new Graph.Model({
        id: GraphId.make("graph-2"),
        name: "Second Graph",
        nodes: {},
        connections: [],
      });
      yield* persistence.saveGraph(graph);

      const loaded = yield* persistence.loadProject();
      assert.ok(loaded.graphs["graph-2"]);
      assert.strictEqual(loaded.graphs["graph-2"].name, "Second Graph");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("saveNode updates a node in an existing graph", () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;

      const graph = new Graph.Model({
        id: GraphId.make("graph-1"),
        name: "G",
        nodes: {},
        connections: [],
      });
      const project = new Project.Model({
        name: "P",
        graphs: { "graph-1": graph },
      });
      yield* persistence.saveProject(project);

      const node = new Node.Model({
        id: NodeId.make("n1"),
        name: "original",
        position: new Position({ x: 0, y: 0 }),
        properties: {},
        schema,
      });
      yield* persistence.saveNode("graph-1", node);

      const updatedNode = new Node.Model({ ...node, name: "updated" });
      yield* persistence.saveNode("graph-1", updatedNode);

      const loaded = yield* persistence.loadProject();
      expect(loaded.graphs["graph-1"]?.nodes["n1"]?.name).toBe("updated");
    }).pipe(Effect.provide(TestLayer)),
  );

  // it.effect("deleteProject removes all data", () =>
  //   Effect.gen(function* () {
  //     const persistence = yield* Persistence.Service;

  //     const graph = new Graph.Model({
  //       id: GraphId.make("graph-1"),
  //       name: "G",
  //       nodes: {},
  //       connections: [],
  //     });
  //     const project = new Project.Model({
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

      const node = new Node.Model({
        id: NodeId.make("test-node"),
        name: "Test Node",
        position: new Position({ x: 42, y: 99 }),
        properties: { foo: "bar", count: 3 },
        schema: new SchemaRef({
          package: PackageId.make("my-pkg"),
          schema: SchemaId.make("my-schema"),
        }),
      });
      const graph = new Graph.Model({
        id: GraphId.make("graph-1"),
        name: "G",
        nodes: { "test-node": node },
        connections: [],
      });
      const project = new Project.Model({
        name: "P",
        graphs: { "graph-1": graph },
      });
      yield* persistence.saveProject(project);

      const loaded = yield* persistence.loadProject();
      const loadedNode = loaded.graphs["graph-1"]?.nodes["test-node"];
      assert(loadedNode !== undefined);

      expect(loadedNode.name).toBe("Test Node");
      expect(loadedNode.position.x).toBe(42);
      expect(loadedNode.position.y).toBe(99);
      expect(loadedNode.properties).toEqual({ foo: "bar", count: 3 });
      expect(loadedNode.schema.package).toBe("my-pkg");
      expect(loadedNode.schema.schema).toBe("my-schema");
    }).pipe(Effect.provide(TestLayer)),
  );
});
