import { expect, it } from "@effect/vitest";
import { Graph, IoId, OutputRef, PackageId, Project, SchemaId } from "@macrograph/core";
import { Conversion, Module, t } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Cause, Effect, Exit, Layer } from "effect";

import { Editor, Packages } from "../src/index.ts";

const TestLayer = Editor.defaultLayer.pipe(
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
);

const Code = t.defineStruct("conversion-test/Code", "Code", { value: t.Int });

const module = Module.make({
  id: "conversion-test",
  types: { [Code.id]: Code },
  effect: Effect.fnUntraced(function* (context) {
    yield* context.conversion.register(
      Conversion.make({
        from: t.Struct(Code),
        to: t.String,
        convert: (code) => Effect.succeed(String(code.value)),
      }),
    );
    for (const [id, type] of [
      ["int", t.Int],
      ["float", t.Float],
      ["code", t.Struct(Code)],
    ] as const) {
      yield* context.schema.register({
        id: `${id}Source`,
        type: "pure",
        io: (io) => ({ out: io.data.out("out", type) }),
        run: () => Effect.void,
      });
      yield* context.schema.register({
        id: `${id}Sink`,
        type: "pure",
        io: (io) => ({ in: io.data.in("in", type) }),
        run: () => Effect.void,
      });
    }
    yield* context.schema.register({
      id: "stringSink",
      type: "pure",
      io: (io) => ({ in: io.data.in("in", t.String) }),
      run: () => Effect.void,
    });
  }),
});

const connect = (source: string, sink: string) =>
  Effect.gen(function* () {
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
    const from = (yield* create(source)).node.id;
    const to = (yield* create(sink)).node.id;
    return yield* Effect.exit(
      editor.connection.create({
        graphID: "graph",
        connection: {
          outNodeId: from,
          outIo: OutputRef.port("out"),
          inNodeId: to,
          inIoId: IoId.make("in"),
        },
      }),
    );
  });

it.effect("accepts core default conversions without any setup", () =>
  connect("intSource", "floatSink").pipe(
    Effect.map((exit) => expect(Exit.isSuccess(exit)).toBe(true)),
    Effect.provide(TestLayer),
  ),
);

it.effect("rejects a connection with no conversion in that direction", () =>
  connect("floatSource", "intSink").pipe(
    Effect.map((exit) => expect(Exit.isFailure(exit)).toBe(true)),
    Effect.provide(TestLayer),
  ),
);

it.effect("accepts a module-registered conversion and publishes its pair", () =>
  Effect.gen(function* () {
    expect(Exit.isSuccess(yield* connect("codeSource", "stringSink"))).toBe(true);
    const pkg = (yield* (yield* Packages.Service).getPackages()).find(
      (candidate) => candidate.id === module.id,
    );
    expect(pkg?.conversions).toEqual([{ from: t.Struct(Code), to: t.String }]);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("fails to mount a module that registers a conversion it does not own", () =>
  Effect.gen(function* () {
    const editor = yield* Editor.Service;
    const exit = yield* Effect.exit(
      editor.module(
        Module.make({
          id: "orphan",
          effect: (context) =>
            context.conversion.register(
              Conversion.make({
                from: t.Float,
                to: t.Int,
                convert: (value) => Effect.succeed(Math.round(value)),
              }),
            ),
        }),
      ),
    );
    expect(Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : undefined).toContain(
      "without declaring either type",
    );
  }).pipe(Effect.provide(TestLayer)),
);
