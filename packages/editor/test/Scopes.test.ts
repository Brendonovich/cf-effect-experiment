import { expect, it } from "@effect/vitest";
import {
  Connection,
  CustomTypes,
  Graph,
  IoId,
  PackageId,
  Project,
  SchemaId,
  OutputRef,
} from "@macrograph/core";
import { DataType, Module } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";

import { Editor, Packages } from "../src/index.ts";

const TestLayer = Editor.defaultLayer.pipe(
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
);
const enumId = DataType.DefinitionId.make("result");
const definition: Extract<DataType.Definition, { readonly _tag: "Enum" }> = {
  _tag: "Enum",
  id: enumId,
  name: "Result",
  variants: [
    { name: "Found", fields: [{ name: "value", type: DataType.String }] },
    { name: "Empty", fields: [] },
  ],
};
const sinkModule = Module.make({
  id: "scope-editor",
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "sink",
      io: (io) => ({ value: io.data.in("value", DataType.String) }),
      run: () => Effect.void,
    });
    yield* context.schema.register({
      id: "source",
      type: "pure",
      io: (io) => ({ value: io.data.out("value", DataType.Custom(enumId)) }),
      run: () => Effect.void,
    });
  }),
});
const setup = Effect.gen(function* () {
  const persistence = yield* Persistence.Service;
  yield* persistence.saveProject({
    ...Project.empty(),
    types: { [enumId]: definition },
    graphs: { graph: Graph.empty("graph") },
  });
  const editor = yield* Editor.Service;
  yield* editor.project.get();
  yield* editor.module(sinkModule);
  const match = yield* editor.node.create({
    graphID: "graph",
    node: {
      schema: { package: CustomTypes.packageId, schema: SchemaId.make("MatchEnum") },
      properties: {},
    },
  });
  const source = yield* editor.node.create({
    graphID: "graph",
    node: {
      schema: { package: PackageId.make(sinkModule.id), schema: SchemaId.make("source") },
    },
  });
  yield* editor.connection.create({
    graphID: "graph",
    connection: {
      outNodeId: source.node.id,
      outIo: OutputRef.port("value"),
      inNodeId: match.node.id,
      inIoId: IoId.make("value"),
    },
  });
  const unpack = yield* editor.scopeProjection.create({
    graphID: "graph",
    position: { x: 0, y: 0 },
    sourceNodeID: match.node.id,
    sourceOutput: OutputRef.port('variant:"Found"'),
  });
  const sink = yield* editor.node.create({
    graphID: "graph",
    node: {
      schema: { package: PackageId.make(sinkModule.id), schema: SchemaId.make("sink") },
    },
  });
  const rendered = yield* editor.project.rendered();
  return {
    editor,
    match: { ...match, io: rendered.graphs.graph!.nodes[match.node.id]!.io },
    unpack,
    sink,
    source,
  };
});
const connect = (
  editor: Editor.Interface,
  from: string,
  output: string,
  to: string,
  input: string,
) =>
  editor.connection.create({
    graphID: "graph",
    connection: {
      outNodeId: from,
      outIo: { _tag: "Port" as const, id: IoId.make(output) },
      inNodeId: to,
      inIoId: IoId.make(input),
    },
  });

it.effect(
  "persists inline split mode, validates projected wires, blocks connected mode switches and copies the group",
  () =>
    Effect.gen(function* () {
      const { editor, match, unpack, sink, source } = yield* setup;
      yield* editor.node.delete({ graphID: "graph", nodeID: unpack.node.id });
      const scope = 'variant:"Found"';
      const split = yield* editor.node.setScopeSplit({
        graphID: "graph",
        nodeID: match.node.id,
        scope,
        split: true,
      });
      expect(split.splitScopeOutputs).toEqual([scope]);
      expect(
        Project.canvases(yield* editor.project.get()).graph?.nodes[match.node.id]
          ?.splitScopeOutputs,
      ).toEqual([scope]);
      const exec = yield* editor.connection.create({
        graphID: "graph",
        connection: {
          outNodeId: match.node.id,
          outIo: OutputRef.scopeExec(scope),
          inNodeId: sink.node.id,
          inIoId: IoId.make("exec"),
        },
      });
      const field = yield* editor.connection.create({
        graphID: "graph",
        connection: {
          outNodeId: match.node.id,
          outIo: OutputRef.scopeField(scope, 'field:"value"'),
          inNodeId: sink.node.id,
          inIoId: IoId.make("value"),
        },
      });
      expect(
        yield* Effect.flip(
          editor.node.setScopeSplit({
            graphID: "graph",
            nodeID: match.node.id,
            scope,
            split: false,
          }),
        ),
      ).toBeInstanceOf(Connection.InvalidError);
      const graph = Project.canvases(yield* editor.project.get()).graph!;
      const anchor = graph.connections.find(
        (connection) => connection.outNodeId === source.node.id,
      )!;
      const pasted = yield* editor.fragment.paste({
        graphID: "graph",
        position: { x: 300, y: 0 },
        text: JSON.stringify({
          format: "macrograph/nodes",
          version: 1,
          nodes: [
            graph.nodes[source.node.id],
            graph.nodes[match.node.id],
            graph.nodes[sink.node.id],
          ],
          connections: [anchor, exec.connection, field.connection],
        }),
      });
      expect(
        pasted.nodes.find((node) => node.schema.schema === "MatchEnum")?.splitScopeOutputs,
      ).toEqual([scope]);
      expect(pasted.connections.map((wire) => wire.outIo)).toEqual([
        OutputRef.port("value"),
        OutputRef.scopeExec(scope),
        OutputRef.scopeField(scope, 'field:"value"'),
      ]);
      yield* editor.connection.delete({ graphID: "graph", connectionId: exec.connection.id });
      yield* editor.connection.delete({ graphID: "graph", connectionId: field.connection.id });
      expect(
        (yield* editor.node.setScopeSplit({
          graphID: "graph",
          nodeID: match.node.id,
          scope,
          split: false,
        })).splitScopeOutputs,
      ).toEqual([]);
      expect(
        yield* Effect.flip(
          editor.node.setScopeSplit({
            graphID: "graph",
            nodeID: match.node.id,
            scope: 'variant:"Empty"',
            split: true,
          }),
        ),
      ).toBeInstanceOf(Connection.InvalidError);
      expect(
        yield* Effect.flip(
          editor.connection.create({
            graphID: "graph",
            connection: {
              outNodeId: match.node.id,
              outIo: OutputRef.scopeField(scope, "missing"),
              inNodeId: sink.node.id,
              inIoId: IoId.make("value"),
            },
          }),
        ),
      ).toBeInstanceOf(Connection.InvalidError);
    }).pipe(Effect.provide(TestLayer)),
);

