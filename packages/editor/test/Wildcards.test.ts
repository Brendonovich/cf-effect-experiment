import { expect, it } from "@effect/vitest";
import { Graph, IoId, OutputRef, PackageId, Project, SchemaId } from "@macrograph/core";
import { DataType, Module } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";

import { Editor, Packages } from "../src/index.ts";

const TestLayer = Editor.defaultLayer.pipe(
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
);
const module = Module.make({
  id: "wildcard-test",
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "identity",
      type: "pure",
      io: (io) => {
        const type = io.wildcard("T");
        return {
          input: io.data.in("in", type),
          other: io.data.in("other", type),
          output: io.data.out("out", type),
        };
      },
      run: ({ io }) => Effect.sync(() => io.output(io.input)),
    });
    yield* context.schema.register({
      id: "anchor",
      type: "pure",
      properties: { integer: { name: "Integer", type: DataType.Bool, defaultValue: false } },
      io: (io, properties) => ({
        output: io.data.out("out", properties.integer ? DataType.Int : DataType.String),
      }),
      run: () => Effect.void,
    });
  }),
});
const setup = Effect.gen(function* () {
  yield* (yield* Persistence.Service).saveProject({
    ...Project.empty(),
    graphs: { graph: Graph.empty("graph") },
  });
  const editor = yield* Editor.Service;
  yield* editor.module(module);
  const create = (schema: string) =>
    editor.node.create({
      graphID: "graph",
      node: {
        schema: { package: PackageId.make(module.id), schema: SchemaId.make(schema) },
      },
    });
  const a = (yield* create("identity")).node.id;
  const b = (yield* create("identity")).node.id;
  const source = (yield* create("anchor")).node.id;
  const connect = (from: string, to: string) =>
    editor.connection.create({
      graphID: "graph",
      connection: {
        outNodeId: from,
        outIo: OutputRef.port("out"),
        inNodeId: to,
        inIoId: IoId.make("in"),
      },
    });
  return { editor, a, b, source, connect };
});

it.effect(
  "renders, propagates, changes and clears wildcard types without persisting inferred IO",
  () =>
    Effect.gen(function* () {
      const { editor, a, b, source, connect } = yield* setup;
      yield* connect(a, b);
      const anchor = yield* connect(source, a);
      const type = (id: string) =>
        editor.project
          .rendered()
          .pipe(Effect.map((p) => p.graphs.graph!.nodes[id]!.io.dataOutputs[0]!.type));
      expect(yield* type(b)).toEqual(DataType.String);
      expect((yield* editor.project.snapshot()).nodeIO.graph![b]!.dataOutputs[0]!.type).toEqual(
        DataType.Wildcard("T"),
      );
      yield* editor.node.setProperty({
        graphID: "graph",
        nodeID: source,
        property: "integer",
        value: true,
      });
      expect(yield* type(b)).toEqual(DataType.Int);
      yield* editor.connection.delete({ graphID: "graph", connectionId: anchor.connection.id });
      expect((yield* type(b))._tag).toBe("Wildcard");
    }).pipe(Effect.provide(TestLayer)),
);

it.effect("checks the complete proposed group and leaves rejected connections unpersisted", () =>
  Effect.gen(function* () {
    const { editor, a, b, source, connect } = yield* setup;
    yield* connect(source, a);
    // A second node-local T has an independent integer anchor until the groups are joined.
    const sink = yield* editor.node.create({
      graphID: "graph",
      node: {
        schema: {
          package: PackageId.make(module.id),
          schema: SchemaId.make("identity"),
        },
      },
    });
    const int = yield* editor.node.create({
      graphID: "graph",
      node: {
        schema: {
          package: PackageId.make(module.id),
          schema: SchemaId.make("anchor"),
        },
        properties: { integer: true },
      },
    });
    yield* connect(int.node.id, b);
    yield* connect(b, sink.node.id);
    const connection = {
      outNodeId: a,
      outIo: OutputRef.port("out"),
      inNodeId: b,
      inIoId: IoId.make("other"),
    };
    expect(
      (yield* Effect.flip(editor.connection.create({ graphID: "graph", connection })))._tag,
    ).toBe("InvalidConnectionError");
    // Reject conflicting pasted groups atomically too.
    const fragment = (yield* editor.project.snapshot()).project.graphs.graph!;
    const text = JSON.stringify({
      format: "macrograph/nodes",
      version: 1,
      nodes: Object.values(fragment.nodes),
      connections: [...fragment.connections, { id: "conflict", ...connection }],
    });
    const error = yield* Effect.flip(
      editor.fragment.paste({ graphID: "graph", text, position: { x: 10, y: 10 } }),
    );
    expect(error._tag).toBe("InvalidClipboardFragment");
    expect((yield* editor.project.snapshot()).project.graphs.graph!.connections).toHaveLength(3);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "validates defaults using inferred types and preserves them through paste and detachment",
  () =>
    Effect.gen(function* () {
      const { editor, a, source, connect } = yield* setup;
      const anchor = yield* connect(source, a);
      yield* editor.node.setInputDefault({
        graphID: "graph",
        nodeID: a,
        input: "other",
        value: "hello",
      });
      expect(
        (yield* Effect.flip(
          editor.node.setInputDefault({ graphID: "graph", nodeID: a, input: "other", value: 123 }),
        ))._tag,
      ).toBe("InvalidInputDefaultError");
      const graph = (yield* editor.project.snapshot()).project.graphs.graph!;
      const pasted = yield* editor.fragment.paste({
        graphID: "graph",
        position: { x: 50, y: 50 },
        text: JSON.stringify({
          format: "macrograph/nodes",
          version: 1,
          nodes: [graph.nodes[source], graph.nodes[a]],
          connections: [anchor.connection],
        }),
      });
      expect(pasted.nodes.find((node) => node.schema.schema === "identity")?.inputDefaults).toEqual(
        { other: "hello" },
      );
      yield* editor.connection.delete({ graphID: "graph", connectionId: anchor.connection.id });
      expect(
        (yield* editor.project.snapshot()).project.graphs.graph!.nodes[a]!.inputDefaults,
      ).toEqual({ other: "hello" });
    }).pipe(Effect.provide(TestLayer)),
);
