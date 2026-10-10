import { describe, expect, it } from "@effect/vitest";
import { Graph, IoId, OutputRef, PackageId, Project, SchemaId } from "@macrograph/core";
import { Conversion, t, Module } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";
import { FastCheck as fc } from "effect/testing";

import { Editor, Packages } from "../src/index.ts";

// Tests for connection compatibility.
//
// `t.compatible` is exact type matching, except where a wildcard is involved. On top of that,
// the editor accepts directional implicit conversions; with no module-registered rules these
// are the core defaults (Int -> Float, and Int/Float/Bool -> String), lifted through List and
// Option. Conversion rules themselves are covered by the module and Conversions tests.

const seed = process.env.FC_SEED === undefined ? 0xc0ec : Number(process.env.FC_SEED);
const pureRuns = { numRuns: Number(process.env.FC_NUM_RUNS ?? 500), seed };

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

// Editor-level tests drive the real `Editor.connection.create`, which combines the local
// compatibility check, schema hooks and graph-wide wildcard solving. Their input space is
// small, so they are exhaustive or example-based rather than generated.

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

describe("editor connections", () => {
  it.effect(
    "accepts a direct connection exactly when the types match or a default conversion applies",
    () =>
      Effect.gen(function* () {
        const { create, connect, connections } = yield* setup;
        let accepted = 0;
        for (const from of editorTypes.keys())
          for (const to of editorTypes.keys()) {
            const ok = yield* connect(
              yield* create(testModule.id, source(from)),
              "out",
              yield* create(testModule.id, sink(to)),
              "in",
            );
            expect(ok, `${from} -> ${to}`).toBe(
              Conversion.connectable(editorTypes[from]!, editorTypes[to]!, Conversion.defaultRules),
            );
            if (ok) accepted++;
          }
        expect(yield* connections).toHaveLength(accepted);
      }).pipe(Effect.provide(TestLayer)),
  );

  // source -> 3 pass hops -> sink, i.e. 4 links, connected in different orders. The
  // wildcard solver itself is covered by WildcardProperties; this checks the editor wiring.
  const orders = {
    forward: [0, 1, 2, 3],
    backward: [3, 2, 1, 0],
    "middle last": [0, 3, 1, 2],
  } as const;
  const chains = [
    { name: "matching scalars", from: t.Int, to: t.Int, accepted: true },
    { name: "converted scalars", from: t.Int, to: t.Float, accepted: true },
    { name: "inconvertible scalars", from: t.Float, to: t.Int, accepted: false },
    {
      name: "matching nested",
      from: t.List(t.Option(t.Bool)),
      to: t.List(t.Option(t.Bool)),
      accepted: true,
    },
    { name: "converted nested", from: t.List(t.Int), to: t.List(t.Float), accepted: true },
    { name: "inconvertible nested", from: t.List(t.Float), to: t.List(t.Int), accepted: false },
  ];

  for (const chain of chains)
    for (const [orderName, order] of Object.entries(orders))
      it.effect(`wildcard chain, ${chain.name}, connected ${orderName}`, () =>
        Effect.gen(function* () {
          const { create, connect, connections, io } = yield* setup;
          const index = (type: t.Type) => editorTypes.findIndex((item) => t.equals(item, type));
          const nodes = [
            yield* create(testModule.id, source(index(chain.from))),
            yield* create(testModule.id, "pass"),
            yield* create(testModule.id, "pass"),
            yield* create(testModule.id, "pass"),
            yield* create(testModule.id, sink(index(chain.to))),
          ];
          const results: boolean[] = [];
          for (const link of order)
            results.push(yield* connect(nodes[link]!, "out", nodes[link + 1]!, "in"));

          // Only the connection that completes the chain can conflict, and it is not persisted.
          expect(results).toEqual([true, true, true, chain.accepted]);
          expect(yield* connections).toHaveLength(chain.accepted ? 4 : 3);
          // A conversion into the sink never changes the wildcard: it resolves to the source.
          if (chain.accepted)
            for (const node of nodes.slice(1, -1))
              expect((yield* io(node)).dataOutputs[0]!.type).toEqual(chain.from);
        }).pipe(Effect.provide(TestLayer)),
      );
});
