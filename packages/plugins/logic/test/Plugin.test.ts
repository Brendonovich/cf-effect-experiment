import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Fiber, Option, Ref, Result } from "effect";
import { TestClock } from "effect/testing";

import LogicPlugin from "../src/Plugin.ts";

const schemas = Registration.collect(LogicPlugin.effect);
const schema = (registered: ReadonlyArray<Registration.RegisteredSchema>, id: string) => {
  const found = registered.find((item) => item.id === id);
  assert.isDefined(found);
  return found;
};
const run = (
  registered: Registration.RegisteredSchema,
  inputs: Readonly<Record<string, unknown>> = {},
  properties: Readonly<Record<string, unknown>> = {},
) => {
  const outputs = new Map<string, unknown>();
  return registered
    .run({
      input: (ref) => (Object.hasOwn(inputs, ref.id) ? inputs[ref.id] : ref.defaultValue),
      output: (ref, value) => {
        assert.isTrue(DataType.isValue(ref.type, value), ref.id);
        outputs.set(ref.id, value);
      },
      properties,
      event: undefined,
      engine: undefined,
      execution: {
        projectId: "project",
        graphId: "graph",
        eventNodeId: "event",
        traceId: "execution",
      },
      node: {
        nodeId: "node",
        kind: registered.type,
        executionPath: "event:event",
        traceId: "node",
        withSpan: (_name, effect) => effect,
      },
    })
    .pipe(Effect.map((selected) => ({ outputs, selected })));
};

