import { expect, it } from "@effect/vitest";
import { CustomTypes, Project } from "@macrograph/core";
import { DataType as t, Engine, Module } from "@macrograph/module";
import { Array, Effect, Schema } from "effect";

import { Executor } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("BreakTrigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

it.effect(
  "executes chained wildcard Break nodes without properties using inferred field declarations",
  () =>
    Effect.gen(function* () {
      const root = t.DefinitionId.make("root"),
        child = t.DefinitionId.make("child");
      const results: string[] = [];
      const module = Module.make({
        id: "test",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: (io) => ({ out: io.data.out("out", t.Custom(root)) }),
            run: ({ io }) =>
              Effect.sync(() => io.out({ _type: root, child: { _type: child, text: "done" } })),
          });
          yield* context.schema.register({
            id: "sink",
            io: (io) => ({ input: io.data.in("in", t.String) }),
            run: ({ io }) =>
              Effect.sync(() => {
                results.push(io.input);
              }),
          });
        }),
      });
      const project = Schema.decodeUnknownSync(Project.Model)({
        ...Project.empty(),
        types: {
          root: {
            _tag: "Struct",
            id: root,
            name: "Root",
            fields: [{ name: "child", type: t.Custom(child) }],
          },
          child: {
            _tag: "Struct",
            id: child,
            name: "Child",
            fields: [{ name: "text", type: t.String }],
          },
        },
        graphs: {
          graph: {
            id: "graph",
            name: "Graph",
            nodes: Object.fromEntries(
              [
                ["event", "test", "event"],
                ["sink", "test", "sink"],
                ["a", CustomTypes.packageId, "BreakStruct"],
                ["b", CustomTypes.packageId, "BreakStruct"],
              ].map(([id, pkg, schema]) => [
                id,
                {
                  id,
                  name: id,
                  schema: { package: pkg, schema },
                  properties: {},
                  inputDefaults: {},
                  foldPins: false,
                  position: { x: 0, y: 0 },
                },
              ]),
            ),
            connections: [
              ["b", 'field:"text"', "sink", "in"],
              ["a", 'field:"child"', "b", "value"],
              ["event", "out", "a", "value"],
              ["event", "exec", "sink", "exec"],
            ].map(([source, output, target, input], index) => ({
              id: String(index),
              outNodeId: source,
              outIo: { _tag: "Port", id: output },
              inNodeId: target,
              inIoId: input,
            })),
          },
        },
      });
      const executor = yield* Executor.make(project);
      yield* executor.module(
        module,
        Engine.deployment(
          module,
          TestEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      yield* executor.handleEvent(module, new Trigger({}));
      expect(results).toEqual(["done"]);
    }),
);