it.effect("infers scope projection pins on creation, type edits and disconnect", () =>
  Effect.gen(function* () {
    const { editor, match, unpack, sink } = yield* setup;
    expect(unpack.io.dataOutputs).toEqual([
      { id: 'field:"value"', name: "value", type: DataType.String },
    ]);
    expect(match.io.dataOutputs).toEqual([]);
    expect(match.io.executionOutputs).toEqual([
      {
        id: 'variant:"Found"',
        name: "Found",
        scope: [{ id: 'field:"value"', name: "value", type: DataType.String }],
      },
      { id: 'variant:"Empty"', name: "Empty" },
    ]);
    expect(
      yield* Effect.flip(connect(editor, match.node.id, 'variant:"Found"', sink.node.id, "exec")),
    ).toBeInstanceOf(Connection.InvalidError);
    expect(
      yield* Effect.flip(
        editor.scopeProjection.create({
          graphID: "graph",
          position: { x: 0, y: 0 },
          sourceNodeID: match.node.id,
          sourceOutput: OutputRef.port('variant:"Empty"'),
        }),
      ),
    ).toBeInstanceOf(Connection.InvalidError);
    const scope = unpack;
    const snapshot = yield* editor.project.snapshot();
    expect(snapshot.nodeIO.graph?.[unpack.node.id]?.dataOutputs).toEqual([
      { id: 'field:"value"', name: "value", type: DataType.String },
    ]);
    yield* connect(editor, unpack.node.id, 'field:"value"', sink.node.id, "value");
    const preview = yield* editor.typeDefinition.preview({
      _tag: "Upsert",
      definition: {
        ...definition,
        variants: [{ name: "Found", fields: [{ name: "value", type: DataType.Int }] }],
      },
    });
    expect(preview.nodes.some((node) => node.nodeId === unpack.node.id)).toBe(true);
    yield* editor.typeDefinition.confirm({ token: preview.token });
    expect(
      (yield* editor.project.snapshot()).nodeIO.graph?.[unpack.node.id]?.dataOutputs[0]?.type,
    ).toEqual(DataType.Int);
    yield* editor.connection.delete({ graphID: "graph", connectionId: scope.connection.id });
    expect((yield* editor.project.snapshot()).nodeIO.graph?.[unpack.node.id]?.dataOutputs).toEqual(
      [],
    );
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("persists scope projections separately from schema nodes", () =>
  Effect.gen(function* () {
    const { editor, unpack, sink } = yield* setup;
    yield* connect(editor, unpack.node.id, 'field:"value"', sink.node.id, "value");
    yield* connect(editor, unpack.node.id, "exec", sink.node.id, "exec");
    yield* editor.node.update({
      graphID: "graph",
      nodeID: unpack.node.id,
      position: { x: 120, y: 80 },
    });
    const graph = Project.canvases(yield* editor.project.get()).graph!;
    expect(graph.nodes[unpack.node.id]).toBeUndefined();
    expect(graph.scopeProjections?.[unpack.node.id]).toEqual({
      id: unpack.node.id,
      position: { x: 120, y: 80 },
    });
    expect((yield* editor.project.snapshot()).nodeIO.graph?.[unpack.node.id]?.dataOutputs).toEqual([
      { id: 'field:"value"', name: "value", type: DataType.String },
    ]);
    const pasted = yield* editor.fragment.paste({
      graphID: "graph",
      position: { x: 400, y: 200 },
      text: JSON.stringify({
        format: "macrograph/nodes",
        version: 1,
        nodes: Object.values(graph.nodes),
        scopeProjections: Object.values(graph.scopeProjections ?? {}),
        connections: graph.connections,
      }),
    });
    expect(pasted.scopeProjections).toHaveLength(1);
    expect(pasted.connections).toHaveLength(graph.connections.length);
    expect(pasted.nodeIO[pasted.scopeProjections[0]!.id]?.dataOutputs).toEqual([
      { id: 'field:"value"', name: "value", type: DataType.String },
    ]);
  }).pipe(Effect.provide(TestLayer)),
);
