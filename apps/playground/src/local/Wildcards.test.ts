import { expect, it } from "@effect/vitest";
import { Graph, IoId, OutputRef, PackageId, Project, SchemaId } from "@macrograph/core";
import { Editor, Packages } from "@macrograph/editor";
import { Executor } from "@macrograph/execution";
import { DataType as t, Engine, Module, Registration } from "@macrograph/module";
import JsonModule from "@macrograph/module-json";
import ListModule from "@macrograph/module-list";
import LogicModule from "@macrograph/module-logic";
import StringModule from "@macrograph/module-string";
import { Persistence } from "@macrograph/persistence";
import { Array, DateTime, Effect, Layer, Schema } from "effect";

class Trigger extends Schema.TaggedClass<Trigger>()("WildcardModulesTrigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

it.effect(
  "registers generic container defaults and infers authored node types from downstream pins",
  () =>
    Effect.gen(function* () {
      yield* (yield* Persistence.Service).saveProject({
        ...Project.empty(),
        graphs: { graph: Graph.empty("graph") },
      });
      const editor = yield* Editor.Service;
      for (const module of [ListModule, LogicModule, JsonModule, StringModule])
        yield* editor.module(module);
      const create = (pkg: string, schema: string) =>
        editor.node.create({
          graphID: "graph",
          node: {
            schema: { package: PackageId.make(pkg), schema: SchemaId.make(schema) },
          },
        });
      const list = yield* create("list", "ListCreate");
      const join = yield* create("string", "JoinLines");
      const unwrap = yield* create("logic", "UnwrapOption");
      expect(unwrap.io.dataInputs[0]!.defaultValue).toEqual({ _tag: "None" });
      const push = yield* create("list", "PushListValue");
      expect(push.io.dataInputs.find((port) => port.id === "list")!.defaultValue).toEqual([]);
      expect(list.io.dataInputs[0]!.type._tag).toBe("Wildcard");
      const connection = yield* editor.connection.create({
        graphID: "graph",
        connection: {
          outNodeId: list.node.id,
          outIo: OutputRef.port("out"),
          inNodeId: join.node.id,
          inIoId: IoId.make("input"),
        },
      });
      expect(
        (yield* editor.project.rendered()).graphs.graph!.nodes[list.node.id]!.io.dataInputs[0]!
          .type,
      ).toEqual(t.String);
      yield* editor.node.setInputDefault({
        graphID: "graph",
        nodeID: list.node.id,
        input: "value-0",
        value: "hello",
      });
      yield* editor.connection.delete({ graphID: "graph", connectionId: connection.connection.id });
      expect(
        (yield* editor.project.rendered()).graphs.graph!.nodes[list.node.id]!.io.dataInputs[0]!.type
          ._tag,
      ).toBe("Wildcard");
    }).pipe(
      Effect.provide(
        Editor.defaultLayer.pipe(
          Layer.provideMerge(Packages.defaultLayer),
          Layer.provideMerge(Persistence.layerMemory),
        ),
      ),
    ),
);

it.effect("ships wildcard IO instead of type/list properties in all generic nodes", () =>
  Effect.gen(function* () {
    for (const module of [ListModule, LogicModule, JsonModule]) {
      const schemas = yield* Registration.collect(module.effect);
      const generic = schemas.filter((schema) =>
        [...schema.dataInputs, ...schema.dataOutputs].some((port) => t.hasWildcard(port.type)),
      );
      expect(generic.length).toBe(module === ListModule ? 10 : module === LogicModule ? 10 : 3);
      for (const schema of generic) {
        expect(schema.properties.map((property) => property.id)).toEqual(
          ["ListCreate", "Switch"].includes(schema.id) ? ["number"] : [],
        );
        expect(
          schema.dataInputs
            .filter((port) => port.type._tag === "Wildcard")
            .every((port) => port.defaultValue === undefined),
        ).toBe(true);
      }
    }
  }),
);

it.effect(
  "infers shipped List/Copy/Option/JSON nodes across a graph and serializes custom DateTime values",
  () =>
    Effect.gen(function* () {
      const id = t.DefinitionId.make("record");
      const custom = t.Custom(id);
      const value = { _type: id, time: DateTime.makeUnsafe("2026-09-06T12:00:00Z") };
      const captured: unknown[] = [];
      const source = Module.make({
        id: "test",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: (io) => ({ out: io.data.out("out", custom) }),
            run: ({ io }) => Effect.sync(() => io.out(value)),
          });
          yield* context.schema.register({
            id: "sink",
            io: (io) => ({ input: io.data.in("in", t.List(custom)) }),
            run: ({ io }) =>
              Effect.sync(() => {
                captured.push(io.input);
              }),
          });
        }),
      });
      const model = Schema.decodeUnknownSync(Project.Model)({
        ...Project.empty(),
        types: {
          record: {
            _tag: "Struct",
            id,
            name: "Record",
            fields: [{ name: "time", type: t.DateTime }],
          },
        },
        graphs: {
          graph: {
            id: "graph",
            name: "Inferred modules",
            nodes: Object.fromEntries(
              [
                ["event", "test", "event"],
                ["list", "list", "ListCreate"],
                ["copy", "logic", "Copy"],
                ["some", "logic", "MakeSome"],
                ["unwrap", "logic", "UnwrapOption"],
                ["encode", "json", "ToJSON"],
                ["decode", "json", "FromJSON"],
                ["decoded", "logic", "UnwrapOption"],
                ["sink", "test", "sink"],
              ].map(([id, pkg, schema]) => [
                id,
                {
                  id,
                  name: id,
                  schema: { package: pkg, schema },
                  properties: {},
                  inputDefaults: {},
                  position: { x: 0, y: 0 },
                  foldPins: false,
                },
              ]),
            ),
            connections: [
              ["event", "exec", "copy", "exec"],
              ["copy", "exec", "sink", "exec"],
              ["event", "out", "list", "value-0"],
              ["list", "out", "copy", "in"],
              ["copy", "out", "some", "in"],
              ["some", "out", "unwrap", "input"],
              ["unwrap", "output", "encode", "in"],
              ["encode", "out", "decode", "in"],
              ["decode", "out", "decoded", "input"],
              ["decoded", "output", "sink", "in"],
            ].map(([from, output, to, input], index) => ({
              id: String(index),
              outNodeId: from,
              outIo: { _tag: "Port", id: output },
              inNodeId: to,
              inIoId: input,
            })),
          },
        },
      });
      const executor = yield* Executor.make(model, {
        executionDriver: {
          executeNode: (_key, effect) =>
            effect.pipe(Effect.map((result) => JSON.parse(JSON.stringify(result)))),
        },
      });
      yield* executor.module(
        source,
        Engine.deployment(
          source,
          TestEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      yield* executor.module(ListModule);
      yield* executor.module(LogicModule);
      yield* executor.module(JsonModule);
      yield* executor.handleEvent(source, new Trigger({}));
      expect(captured).toEqual([[value]]);
    }),
);
