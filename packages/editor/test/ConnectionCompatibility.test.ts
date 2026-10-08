import { describe, expect, it } from "@effect/vitest";
import { Graph, IoId, OutputRef, PackageId, Project, SchemaId } from "@macrograph/core";
import { t, Module } from "@macrograph/module";
import MathModule from "@macrograph/module-math";
import StringModule from "@macrograph/module-string";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";
import { FastCheck as fc } from "effect/testing";

import { Editor, Packages } from "../src/index.ts";

// Property tests for connection compatibility.
//
// Current policy: data connections require exactly matching types, except where a wildcard
// is involved. There are no implicit conversions; values are converted with explicit
// conversion nodes such as Math "Int To Float" or String "Int To String".

const seed = process.env.FC_SEED === undefined ? 0xc0ec : Number(process.env.FC_SEED);
const pureRuns = { numRuns: Number(process.env.FC_NUM_RUNS ?? 500), seed };
const editorRuns = { numRuns: Number(process.env.FC_NUM_RUNS ?? 40), seed };

const leafTypes = [t.String, t.Int, t.Float, t.Bool, t.DateTime] as const;

const typeArb = (wildcards: boolean): fc.Arbitrary<t.Type> =>
  fc.letrec<{ type: t.Type }>((tie) => ({
    type: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      fc.constantFrom<t.Type>(...leafTypes),
      fc.constantFrom<t.Type>(t.Struct("a"), t.Struct("b"), t.Enum("a"), t.Enum("b")),
      ...(wildcards ? [fc.constantFrom<t.Type>(t.Wildcard("T"), t.Wildcard("U"))] : []),
      tie("type").map((item) => t.List(item)),
      tie("type").map((inner) => t.Option(inner)),
    ),
  })).type;

const concreteArb = typeArb(false);
const anyTypeArb = typeArb(true);

/** Replace every wildcard with a concrete type chosen per wildcard ID. */
const substitute = (type: t.Type, values: Readonly<Record<string, t.Type>>): t.Type =>
  type._tag === "Wildcard"
    ? (values[type.id] ?? t.String)
    : type._tag === "List"
      ? t.List(substitute(type.item, values))
      : type._tag === "Option"
        ? t.Option(substitute(type.inner, values))
        : type;

describe("type compatibility properties", () => {
  it.prop(
    "every type is compatible with itself",
    [anyTypeArb],
    ([type]) => {
      expect(t.compatible(type, type)).toBe(true);
    },
    { fastCheck: pureRuns },
  );

  it.prop(
    "compatibility does not depend on which side is the output",
    [anyTypeArb, anyTypeArb],
    ([left, right]) => {
      expect(t.compatible(left, right)).toBe(t.compatible(right, left));
    },
    { fastCheck: pureRuns },
  );

  it.prop(
    "concrete types are compatible only when they are exactly equal",
    [concreteArb, concreteArb],
    ([left, right]) => {
      expect(t.compatible(left, right)).toBe(t.equals(left, right));
    },
    { fastCheck: pureRuns },
  );

  it("rejects every pair of distinct scalar types in both directions", () => {
    for (const left of leafTypes)
      for (const right of leafTypes) expect(t.compatible(left, right)).toBe(left === right);
  });

  it.prop(
    "a type containing wildcards is compatible with any concrete instantiation of it",
    [anyTypeArb, concreteArb, concreteArb],
    ([type, forT, forU]) => {
      expect(t.compatible(type, substitute(type, { T: forT, U: forU }))).toBe(true);
    },
    { fastCheck: pureRuns },
  );
});

// Editor-level properties drive the real `Editor.connection.create`, which combines the
// local compatibility check, schema hooks and graph-wide wildcard solving.

const editorTypes: ReadonlyArray<t.Type> = [
  t.String,
  t.Int,
  t.Float,
  t.Bool,
  t.DateTime,
  t.List(t.Int),
  t.List(t.Float),
  t.Option(t.String),
  t.Option(t.Int),
  t.Option(t.Float),
  t.List(t.Option(t.Bool)),
];
const editorTypeIndex = fc.nat({ max: editorTypes.length - 1 });

const testModule = Module.make({
  id: "compatibility-test",
  effect: Effect.fnUntraced(function* (context) {
    for (const [index, type] of editorTypes.entries()) {
      yield* context.schema.register({
        id: `source${index}`,
        type: "pure",
        io: (io) => ({ output: io.data.out("out", type) }),
        run: () => Effect.void,
      });
      yield* context.schema.register({
        id: `sink${index}`,
        type: "pure",
        io: (io) => ({ input: io.data.in("in", type) }),
        run: () => Effect.void,
      });
    }
    yield* context.schema.register({
      id: "pass",
      type: "pure",
      io: (io) => {
        const type = io.wildcard("T");
        return { input: io.data.in("in", type), output: io.data.out("out", type) };
      },
      run: ({ io }) => Effect.sync(() => io.output(io.input)),
    });
  }),
});

const TestLayer = Editor.defaultLayer.pipe(
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
);

