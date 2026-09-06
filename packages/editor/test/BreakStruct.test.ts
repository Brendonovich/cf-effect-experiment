import { expect, it } from "@effect/vitest";
import {
  CustomTypes,
  Graph,
  IoId,
  NodeId,
  OutputRef,
  PackageId,
  Project,
  SchemaId,
  Wildcards,
} from "@macrograph/core";
import { DataType as t, Module } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer, Result } from "effect";

import { Editor, Packages } from "../src/index.ts";

const childId = t.DefinitionId.make("child"),
  rootId = t.DefinitionId.make("root");
const definitions: t.Definitions = {
  child: { _tag: "Struct", id: childId, name: "Child", fields: [{ name: "text", type: t.String }] },
  root: {
    _tag: "Struct",
    id: rootId,
    name: "Root",
    fields: [{ name: "child", type: t.Custom(childId) }],
  },
};
const TestLayer = Editor.defaultLayer.pipe(
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
);
const setup = Effect.gen(function* () {
  yield* (yield* Persistence.Service).saveProject({
    ...Project.empty(),
    types: definitions,
    graphs: { graph: Graph.empty("graph") },
  });
  const editor = yield* Editor.Service;
  yield* editor.project.get();
  const create = (schema: string, properties = {}) =>
    editor.node.create({
      graphID: "graph",
      node: {
        schema: { package: CustomTypes.packageId, schema: SchemaId.make(schema) },
        properties,
      },
    });
  const root = yield* create("MakeStruct", { type: rootId });
  const first = yield* create("BreakStruct");
  const second = yield* create("BreakStruct");
  const connect = (from: string, out: string, to: string, input = "value") =>
    editor.connection.create({
      graphID: "graph",
      connection: {
        outNodeId: from,
        outIo: OutputRef.port(out),
        inNodeId: to,
        inIoId: IoId.make(input),
      },
    });
  return { editor, root, first, second, connect };
});

it.effect("infers chained Break fields, snapshots and pastes them without a target property", () =>
  Effect.gen(function* () {
    const { editor, root, first, second, connect } = yield* setup;
    expect(first.node.properties).toEqual({});
    expect(first.io.dataInputs[0]!.type).toEqual(CustomTypes.breakWildcard);
    expect(first.io.dataOutputs).toEqual([]);
    expect(
      CustomTypes.packageModel.schemas.find((schema) => schema.id === "BreakStruct")!.properties,
    ).toEqual([]);
    const anchor = yield* connect(root.node.id, "value", first.node.id);
    const bridge = yield* connect(first.node.id, 'field:"child"', second.node.id);
    const rendered = yield* editor.project.rendered();
    expect(rendered.graphs.graph!.nodes[second.node.id]!.io.dataOutputs).toEqual([
      { id: 'field:"text"', name: "text", type: t.String },
    ]);
    const snapshot = yield* editor.project.snapshot();
    expect(snapshot.nodeIO.graph![first.node.id]!.dataInputs[0]!.type).toEqual(
      CustomTypes.breakWildcard,
    );
    expect(snapshot.nodeIO.graph![second.node.id]!.dataOutputs).toEqual(
      rendered.graphs.graph!.nodes[second.node.id]!.io.dataOutputs,
    );
    const pasted = yield* editor.fragment.paste({
      graphID: "graph",
      position: { x: 50, y: 50 },
      text: JSON.stringify({
        format: "macrograph/nodes",
        version: 1,
        nodes: [root.node, first.node, second.node],
        connections: [bridge.connection, anchor.connection],
      }),
    });
    expect(
      pasted.nodes
        .filter(CustomTypes.isBreakStruct)
        .every((node) => Object.keys(node.properties).length === 0),
    ).toBe(true);
    expect(pasted.connections).toHaveLength(2);
    yield* editor.connection.delete({ graphID: "graph", connectionId: anchor.connection.id });
    const detached = yield* editor.project.rendered();
    expect(detached.graphs.graph!.nodes[first.node.id]!.io.dataOutputs).toEqual([]);
    expect(detached.graphs.graph!.nodes[second.node.id]!.io.dataOutputs).toEqual([]);
    yield* connect(root.node.id, "value", first.node.id);
    expect(
      (yield* editor.project.rendered()).graphs.graph!.nodes[second.node.id]!.io.dataOutputs[0]!
        .type,
    ).toEqual(t.String);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("rejects non-struct input connections and reacts to changed definitions", () =>
  Effect.gen(function* () {
    const { editor, root, first, connect } = yield* setup;
    yield* editor.module(
      Module.make({
        id: "test",
        effect: (context) =>
          context.schema.register({
            id: "string",
            type: "pure",
            io: (io) => ({ out: io.data.out("out", t.String) }),
            run: () => Effect.void,
          }),
      }),
    );
    const source = yield* editor.node.create({
      graphID: "graph",
      node: { schema: { package: PackageId.make("test"), schema: SchemaId.make("string") } },
    });
    expect((yield* Effect.flip(connect(source.node.id, "out", first.node.id)))._tag).toBe(
      "InvalidConnectionError",
    );
    yield* connect(root.node.id, "value", first.node.id);
    const change = yield* editor.typeDefinition.preview({
      _tag: "Upsert",
      definition: {
        _tag: "Struct",
        id: rootId,
        name: "Root",
        fields: [{ name: "count", type: t.Int }],
      },
    });
    yield* editor.typeDefinition.confirm({ token: change.token });
    expect(
      (yield* editor.project.rendered()).graphs.graph!.nodes[first.node.id]!.io.dataOutputs,
    ).toEqual([{ id: 'field:"count"', name: "count", type: t.Int }]);
  }).pipe(Effect.provide(TestLayer)),
);

it("commits derived groups only after a whole Break chain stabilizes and reuses unchanged groups", () => {
  const graph = {
    ...Graph.empty("graph"),
    nodes: Object.fromEntries(
      ["a", "b"].map((id) => [
        id,
        {
          id: NodeId.make(id),
          name: id,
          schema: { package: CustomTypes.packageId, schema: SchemaId.make("BreakStruct") },
          properties: {},
          inputDefaults: {},
          foldPins: false,
          position: { x: 0, y: 0 },
        },
      ]),
    ),
  };
  const cache = new Wildcards.Cache();
  const declarations = new Map(
    Object.values(graph.nodes).map((node) => [
      node.id,
      CustomTypes.nodeIO(node.schema, {}, definitions)!,
    ]),
  );
  const derive = CustomTypes.derivedOutputs(graph, definitions);
  expect(Result.isSuccess(cache.update(declarations, [], derive))).toBe(true);
  const first = cache.group("a");
  cache.update(declarations, [], derive);
  expect(cache.group("a")).toBe(first);
  expect(cache.derivedOutputs("a")).toEqual([]);
});
