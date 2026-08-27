import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Option, Result } from "effect";

import ListPlugin from "../src/Plugin.ts";

const schemas = Registration.collect(ListPlugin.effect);
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
    .pipe(Effect.as(outputs));
};

describe("List plugin", () => {
  it.effect(
    "defaults all list inputs to empty lists and scalar inputs to typed legacy values",
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
            for (const input of item.generateIO({ type }).dataInputs)
              assert.isTrue(
                DataType.isValue(input.type, input.defaultValue),
                `${item.id}.${input.id}`,
              );
            if (item.type === "pure") yield* run(item, {}, { type });
          }
          assert.deepStrictEqual(
            (yield* run(schema(registered, "ListCreate"), {}, { type })).get("out"),
            [value],
          );
          for (const id of ["PushListValue", "InsertListValue"])
            assert.deepStrictEqual(
              (yield* run(schema(registered, id), {}, { type })).get("outList"),
              [value],
            );
          assert.deepStrictEqual(
            (yield* run(schema(registered, "GetListValue"), {}, { type })).get("return"),
            Option.none(),
          );
          assert.strictEqual(
            (yield* run(schema(registered, "ListLength"), {}, { type })).get("output"),
            0,
          );
          assert.strictEqual(
            (yield* run(schema(registered, "ListIncludes"), {}, { type })).get("output"),
            false,
          );
          assert.deepStrictEqual(
            (yield* run(schema(registered, "SliceList"), {}, { type })).get("output"),
            [],
          );
          const removed = yield* run(schema(registered, "RemoveListValue"), {}, { type });
          assert.deepStrictEqual(removed.get("returnList"), []);
          assert.deepStrictEqual(removed.get("returnValue"), Option.none());
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(run(schema(registered, "SetListValue"), {}, { type })),
            ),
          );
        }
        assert.strictEqual((yield* run(schema(registered, "JoinStringList"))).get("output"), "");
      }),
  );
  it.effect(
    "registers all seven legacy list schemas and three list utilities with concrete IO",
    () =>
      Effect.gen(function* () {
        const registered = yield* schemas;
        assert.deepStrictEqual(
          registered.map((item) => item.id),
          [
            "ListCreate",
            "PushListValue",
            "InsertListValue",
            "SetListValue",
            "RemoveListValue",
            "GetListValue",
            "JoinStringList",
            "ListIncludes",
            "ListLength",
            "SliceList",
          ],
        );
        assert.isTrue(registered.every((item) => !!item.description));
        for (const type of [DataType.String, DataType.Int, DataType.Float, DataType.Bool]) {
          for (const item of registered.filter((item) => item.id !== "JoinStringList")) {
            const io = item.generateIO({ type: type._tag });
            for (const ref of [...io.dataInputs, ...io.dataOutputs]) {
              if (ref.type._tag === "List") assert.deepStrictEqual(ref.type.item, type);
              if (ref.type._tag === "Option") assert.deepStrictEqual(ref.type.inner, type);
            }
          }
        }
        const create = schema(registered, "ListCreate");
        assert.lengthOf(create.generateIO({ number: 0 }).dataInputs, 0);
        assert.lengthOf(create.generateIO({ number: 1024 }).dataInputs, 1024);
        for (const number of [-1, 1.5, 1025, Infinity])
          assert.throws(() => create.generateIO({ number }), RangeError);
        assert.throws(() => create.generateIO({ type: "Any" }), TypeError);
      }),
  );
  it.effect("creates and edits immutable lists of every scalar type", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const [type, a, b] of [
        ["String", "a", "b"],
        ["Int", 0, 1],
        ["Float", 0.5, 1.5],
        ["Bool", false, true],
      ] as const) {
        const properties = { type };
        const list = Object.freeze([a, b]);
        assert.deepStrictEqual(
          (yield* run(
            schema(registered, "ListCreate"),
            { "value-0": a, "value-1": b },
            { type, number: 2 },
          )).get("out"),
          list,
        );
        assert.deepStrictEqual(
          (yield* run(schema(registered, "ListCreate"), {}, { type, number: 0 })).get("out"),
          [],
        );
        assert.deepStrictEqual(
          (yield* run(schema(registered, "PushListValue"), { list, value: a }, properties)).get(
            "outList",
          ),
          [a, b, a],
        );
        assert.deepStrictEqual(
          (yield* run(
            schema(registered, "InsertListValue"),
            { list, index: 2, value: a },
            properties,
          )).get("outList"),
          [a, b, a],
        );
        assert.deepStrictEqual(
          (yield* run(
            schema(registered, "InsertListValue"),
            { list, index: -1, value: a },
            properties,
          )).get("outList"),
          [a, a, b],
        );
        assert.deepStrictEqual(
          (yield* run(
            schema(registered, "SetListValue"),
            { list, index: -1, value: a },
            properties,
          )).get("outList"),
          [a, a],
        );
        const removed = yield* run(
          schema(registered, "RemoveListValue"),
          { list, index: 0 },
          properties,
        );
        assert.deepStrictEqual(removed.get("returnList"), [b]);
        assert.deepStrictEqual(removed.get("returnValue"), Option.some(a));
        assert.deepStrictEqual(
          (yield* run(schema(registered, "GetListValue"), { list, index: -1 }, properties)).get(
            "return",
          ),
          Option.some(b),
        );
        assert.deepStrictEqual(list, [a, b]);
      }
    }),
  );
  it.effect("handles empty lists, invalid indices, and missing elements deliberately", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      assert.deepStrictEqual(
        (yield* run(schema(registered, "InsertListValue"), { list: [], index: 0, value: "a" })).get(
          "outList",
        ),
        ["a"],
      );
      for (const id of ["InsertListValue", "SetListValue"])
        for (const index of [-3, 3, 0.5, Infinity, NaN])
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(
                run(schema(registered, id), { list: ["a", "b"], index, value: "x" }),
              ),
            ),
          );
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(
            run(schema(registered, "SetListValue"), { list: [], index: 0, value: "x" }),
          ),
        ),
      );
      const list = Object.freeze(["a", "b"]);
      for (const index of [-3, 2, 100]) {
        const removed = yield* run(schema(registered, "RemoveListValue"), { list, index });
        assert.deepStrictEqual(removed.get("returnValue"), Option.none());
        assert.deepStrictEqual(removed.get("returnList"), list);
        assert.notStrictEqual(removed.get("returnList"), list);
        assert.deepStrictEqual(
          (yield* run(schema(registered, "GetListValue"), { list, index })).get("return"),
          Option.none(),
        );
      }
      for (const id of ["GetListValue", "RemoveListValue"])
        assert.isTrue(
          Result.isFailure(yield* Effect.result(run(schema(registered, id), { list, index: 0.5 }))),
        );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "GetListValue"), { list: [], index: 0 })).get("return"),
        Option.none(),
      );
    }),
  );
  it.effect("joins, counts, searches, and slices lists", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      const list = Object.freeze(["a", "b", "c"]);
      assert.strictEqual(
        (yield* run(schema(registered, "JoinStringList"), { input: list, separator: ":" })).get(
          "output",
        ),
        "a:b:c",
      );
      assert.strictEqual(
        (yield* run(schema(registered, "JoinStringList"), { input: [], separator: ":" })).get(
          "output",
        ),
        "",
      );
      assert.strictEqual((yield* run(schema(registered, "ListLength"), { list })).get("output"), 3);
      assert.strictEqual(
        (yield* run(schema(registered, "ListIncludes"), { list, input: "b" })).get("output"),
        true,
      );
      assert.strictEqual(
        (yield* run(schema(registered, "ListIncludes"), { list, input: "x" })).get("output"),
        false,
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "SliceList"), { list, start: -2, end: 0 })).get("output"),
        ["b", "c"],
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "SliceList"), { list, start: 0, end: -1 })).get("output"),
        ["a", "b"],
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "SliceList"), { list, start: 10, end: 0 })).get("output"),
        [],
      );
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(run(schema(registered, "SliceList"), { list, start: 0.5, end: 0 })),
        ),
      );
    }),
  );
});
