import { describe, expect, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { DataType, Engine, Module } from "@macrograph/module";
import { Array, Effect, Option, Ref, Schema } from "effect";

import { Executor } from "../src/index.ts";

class Trigger extends Schema.TaggedClass<Trigger>()("CustomTrigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}

describe("custom type execution", () => {
  it.effect("validates stored defaults, connected values, and driver JSON replay", () =>
    Effect.gen(function* () {
      const id = DataType.DefinitionId.make("tree");
      const type = DataType.Custom(id);
      const definitions: DataType.Definitions = {
        tree: {
          _tag: "Struct",
          id,
          name: "Tree",
          fields: [
            { name: "value", type: DataType.Int },
            { name: "next", type: DataType.Option(type) },
          ],
        },
      };
      const value = { _type: "tree", value: 42, next: Option.none() };
      const captured = yield* Ref.make<unknown>(undefined);
      const module = Module.make({
        id: "custom-test",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: (io) => ({ value: io.data.out("value", type) }),
            run: ({ io }) => Effect.sync(() => io.value(value)),
          });
          yield* context.schema.register({
            id: "sink",
            io: (io) => ({
              connected: io.data.in("connected", type),
              stored: io.data.in("stored", type),
            }),
            run: ({ io }) => Ref.set(captured, [io.connected, io.stored]),
          });
        }),
      });
      const node = (id: string, schema: string, inputDefaults = {}) => ({
        id,
        name: id,
        schema: { package: "custom-test", schema },
        properties: {},
        inputDefaults,
        foldPins: false,
        position: { x: 0, y: 0 },
      });
      const project = yield* Schema.decodeUnknownEffect(Project.Model)({
        ...Project.empty(),
        types: definitions,
        graphs: {
          g: {
            id: "g",
            name: "Graph",
            nodes: {
              event: node("event", "event"),
              sink: node("sink", "sink", {
                stored: Schema.encodeUnknownSync(DataType.JsonValueSchema(type, definitions))(
                  value,
                ),
              }),
            },
            connections: [
              { id: "exec", outNodeId: "event", outIo: { _tag: "Port" as const, id: "exec" }, inNodeId: "sink", inIoId: "exec" },
              {
                id: "data",
                outNodeId: "event",
                outIo: { _tag: "Port" as const, id: "value" },
                inNodeId: "sink",
                inIoId: "connected",
              },
            ],
          },
        },
      });
      const executor = yield* Executor.make(project, {
        executionDriver: {
          executeNode: (_key, effect) =>
            effect.pipe(
              Effect.map((result) => ({
                ...result,
                outputs: result.outputs.map((output) => ({
                  ...output,
                  value: JSON.parse(JSON.stringify(output.value)),
                })),
              })),
            ),
        },
      });
      yield* executor.module(
        module,
        Engine.deployment(
          module,
          TestEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      yield* executor.handleEvent(module, new Trigger({}));
      expect(yield* Ref.get(captured)).toEqual([value, value]);
      yield* executor.loadProject({ ...project, types: {} });
      const error = yield* Effect.flip(executor.handleEvent(module, new Trigger({})));
      expect(error._tag).toBe("InvalidGraph");
    }),
  );
});
