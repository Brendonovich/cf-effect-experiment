import { expect, it } from "@effect/vitest";
import { Graph, IoId, OutputRef, PackageId, Project, SchemaId } from "@macrograph/core";
import { Conversion, Module, t } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";

import { Editor, Packages } from "../src/index.ts";

const module = Module.make({
  id: "conversion-test",
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "source",
      type: "pure",
      io: (io) => ({ out: io.data.out("out", t.Int) }),
      run: () => Effect.void,
    });
    yield* context.schema.register({
      id: "sink",
      type: "pure",
      io: (io) => ({ in: io.data.in("in", t.Float) }),
      run: () => Effect.void,
    });
  }),
});

const layer = (conversions: Conversion.Registry) =>
  Editor.defaultLayer.pipe(
    Layer.provideMerge(Packages.defaultLayer),
    Layer.provideMerge(Persistence.layerMemory),
    Layer.provideMerge(Conversion.layer(conversions)),
  );

const connectSourceToSink = Effect.gen(function* () {
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
  const source = (yield* create("source")).node.id;
  const sink = (yield* create("sink")).node.id;
  return yield* editor.connection.create({
    graphID: "graph",
    connection: {
      outNodeId: source,
      outIo: OutputRef.port("out"),
      inNodeId: sink,
      inIoId: IoId.make("in"),
    },
  });
});

const intToFloat = Conversion.make({
  from: t.Int,
  to: t.Float,
  convert: (value) => Effect.succeed(value),
});

it.effect("rejects an Int to Float connection without a registered conversion", () =>
  connectSourceToSink.pipe(
    Effect.flip,
    Effect.map((error) => expect(error._tag).toBe("InvalidConnectionError")),
    Effect.provide(layer(Conversion.empty)),
  ),
);

it.effect("accepts an Int to Float connection once the consumer registers it", () =>
  connectSourceToSink.pipe(
    Effect.map((created) => expect(created.connection).toBeDefined()),
    Effect.provide(layer(Conversion.registry([intToFloat]))),
  ),
);
