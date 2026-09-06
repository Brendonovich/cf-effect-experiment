import { assert, describe, it } from "@effect/vitest";
import { Array, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { expectTypeOf } from "vitest";

import { DataType, Engine, Module, Registration } from "../src/index.ts";

describe("Module.make", () => {
  it.effect("only preconfigures execution ports for exec and event schemas", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect<never>((context) =>
        Effect.gen(function* () {
          for (const type of ["base", "pure", "exec", undefined] as const) {
            yield* context.schema.register({
              id: type ?? "default",
              type,
              io: () => ({}),
              run: () => Effect.void,
            });
          }
          yield* context.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: () => ({}),
            run: () => Effect.void,
          });
        }),
      );
      for (const schema of schemas) {
        for (const io of [schema, schema.generateIO({})]) {
          assert.deepStrictEqual(io.dataInputs, []);
          assert.deepStrictEqual(io.dataOutputs, []);
          assert.deepStrictEqual(
            io.executionInputs.map((port) => port.id),
            schema.type === "exec" ? ["exec"] : [],
          );
          assert.deepStrictEqual(
            io.executionOutputs.map((port) => port.id),
            schema.type === "exec" || schema.type === "event" ? ["exec"] : [],
          );
        }
      }
    }),
  );

  it.effect("preserves only explicitly declared base ports, including dynamic IO", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect<never>((context) =>
        context.schema.register({
          id: "Route",
          type: "base",
          properties: { count: { name: "Outputs", type: DataType.Int, defaultValue: 2 } },
          io: (io, properties) => ({
            enter: io.exec.in("enter"),
            input: io.data.in("input", DataType.String),
            output: io.data.out("output", DataType.String),
            branches: globalThis.Array.from({ length: properties.count }, (_, index) =>
              io.exec.out(`branch-${index}`),
            ),
          }),
          run: () => Effect.void,
        }),
      );
      const schema = schemas[0]!;
      assert.strictEqual(schema.type, "base");
      for (const [io, count] of [
        [schema, 2],
        [schema.generateIO({ count: 3 }), 3],
      ] as const) {
        assert.deepStrictEqual(
          io.dataInputs.map((port) => port.id),
          ["input"],
        );
        assert.deepStrictEqual(
          io.dataOutputs.map((port) => port.id),
          ["output"],
        );
        assert.deepStrictEqual(
          io.executionInputs.map((port) => port.id),
          ["enter"],
        );
        assert.deepStrictEqual(
          io.executionOutputs.map((port) => port.id),
          globalThis.Array.from({ length: count }, (_, index) => `branch-${index}`),
        );
      }
    }),
  );

  it.effect("infers an engine-less context and typed IO without type arguments", () =>
    Effect.gen(function* () {
      const module = Module.make({
        id: "stateless",
        effect: Effect.fnUntraced(function* (context) {
          expectTypeOf(context).toEqualTypeOf<Registration.ModuleContext<never>>();
          yield* context.schema.register({
            id: "Increment",
            type: "pure",
            io: (io) => ({
              input: io.data.in("input", DataType.Int),
              output: io.data.out("output", DataType.Int),
            }),
            run: ({ io, engine }) => {
              expectTypeOf(engine).toEqualTypeOf<never>();
              expectTypeOf(io.input).toEqualTypeOf<number>();
              return Effect.sync(() => io.output(io.input + 1));
            },
          });
        }),
      });
      expectTypeOf(module).toEqualTypeOf<Module.Module<never>>();
      assert.isUndefined(module.engine);
      assert.deepStrictEqual(
        (yield* Registration.collect(module.effect)).map((schema) => schema.id),
        ["Increment"],
      );
    }),
  );

  it.effect("preserves engine and event inference when an engine is supplied", () =>
    Effect.gen(function* () {
      class Trigger extends Schema.TaggedClass<Trigger>()("Trigger", {}) {}
      class TestEngine extends Engine.make({
        events: Array.empty<Trigger>(),
        rpcs: RpcGroup.make(
          Rpc.make("GetValues", {
            success: Schema.Array(Schema.String),
            error: Schema.String,
          }),
        ),
      }) {}
      const module = Module.make({
        id: "stateful",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (context) {
          expectTypeOf(context).toEqualTypeOf<Registration.ModuleContext<typeof TestEngine>>();
          yield* context.schema.register({
            id: "Trigger",
            type: "event",
            event: (event) => {
              expectTypeOf(event).toEqualTypeOf<Trigger>();
              return Effect.succeed(event._tag === "Trigger");
            },
            io: (io) => ({
              value: io.data.in("value", DataType.String, {
                suggestions: ({ engine }) => {
                  expectTypeOf(engine).toEqualTypeOf<Engine.RuntimeClientOf<typeof TestEngine>>();
                  return engine.GetValues();
                },
              }),
            }),
            run: () => Effect.void,
          });
        }),
      });
      expectTypeOf(module).toEqualTypeOf<Module.Module<typeof TestEngine>>();
      assert.strictEqual(module.engine, TestEngine);
      assert.lengthOf(yield* Registration.collect(module.effect), 1);
    }),
  );
});
