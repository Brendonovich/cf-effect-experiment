import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/module";
import { DataType } from "@macrograph/module/DataType";
import { DateTime, Effect, Option, Random, Result, Schema } from "effect";

import ListModule from "../src/Module.ts";

const schemas = Registration.collect(ListModule.effect);
const schema = (registered: ReadonlyArray<Registration.RegisteredSchema>, id: string) => {
  const found = registered.find((item) => item.id === id);
  assert.isDefined(found);
  return found;
};
const run = (
  registered: Registration.RegisteredSchema,
  inputs: Readonly<Record<string, unknown>> = {},
  options: Readonly<Record<string, unknown>> = {},
  definitions: DataType.Definitions = {},
) => {
  // Type bindings model a connected anchor, not a node property.
  const { type: binding = DataType.String, ...properties } = options;
  const inferred = Schema.decodeUnknownSync(DataType.Descriptor)(
    typeof binding === "string" ? { _tag: binding } : binding,
  );
  const resolve = (type: DataType.Any): DataType.Any =>
    type._tag === "Wildcard"
      ? inferred
      : type._tag === "List"
        ? DataType.List(resolve(type.item))
        : type._tag === "Option"
          ? DataType.Option(resolve(type.inner))
          : type;
  const outputs = new Map<string, unknown>();
  return registered
    .run({
      input: (ref) => (Object.hasOwn(inputs, ref.id) ? inputs[ref.id] : ref.defaultValue),
      output: (ref, value) => {
        assert.isTrue(DataType.isValue(resolve(ref.type), value, definitions), ref.id);
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

describe("List module", () => {
  it.effect(
    "supports nested/custom wildcard bindings across creation, edits, lookup, membership and utilities",
    () =>
      Effect.gen(function* () {
        const registered = yield* schemas;
        const id = DataType.DefinitionId.make("item");
        const custom = DataType.Custom(id);
        const definitions: DataType.Definitions = {
          item: {
            _tag: "Struct",
            id,
            name: "Item",
            fields: [{ name: "count", type: DataType.Int }],
          },
        };
        const item = Object.freeze({ _type: id, count: 1 });
        const cases = [
          { type: custom, a: item, b: { _type: id, count: 2 }, equal: { _type: id, count: 1 } },
          { type: DataType.List(custom), a: [item], b: [], equal: [{ _type: id, count: 1 }] },
          {
            type: DataType.Option(DataType.List(custom)),
            a: Option.some([item]),
            b: Option.none(),
            equal: Option.some([{ _type: id, count: 1 }]),
          },
          {
            type: DataType.DateTime,
            a: DateTime.makeUnsafe("2026-08-31T00:00:00Z"),
            b: DateTime.makeUnsafe("2026-09-01T00:00:00Z"),
            equal: DateTime.makeUnsafe("2026-08-31T00:00:00Z"),
          },
        ];
        for (const { type, a, b, equal } of cases) {
          const properties = { type };
          const list = Object.freeze([a, b]);
          const execute = (
            id: string,
            inputs: Readonly<Record<string, unknown>> = {},
            extra = {},
          ) => run(schema(registered, id), inputs, { ...properties, ...extra }, definitions);
          for (const operation of registered.filter((schema) => schema.id !== "JoinStringList")) {
            for (const ref of [
              ...operation.generateIO(properties).dataInputs,
              ...operation.generateIO(properties).dataOutputs,
            ]) {
              if (
                ref.type._tag === "List" &&
                !["value", "input"].includes(ref.id) &&
                !ref.id.startsWith("value-")
              )
                assert.deepStrictEqual(ref.type.item, DataType.Wildcard("Item"));
            }
          }
          assert.deepStrictEqual(
            (yield* execute("ListCreate", { "value-0": a, "value-1": b }, { number: 2 })).get(
              "out",
            ),
            list,
          );
          assert.deepStrictEqual(
            (yield* execute("PushListValue", { list, value: a })).get("outList"),
            [a, b, a],
          );
          assert.deepStrictEqual(
            (yield* execute("InsertListValue", { list, value: a, index: 1 })).get("outList"),
            [a, a, b],
          );
          assert.deepStrictEqual(
            (yield* execute("SetListValue", { list, value: a, index: -1 })).get("outList"),
            [a, a],
          );
          assert.deepStrictEqual(
            (yield* execute("GetListValue", { list, index: 0 })).get("return"),
            Option.some(a),
          );
          assert.deepStrictEqual(
            (yield* execute("RemoveListValue", { list, index: 0 })).get("returnValue"),
            Option.some(a),
          );
          assert.deepStrictEqual(
            (yield* execute("GetRandomListItem", { list: [a] })).get("return"),
            Option.some(a),
          );
          assert.strictEqual(
            (yield* execute("ListIncludes", { list, input: equal })).get("output"),
            true,
          );
          assert.strictEqual((yield* execute("ListLength", { list })).get("output"), 2);
          assert.deepStrictEqual((yield* execute("SliceList", { list, start: 1 })).get("output"), [
            b,
          ]);
          assert.deepStrictEqual(list, [a, b]);
        }
        for (const name of ["PushListValue", "ListCreate"]) {
          const io = schema(registered, name).generateIO({});
          assert.isUndefined(
            io.dataInputs.find((input) => input.type._tag === "Wildcard")?.defaultValue,
          );
        }
        assert.strictEqual(
          (yield* run(
            schema(registered, "ListIncludes"),
            { list: [item], input: { _type: "other", count: 1 } },
            { type: custom },
            definitions,
          )).get("output"),
          false,
        );
      }),
  );
  it.effect(
    "defaults containers but requires wildcard values instead of inventing scalar defaults",
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
            for (const input of item.generateIO({}).dataInputs) {
              if (input.type._tag === "Wildcard") assert.isUndefined(input.defaultValue);
              else if (input.type._tag === "List") assert.deepStrictEqual(input.defaultValue, []);
              else assert.isTrue(DataType.isValue(input.type, input.defaultValue));
            }
          }
          assert.deepStrictEqual(
            (yield* run(schema(registered, "ListCreate"), { "value-0": value }, { type })).get(
              "out",
            ),
            [value],
          );
          for (const id of ["PushListValue", "InsertListValue"])
            assert.deepStrictEqual(
              (yield* run(schema(registered, id), { value }, { type })).get("outList"),
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
            (yield* run(schema(registered, "ListIncludes"), { input: value }, { type })).get(
              "output",
            ),
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
    "registers all list schemas with a shared item wildcard and only the Entries property",
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
            "GetRandomListItem",
            "JoinStringList",
            "ListIncludes",
            "ListLength",
            "SliceList",
          ],
        );
        assert.isTrue(registered.every((item) => !!item.description));
        for (const item of registered.filter((item) => item.id !== "JoinStringList")) {
          const io = item.generateIO({});
          assert.deepStrictEqual(
            item.properties.map((property) => property.id),
            item.id === "ListCreate" ? ["number"] : [],
          );
          for (const ref of [...io.dataInputs, ...io.dataOutputs]) {
            if (ref.type._tag === "List")
              assert.deepStrictEqual(ref.type.item, DataType.Wildcard("Item"));
            if (ref.type._tag === "Option")
              assert.deepStrictEqual(ref.type.inner, DataType.Wildcard("Item"));
          }
        }
        const create = schema(registered, "ListCreate");
        assert.lengthOf(create.generateIO({ number: 0 }).dataInputs, 0);
        assert.lengthOf(create.generateIO({ number: 1024 }).dataInputs, 1024);
        for (const number of [-1, 1.5, 1025, Infinity, NaN]) {
          assert.lengthOf(create.generateIO({ number }).dataInputs, 0);
          const result = yield* Effect.result(run(create, {}, { number }));
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.instanceOf(result.failure, RangeError);
        }
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
  it.effect("samples list items only on execution using injectable randomness", () =>
    Effect.gen(function* () {
      const random = schema(yield* schemas, "GetRandomListItem");
      assert.strictEqual(random.type, "exec");
      assert.deepStrictEqual(
        random.executionInputs.map((ref) => ref.id),
        ["exec"],
      );
      assert.deepStrictEqual(
        random.executionOutputs.map((ref) => ref.id),
        ["exec"],
      );
      let samples = 0;
      const source = {
        nextIntUnsafe: () => 0,
        nextDoubleUnsafe: () => {
          samples++;
          return 0.5;
        },
      };
      assert.deepStrictEqual(
        (yield* run(random).pipe(Effect.provideService(Random.Random, source))).get("return"),
        Option.none(),
      );
      assert.strictEqual(samples, 0);
      for (const [type, values] of [
        ["String", ["a", "", "c"]],
        ["Int", [-1, 0, 1]],
        ["Float", [-1.5, 0, 1.5]],
        ["Bool", [true, false, true]],
      ] as const) {
        const list = Object.freeze([...values]);
        assert.deepStrictEqual(
          (yield* run(random, { list }, { type }).pipe(
            Effect.provideService(Random.Random, source),
          )).get("return"),
          Option.some(values[1]),
        );
        assert.deepStrictEqual(list, values);
        for (const [sample, index] of [
          [0, 0],
          [0.999999, 2],
          [1, 2],
        ] as const)
          assert.deepStrictEqual(
            (yield* run(random, { list }, { type }).pipe(
              Effect.provideService(Random.Random, { ...source, nextDoubleUnsafe: () => sample }),
            )).get("return"),
            Option.some(values[index]),
          );
        assert.deepStrictEqual(
          (yield* run(random, { list: [values[1]] }, { type })).get("return"),
          Option.some(values[1]),
        );
      }
      assert.strictEqual(samples, 4);
      assert.deepStrictEqual(
        yield* run(random, { list: ["a", "b", "c"] }).pipe(Random.withSeed("list")),
        yield* run(random, { list: ["a", "b", "c"] }).pipe(Random.withSeed("list")),
      );
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
        for (const index of [0.5, Infinity, NaN]) {
          const result = yield* Effect.result(run(schema(registered, id), { list, index }));
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) {
            assert.instanceOf(result.failure, RangeError);
            assert.strictEqual(result.failure.message, "Index must be a safe integer");
          }
        }
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