const setup = Effect.gen(function* () {
  yield* (yield* Persistence.Service).saveProject({
    ...Project.empty(),
    graphs: { graph: Graph.empty("graph") },
  });
  const editor = yield* Editor.Service;
  yield* editor.module(testModule);
  yield* editor.module(MathModule);
  yield* editor.module(StringModule);
  const create = (pkg: string, schema: string) =>
    editor.node
      .create({
        graphID: "graph",
        node: { schema: { package: PackageId.make(pkg), schema: SchemaId.make(schema) } },
      })
      .pipe(Effect.map((event) => event.node.id));
  const connect = (from: string, outPort: string, to: string, inPort: string) =>
    editor.connection
      .create({
        graphID: "graph",
        connection: {
          outNodeId: from,
          outIo: OutputRef.port(outPort),
          inNodeId: to,
          inIoId: IoId.make(inPort),
        },
      })
      .pipe(
        Effect.as(true),
        Effect.catchTag("InvalidConnectionError", () => Effect.succeed(false)),
      );
  const connections = editor.project
    .snapshot()
    .pipe(Effect.map((snapshot) => snapshot.project.graphs.graph!.connections));
  const io = (node: string) =>
    editor.project.rendered().pipe(Effect.map((p) => p.graphs.graph!.nodes[node]!.io));
  return { create, connect, connections, io };
});

const source = (index: number) => `source${index}`;
const sink = (index: number) => `sink${index}`;

describe("editor connection properties", () => {
  it.effect.prop(
    "accepts a direct connection exactly when the types match, and persists only accepted ones",
    [editorTypeIndex, editorTypeIndex],
    ([from, to]) =>
      Effect.gen(function* () {
        const { create, connect, connections } = yield* setup;
        const out = yield* create(testModule.id, source(from));
        const input = yield* create(testModule.id, sink(to));
        const accepted = yield* connect(out, "out", input, "in");
        expect(accepted).toBe(t.equals(editorTypes[from]!, editorTypes[to]!));
        expect(yield* connections).toHaveLength(accepted ? 1 : 0);
      }).pipe(Effect.provide(TestLayer)),
    { fastCheck: editorRuns },
  );

  it.effect.prop(
    "rejects exactly the connection that would join mismatched types through a wildcard chain",
    [
      editorTypeIndex,
      editorTypeIndex,
      fc.integer({ min: 1, max: 4 }),
      fc.array(fc.double({ noNaN: true }), { minLength: 5, maxLength: 5 }),
    ],
    ([from, to, hops, keys]) =>
      Effect.gen(function* () {
        const { create, connect, connections, io } = yield* setup;
        const nodes = [yield* create(testModule.id, source(from))];
        for (let hop = 0; hop < hops; hop++) nodes.push(yield* create(testModule.id, "pass"));
        nodes.push(yield* create(testModule.id, sink(to)));

        // Create the chain's connections in a random order.
        const links = nodes
          .slice(1)
          .map((target, index) => ({ from: nodes[index]!, to: target, key: keys[index]! }))
          .sort((a, b) => a.key - b.key);
        const results: boolean[] = [];
        for (const link of links) results.push(yield* connect(link.from, "out", link.to, "in"));

        const matching = t.equals(editorTypes[from]!, editorTypes[to]!);
        // Only the connection that completes the chain can conflict.
        expect(results.slice(0, -1).every(Boolean)).toBe(true);
        expect(results.at(-1)).toBe(matching);
        expect(yield* connections).toHaveLength(matching ? links.length : links.length - 1);
        if (matching)
          for (const node of nodes.slice(1, -1))
            expect((yield* io(node)).dataOutputs[0]!.type).toEqual(editorTypes[from]);
      }).pipe(Effect.provide(TestLayer)),
    { fastCheck: editorRuns },
  );

  const conversions = [
    { pkg: MathModule.id, schema: "IntToFloat", from: t.Int, to: t.Float },
    { pkg: MathModule.id, schema: "FloatToInt", from: t.Float, to: t.Int },
    { pkg: StringModule.id, schema: "IntToString", from: t.Int, to: t.String },
    { pkg: StringModule.id, schema: "FloatToString", from: t.Float, to: t.String },
    { pkg: StringModule.id, schema: "BoolToString", from: t.Bool, to: t.String },
    { pkg: StringModule.id, schema: "StringToInt", from: t.String, to: t.Option(t.Int) },
    { pkg: StringModule.id, schema: "StringToFloat", from: t.String, to: t.Option(t.Float) },
  ] as const;

  it.effect.prop(
    "bridges two types only through an explicit conversion node, in its declared direction",
    [fc.constantFrom(...conversions), editorTypeIndex, editorTypeIndex],
    ([conversion, from, to]) =>
      Effect.gen(function* () {
        const { create, connect, io } = yield* setup;
        const node = yield* create(conversion.pkg, conversion.schema);
        const ports = yield* io(node);
        expect(ports.dataInputs.map((port) => port.type)).toEqual([conversion.from]);
        expect(ports.dataOutputs.map((port) => port.type)).toEqual([conversion.to]);
        const inPort = ports.dataInputs[0]!.id,
          outPort = ports.dataOutputs[0]!.id;

        const fromIndex = editorTypes.findIndex((type) => t.equals(type, conversion.from));
        const toIndex = editorTypes.findIndex((type) => t.equals(type, conversion.to));
        // The source type never connects straight to the target type...
        const direct = yield* connect(
          yield* create(testModule.id, source(fromIndex)),
          "out",
          yield* create(testModule.id, sink(toIndex)),
          "in",
        );
        expect(direct).toBe(false);

        // ...but random endpoints connect to the conversion node exactly when they match its
        // declared input and output, so the node never accepts the reverse direction.
        const intoConversion = yield* connect(
          yield* create(testModule.id, source(from)),
          "out",
          node,
          inPort,
        );
        expect(intoConversion).toBe(t.equals(editorTypes[from]!, conversion.from));
        const outOfConversion = yield* connect(
          node,
          outPort,
          yield* create(testModule.id, sink(to)),
          "in",
        );
        expect(outOfConversion).toBe(t.equals(editorTypes[to]!, conversion.to));
      }).pipe(Effect.provide(TestLayer)),
    { fastCheck: editorRuns },
  );
});