describe("Logic plugin", () => {
  it.effect(
    "defaults scalar and Option inputs while leaving Switch selectors explicitly required",
    () =>
      Effect.gen(function* () {
        const registered = yield* schemas;
        for (const [type, value] of [
          ["String", ""],
          ["Int", 0],
          ["Float", 0],
          ["Bool", false],
        ] as const) {
          for (const item of registered) {
            for (const input of item.generateIO({ type }).dataInputs) {
              if (item.id === "Switch") assert.isUndefined(input.defaultValue);
              else
                assert.isTrue(
                  DataType.isValue(input.type, input.defaultValue),
                  `${item.id}.${input.id}`,
                );
            }
            if (item.type === "pure" && item.id !== "UnwrapOption") yield* run(item, {}, { type });
          }
          assert.strictEqual(
            (yield* run(schema(registered, "Conditional"), {}, { type })).outputs.get("output"),
            value,
          );
          assert.deepStrictEqual(
            (yield* run(schema(registered, "MakeSome"), {}, { type })).outputs.get("out"),
            Option.some(value),
          );
          assert.strictEqual(
            (yield* run(schema(registered, "UnwrapOptionOr"), {}, { type })).outputs.get("output"),
            value,
          );
          assert.strictEqual(
            (yield* run(schema(registered, "IsOptionNone"), {}, { type })).outputs.get("output"),
            true,
          );
          assert.strictEqual(
            (yield* run(schema(registered, "IsOptionSome"), {}, { type })).outputs.get("output"),
            false,
          );
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(run(schema(registered, "UnwrapOption"), {}, { type })),
            ),
          );
          for (const id of ["Cache", "Copy"])
            assert.strictEqual(
              (yield* run(schema(registered, id), {}, { type })).outputs.get("out"),
              value,
            );
        }
      }),
  );
  it.effect("registers a complete scalar catalog with no fake loop or scope nodes", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      assert.lengthOf(registered, 18);
      assert.strictEqual(new Set(registered.map((item) => item.id)).size, registered.length);
      assert.isTrue(registered.every((item) => !!item.description));
      assert.isFalse(registered.some((item) => /Loop|ForEach|Scope/.test(item.id)));
      const conditional = schema(registered, "Conditional");
      for (const type of ["String", "Int", "Float", "Bool"]) {
        const io = conditional.generateIO({ type });
        assert.strictEqual(
          io.dataInputs.find((input) => input.id === "trueValue")?.type._tag,
          type,
        );
        assert.strictEqual(io.dataOutputs[0]?.type._tag, type);
      }
      assert.strictEqual(conditional.dataOutputs[0]?.type._tag, "String");
      for (const item of registered.filter((item) =>
        item.properties.some((property) => property.id === "type"),
      )) {
        assert.deepStrictEqual(
          item.generateIO({ type: "Any" }),
          item.generateIO({ type: "String" }),
        );
        const result = yield* Effect.result(run(item, {}, { type: "Any" }));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.instanceOf(result.failure, TypeError);
      }
    }),
  );
  it.effect("implements all boolean truth tables and branches", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const [id, expected] of [
        ["AND", [false, false, false, true]],
        ["NAND", [true, true, true, false]],
        ["OR", [false, true, true, true]],
        ["NOR", [true, false, false, false]],
        ["XOR", [false, true, true, false]],
      ] as const) {
        for (const [index, pair] of [
          [false, false],
          [false, true],
          [true, false],
          [true, true],
        ].entries()) {
          const result = yield* run(schema(registered, id), { one: pair[0], two: pair[1] });
          assert.strictEqual(result.outputs.get("value"), expected[index]);
        }
      }
      for (const input of [true, false]) {
        assert.strictEqual(
          (yield* run(schema(registered, "NOT"), { input })).outputs.get("output"),
          !input,
        );
        assert.strictEqual(
          (yield* run(schema(registered, "Branch"), { condition: input })).selected?.id,
          String(input),
        );
      }
    }),
  );
  it.effect("selects typed values and the first matching switch case", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const [type, one, two] of [
        ["String", "a", "b"],
        ["Int", 1, 2],
        ["Float", 1.5, 2.5],
        ["Bool", true, false],
      ] as const) {
        for (const condition of [true, false])
          assert.strictEqual(
            (yield* run(
              schema(registered, "Conditional"),
              { condition, trueValue: one, falseValue: two },
              { type },
            )).outputs.get("output"),
            condition ? one : two,
          );
        assert.strictEqual(
          (yield* run(schema(registered, "Equal"), { one, two }, { type })).outputs.get("equal"),
          false,
        );
        assert.strictEqual(
          (yield* run(schema(registered, "Equal"), { one, two: one }, { type })).outputs.get(
            "equal",
          ),
          true,
        );
        for (const id of ["Cache", "Copy"]) {
          assert.strictEqual(schema(registered, id).type, "exec");
          assert.strictEqual(
            (yield* run(schema(registered, id), { in: one }, { type })).outputs.get("out"),
            one,
          );
        }
      }
      const switchNode = schema(registered, "Switch");
      assert.strictEqual(
        (yield* run(
          switchNode,
          { switchOn: 2, "key-0": 2, "key-1": 2 },
          { type: "Int", number: 2 },
        )).selected?.id,
        "key-0",
      );
      const fallback = yield* run(switchNode, { switchOn: "value" }, { number: 0 });
      assert.strictEqual(fallback.selected?.id, "exec");
      assert.strictEqual(fallback.outputs.get("switchOut"), "value");
      for (const number of [-1, 1.5, 1025, Infinity, NaN]) {
        const io = switchNode.generateIO({ number });
        assert.lengthOf(io.dataInputs, 1);
        assert.deepStrictEqual(
          io.executionOutputs.map((ref) => ref.id),
          ["exec"],
        );
        const result = yield* Effect.result(run(switchNode, { switchOn: "value" }, { number }));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.instanceOf(result.failure, RangeError);
      }
    }),
  );
  it.effect("handles Some and None without losing false, zero, or empty strings", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const [type, value] of [
        ["String", ""],
        ["Int", 0],
        ["Bool", false],
      ] as const) {
        const some = Option.some(value);
        assert.deepStrictEqual(
          (yield* run(schema(registered, "MakeSome"), { in: value }, { type })).outputs.get("out"),
          some,
        );
        assert.strictEqual(
          (yield* run(schema(registered, "UnwrapOption"), { input: some }, { type })).outputs.get(
            "output",
          ),
          value,
        );
        assert.strictEqual(
          (yield* run(
            schema(registered, "UnwrapOptionOr"),
            { input: Option.none(), or: value },
            { type },
          )).outputs.get("output"),
          value,
        );
        for (const input of [some, Option.none()]) {
          assert.strictEqual(
            (yield* run(schema(registered, "IsOptionSome"), { input }, { type })).outputs.get(
              "output",
            ),
            Option.isSome(input),
          );
          assert.strictEqual(
            (yield* run(schema(registered, "IsOptionNone"), { input }, { type })).outputs.get(
              "output",
            ),
            Option.isNone(input),
          );
        }
      }
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(run(schema(registered, "UnwrapOption"), { input: Option.none() })),
        ),
      );
    }),
  );
  it.effect("captures and shallow-copies typed lists without changing scalar defaults", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const [type, values] of [
        ["String", ["", "value"]],
        ["Int", [0, -1]],
        ["Float", [0, 1.5]],
        ["Bool", [false, true]],
      ] as const) {
        const list = Object.freeze([...values]);
        for (const id of ["Cache", "Copy"]) {
          const item = schema(registered, id);
          const properties = { type, list: true };
          const io = item.generateIO(properties);
          assert.deepStrictEqual(io.dataInputs[0]?.type, DataType.List({ _tag: type }));
          assert.deepStrictEqual(io.dataOutputs[0]?.type, io.dataInputs[0]?.type);
          assert.deepStrictEqual(io.dataInputs[0]?.defaultValue, []);
          assert.strictEqual(item.generateIO({ type }).dataInputs[0]?.type._tag, type);
          const output = (yield* run(item, { in: list }, properties)).outputs.get("out");
          assert.deepStrictEqual(output, list);
          if (id === "Copy") assert.notStrictEqual(output, list);
          else assert.strictEqual(output, list);
          assert.deepStrictEqual((yield* run(item, {}, properties)).outputs.get("out"), []);
        }
        assert.deepStrictEqual(list, values);
      }
    }),
  );
  it.effect("waits on the Effect clock and rejects invalid timer boundaries", () =>
    Effect.gen(function* () {
      const wait = schema(yield* schemas, "Wait");
      const completed = yield* Ref.make(false);
      const fiber = yield* run(wait, { delay: 100 }).pipe(
        Effect.andThen(Ref.set(completed, true)),
        Effect.forkChild,
      );
      yield* TestClock.adjust(99);
      assert.isFalse(yield* Ref.get(completed));
      yield* TestClock.adjust(1);
      yield* Fiber.join(fiber);
      assert.isTrue(yield* Ref.get(completed));
      for (const delay of [-1, 0.5, Infinity, NaN, 2147483648])
        assert.isTrue(Result.isFailure(yield* Effect.result(run(wait, { delay }))));
      const cancelled = yield* run(wait, { delay: 2147483647 }).pipe(
        Effect.andThen(Ref.set(completed, false)),
        Effect.forkChild,
      );
      yield* Fiber.interrupt(cancelled);
      assert.isTrue(yield* Ref.get(completed));
    }),
  );
});
