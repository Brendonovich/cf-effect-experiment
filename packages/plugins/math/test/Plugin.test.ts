import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { DataType } from "@macrograph/plugin/DataType";
import { Clock, Effect, Random, Result } from "effect";
import { TestClock } from "effect/testing";

import MathPlugin from "../src/Plugin.ts";

const schemas = Registration.collect(MathPlugin.effect);
const schema = (registered: ReadonlyArray<Registration.RegisteredSchema>, id: string) => {
  const found = registered.find((item) => item.id === id);
  assert.isDefined(found);
  return found;
};
const run = (
  registered: Registration.RegisteredSchema,
  inputs: Readonly<Record<string, unknown>> = {},
  outputs = new Map<string, unknown>(),
) => {
  return registered
    .run({
      input: (ref) => (Object.hasOwn(inputs, ref.id) ? inputs[ref.id] : ref.defaultValue),
      output: (ref, value) => {
        assert.isTrue(DataType.isValue(ref.type, value), ref.id);
        outputs.set(ref.id, value);
      },
      properties: {},
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
    .pipe(Effect.as(outputs));
};

describe("Math plugin", () => {
  it.effect("registers 33 described schemas and makes random and clock sampling executable", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      assert.lengthOf(registered, 33);
      assert.strictEqual(new Set(registered.map((item) => item.id)).size, 33);
      assert.isTrue(registered.every((item) => !!item.description));
      for (const item of registered) {
        for (const input of item.dataInputs)
          assert.isTrue(DataType.isValue(input.type, input.defaultValue), `${item.id}.${input.id}`);
        if (item.type === "pure") yield* run(item);
      }
      for (const item of registered)
        assert.strictEqual(
          item.type,
          item.id.startsWith("Random") || item.id === "DateNow" || item.id === "CurrentTimestamp"
            ? "exec"
            : "pure",
        );
    }),
  );
  it.effect("implements integer and floating-point arithmetic and comparisons", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const suffix of ["Ints", "Floats"]) {
        for (const [operation, expected] of [
          ["Add", 9],
          ["Subtract", 5],
          ["Multiply", 14],
          ["Min", 2],
          ["Max", 7],
        ] as const)
          assert.strictEqual(
            (yield* run(schema(registered, `${operation}${suffix}`), { one: 7, two: 2 })).get(
              "output",
            ),
            expected,
          );
        assert.strictEqual(
          (yield* run(schema(registered, `Divide${suffix}`), { one: -7, two: 2 })).get("output"),
          suffix === "Ints" ? -4 : -3.5,
        );
      }
      assert.strictEqual(
        (yield* run(schema(registered, "DivideIntsExact"), { one: 7, two: 2 })).get("output"),
        3.5,
      );
      assert.strictEqual(
        (yield* run(schema(registered, "ExponentFloats"), { one: 2, two: 3 })).get("output"),
        8,
      );
      for (const type of ["Int", "Float"]) {
        assert.strictEqual(
          (yield* run(schema(registered, `Remainder${type}`), { input: -7, divisor: 2 })).get(
            "remainder",
          ),
          -1,
        );
        for (const [number, compare] of [
          [1, 2],
          [2, 1],
          [2, 2],
        ]) {
          const outputs = yield* run(schema(registered, `Compare${type}`), { number, compare });
          assert.strictEqual(outputs.get("outputE"), number === compare);
          assert.strictEqual(outputs.get("outputG"), number! > compare!);
          assert.strictEqual(outputs.get("outputL"), number! < compare!);
        }
      }
    }),
  );
  it.effect("computes trigonometry, rounding, and numeric conversions", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const [id, input, expected] of [
        ["Sin", 0, 0],
        ["Cos", 0, 1],
        ["Tan", 0, 0],
        ["FloatToInt", -1.5, -1],
        ["IntToFloat", 2, 2],
        ["FloorFloat", -1.5, -2],
        ["MakeInt", 42, 42],
        ["MakeFloat", 1.5, 1.5],
      ] as const)
        assert.strictEqual((yield* run(schema(registered, id), { input })).get("output"), expected);
      assert.strictEqual(
        (yield* run(schema(registered, "RoundFloat"), { input: 1.234, decimal: 2 })).get("output"),
        1.23,
      );
      assert.strictEqual(
        (yield* run(schema(registered, "RoundFloat"), { input: 123, decimal: -1 })).get("output"),
        120,
      );
    }),
  );
  it.effect(
    "rejects division by zero, invalid domains, overflow, and unsafe integer arithmetic",
    () =>
      Effect.gen(function* () {
        const registered = yield* schemas;
        for (const [id, inputs] of [
          ["DivideInts", { one: 1, two: 0 }],
          ["DivideFloats", { one: 1, two: 0 }],
          ["DivideIntsExact", { one: 1, two: 0 }],
          ["RemainderInt", { input: 1, divisor: 0 }],
          ["RemainderFloat", { input: 1, divisor: 0 }],
          ["AddInts", { one: Number.MAX_SAFE_INTEGER, two: 1 }],
          ["MultiplyInts", { one: Number.MAX_SAFE_INTEGER, two: 2 }],
          ["MultiplyFloats", { one: Number.MAX_VALUE, two: 2 }],
          ["ExponentFloats", { one: -1, two: 0.5 }],
          ["Sin", { input: Infinity }],
          ["MakeInt", { input: 1.5 }],
          ["MakeFloat", { input: NaN }],
          ["CompareInt", { number: 1, compare: 1.5 }],
          ["CompareFloat", { number: 1, compare: Infinity }],
          ["RoundFloat", { input: 1, decimal: 309 }],
          ["RoundFloat", { input: 1, decimal: 0.5 }],
          ["RandomIntegerInRange", { min: 2, max: 1 }],
          ["RandomIntegerInRange", { min: 0.5, max: 1 }],
          ["RandomIntegerInRange", { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }],
          ["RandomFloatInRange", { min: -Number.MAX_VALUE, max: Number.MAX_VALUE }],
        ] as const) {
          const outputs = new Map<string, unknown>();
          const result = yield* Effect.result(run(schema(registered, id), inputs, outputs));
          assert.isTrue(Result.isFailure(result), id);
          if (Result.isFailure(result)) assert.instanceOf(result.failure, RangeError, id);
          assert.strictEqual(outputs.size, 0, id);
        }
      }),
  );
  it.effect(
    "uses seedable random sampling with explicit inclusive integer and exclusive float boundaries",
    () =>
      Effect.gen(function* () {
        const registered = yield* schemas;
        assert.deepStrictEqual(
          yield* run(schema(registered, "RandomFloat")).pipe(Random.withSeed("seed")),
          yield* run(schema(registered, "RandomFloat")).pipe(Random.withSeed("seed")),
        );
        for (let index = 0; index < 100; index++) {
          const float = (yield* run(schema(registered, "RandomFloatInRange"), {
            min: -2,
            max: 3,
          })).get("output");
          assert.isNumber(float);
          assert.isTrue(typeof float === "number" && float >= -2 && float < 3);
          const integer = (yield* run(schema(registered, "RandomIntegerInRange"), {
            min: -2,
            max: 3,
          })).get("output");
          assert.isNumber(integer);
          assert.isTrue(
            typeof integer === "number" &&
              Number.isInteger(integer) &&
              integer >= -2 &&
              integer <= 3,
          );
          assert.include([0, 1], (yield* run(schema(registered, "RandomInteger"))).get("output"));
          assert.strictEqual(
            (yield* run(schema(registered, "RandomFloatInRange"), {
              min: 1,
              max: 1 + Number.EPSILON,
            })).get("output"),
            1,
          );
        }
        for (const id of ["RandomFloatInRange", "RandomIntegerInRange"])
          assert.strictEqual(
            (yield* run(schema(registered, id), { min: 42, max: 42 })).get("output"),
            42,
          );
      }),
  );
  it.effect("samples timestamps from the injectable Effect clock", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      const before = yield* Clock.currentTimeMillis;
      for (const id of ["DateNow", "CurrentTimestamp"])
        assert.strictEqual((yield* run(schema(registered, id))).get("out"), before);
      yield* TestClock.adjust(1234);
      for (const id of ["DateNow", "CurrentTimestamp"])
        assert.strictEqual((yield* run(schema(registered, id))).get("out"), before + 1234);
    }),
  );
});
