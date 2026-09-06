import { expect, it } from "@effect/vitest";
import {
  Connection,
  CustomTypes,
  Graph,
  IoId,
  PackageId,
  Project,
  SchemaId,
  Scopes,
  OutputRef,
} from "@macrograph/core";
import { DataType, Module } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer, Schema } from "effect";

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
  effect: (context) =>
    context.schema.register({
      id: "sink",
      io: (io) => ({ value: io.data.in("value", DataType.String) }),
      run: () => Effect.void,
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
      properties: { type: enumId },
    },
  });
  const unpack = yield* editor.node.create({
    graphID: "graph",
    node: {
      schema: { package: Scopes.packageId, schema: SchemaId.make("BreakScope") },
    },
  });
  const sink = yield* editor.node.create({
    graphID: "graph",
    node: {
      schema: { package: PackageId.make(sinkModule.id), schema: SchemaId.make("sink") },
    },
  });
  return { editor, match, unpack, sink };
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
      const { editor, match, sink } = yield* setup;
      const scope = 'variant:"Found"';
      const split = yield* editor.node.setScopeSplit({
        graphID: "graph",
        nodeID: match.node.id,
        scope,
        split: true,
      });
      expect(split.splitScopeOutputs).toEqual([scope]);
      expect(
        (yield* editor.project.get()).graphs.graph?.nodes[match.node.id]?.splitScopeOutputs,
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
      const graph = (yield* editor.project.get()).graphs.graph!;
      const pasted = yield* editor.fragment.paste({
        graphID: "graph",
        position: { x: 300, y: 0 },
        text: JSON.stringify({
          format: "macrograph/nodes",
          version: 1,
          nodes: [graph.nodes[match.node.id], graph.nodes[sink.node.id]],
          connections: [exec.connection, field.connection],
        }),
      });
      expect(
        pasted.nodes.find((node) => node.schema.schema === "MatchEnum")?.splitScopeOutputs,
      ).toEqual([scope]);
      expect(pasted.connections.map((wire) => wire.outIo)).toEqual([
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

it.effect("infers Break Scope pins on connect, type edits and disconnect", () =>
  Effect.gen(function* () {
    const { editor, match, unpack, sink } = yield* setup;
    expect(unpack.io.dataOutputs).toEqual([]);
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
        connect(editor, match.node.id, 'variant:"Empty"', unpack.node.id, "scope"),
      ),
    ).toBeInstanceOf(Connection.InvalidError);
    const scope = yield* connect(editor, match.node.id, 'variant:"Found"', unpack.node.id, "scope");
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

it.effect(
  "pastes scopes and field wires regardless of connection order, deriving rather than trusting copied IO",
  () =>
    Effect.gen(function* () {
      const { editor, match, unpack, sink } = yield* setup;
      yield* connect(editor, match.node.id, 'variant:"Found"', unpack.node.id, "scope");
      yield* connect(editor, unpack.node.id, 'field:"value"', sink.node.id, "value");
      yield* connect(editor, unpack.node.id, "exec", sink.node.id, "exec");
      const project = yield* editor.project.get();
      const graph = project.graphs.graph!;
      const pasted = yield* editor.fragment.paste({
        graphID: "graph",
        position: { x: 300, y: 0 },
        text: JSON.stringify({
          format: "macrograph/nodes",
          version: 1,
          nodes: Object.values(graph.nodes),
          connections: [...graph.connections].reverse(),
        }),
      });
      const broken = pasted.nodes.find(Scopes.isBreakScope)!;
      expect(pasted.connections).toHaveLength(3);
      expect(pasted.nodeIO[broken.id]?.dataOutputs).toEqual([
        { id: 'field:"value"', name: "value", type: DataType.String },
      ]);
      expect(
        Schema.decodeUnknownSync(Project.Model)(yield* editor.project.get()).graphs.graph?.nodes[
          broken.id
        ]?.properties,
      ).toEqual({});
    }).pipe(Effect.provide(TestLayer)),
);
