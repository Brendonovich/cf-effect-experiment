import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Option, Result } from "effect";

import JsonPlugin from "../src/Plugin.ts";

const schemas = Registration.collect(JsonPlugin.effect);
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

describe("JSON plugin", () => {
  it.effect("rejects unsafe Int extraction without rejecting large finite Float values", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const value of [
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER - 1,
        Number.MAX_SAFE_INTEGER + 1,
        -1e100,
        1e100,
      ]) {
        const input = JSON.stringify(value);
        const expected = Number.isSafeInteger(value) ? Option.some(value) : Option.none();
        assert.deepStrictEqual(
          (yield* run(schema(registered, "JSONGetInt"), { in: input })).get("out"),
          expected,
        );
        assert.deepStrictEqual(
          (yield* run(schema(registered, "FromJSON"), { in: input }, { type: "Int" })).get("out"),
          expected,
        );
        assert.deepStrictEqual(
          (yield* run(schema(registered, "JSONGetNumber"), { in: input })).get("out"),
          Option.some(value),
        );
        assert.deepStrictEqual(
          (yield* run(schema(registered, "FromJSON"), { in: input }, { type: "Float" })).get("out"),
          Option.some(value),
        );
        for (const values of [[value], [0, value], [value, 0]]) {
          const input = JSON.stringify(values);
          const expected = Number.isSafeInteger(value) ? Option.some(values) : Option.none();
          for (const id of ["FromJSON", "JSONGetScalarList"]) {
            assert.deepStrictEqual(
              (yield* run(schema(registered, id), { in: input }, { type: "Int", list: true })).get(
                "out",
              ),
              expected,
            );
            assert.deepStrictEqual(
              (yield* run(
                schema(registered, id),
                { in: input },
                { type: "Float", list: true },
              )).get("out"),
              Option.some(values),
            );
          }
        }
      }
    }),
  );
  it.effect("defaults JSON conversions and all other inputs to valid typed values", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const [type, value] of [
        ["String", ""],
        ["Int", 0],
        ["Float", 0],
        ["Bool", false],
      ] as const) {
        for (const list of [false, true]) {
          const properties = { type, list };
          for (const item of registered) {
            for (const input of item.generateIO(properties).dataInputs)
              assert.isTrue(
                DataType.isValue(input.type, input.defaultValue),
                `${item.id}.${input.id}`,
              );
            if (item.type === "pure") yield* run(item, {}, properties);
          }
          assert.strictEqual(
            (yield* run(schema(registered, "ToJSON"), {}, properties)).get("out"),
            JSON.stringify(list ? [] : value),
          );
        }
      }
    }),
  );
  it.effect("registers a JSON text catalog and generates concretely typed conversion IO", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      assert.lengthOf(registered, 19);
      assert.strictEqual(new Set(registered.map((item) => item.id)).size, 19);
      assert.isTrue(registered.every((item) => !!item.description));
      for (const type of [DataType.String, DataType.Int, DataType.Float, DataType.Bool]) {
        for (const list of [false, true]) {
          const expected = list ? DataType.List(type) : type;
          assert.deepStrictEqual(
            schema(registered, "ToJSON").generateIO({ type: type._tag, list }).dataInputs[0]?.type,
            expected,
          );
          assert.deepStrictEqual(
            schema(registered, "FromJSON").generateIO({ type: type._tag, list }).dataOutputs[0]
              ?.type,
            DataType.Option(expected),
          );
        }
        assert.deepStrictEqual(
          schema(registered, "JSONGetScalarList").generateIO({ type: type._tag }).dataOutputs[0]
            ?.type,
          DataType.Option(DataType.List(type)),
        );
      }
      for (const id of ["ToJSON", "FromJSON", "JSONGetScalarList"]) {
        const item = schema(registered, id);
        assert.deepStrictEqual(
          item.generateIO({ type: "Map" }),
          item.generateIO({ type: "String" }),
        );
        const result = yield* Effect.result(run(item, {}, { type: "Map" }));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.instanceOf(result.failure, TypeError);
      }
    }),
  );
  it.effect("validates and normalizes JSON without silently accepting overflow", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const id of ["ParseJSON", "StringifyJSON"]) {
        assert.strictEqual(
          (yield* run(schema(registered, id), { in: ' { "a": [1, true, null] } ' })).get("out"),
          '{"a":[1,true,null]}',
        );
        assert.strictEqual((yield* run(schema(registered, id))).get("out"), "null");
        for (const input of ["", "undefined", "{", "NaN", "[1,]"]) {
          const result = yield* Effect.result(run(schema(registered, id), { in: input }));
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.instanceOf(result.failure, SyntaxError);
        }
        for (const input of ["1e400", '{"nested":[1e400]}']) {
          const result = yield* Effect.result(run(schema(registered, id), { in: input }));
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) {
            assert.instanceOf(result.failure, RangeError);
            assert.strictEqual(result.failure.message, "JSON numbers must be finite");
          }
        }
      }
    }),
  );
  it.effect("roundtrips all scalar types and homogeneous lists with typed mismatch options", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const [type, value, getter] of [
        ["String", "", "JSONGetString"],
        ["Int", 0, "JSONGetInt"],
        ["Float", 1.5, "JSONGetNumber"],
        ["Bool", false, "JSONGetBoolean"],
      ] as const) {
        for (const list of [false, true]) {
          const input = list ? Object.freeze([value, value]) : value;
          const text = (yield* run(
            schema(registered, "ToJSON"),
            { in: input },
            { type, list },
          )).get("out");
          assert.strictEqual(text, JSON.stringify(input));
          assert.deepStrictEqual(
            (yield* run(schema(registered, "FromJSON"), { in: text }, { type, list })).get("out"),
            Option.some(input),
          );
        }
        assert.deepStrictEqual(
          (yield* run(schema(registered, getter), { in: JSON.stringify(value) })).get("out"),
          Option.some(value),
        );
        assert.deepStrictEqual(
          (yield* run(schema(registered, getter), { in: "null" })).get("out"),
          Option.none(),
        );
        assert.deepStrictEqual(
          (yield* run(schema(registered, "JSONGetScalarList"), { in: "[]" }, { type })).get("out"),
          Option.some([]),
        );
        assert.deepStrictEqual(
          (yield* run(schema(registered, "JSONGetScalarList"), { in: '[1,"a"]' }, { type })).get(
            "out",
          ),
          Option.none(),
        );
      }
      assert.deepStrictEqual(
        (yield* run(schema(registered, "JSONGetInt"), { in: "1.5" })).get("out"),
        Option.none(),
      );
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(
            run(schema(registered, "ToJSON"), { in: Infinity }, { type: "Float" }),
          ),
        ),
      );
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(run(schema(registered, "JSONGetString"), { in: "malformed" })),
        ),
      );
    }),
  );
  it.effect("queries own keys safely and distinguishes missing values from JSON null", () =>
    Effect.gen(function* () {
      const query = schema(yield* schemas, "QueryJSON");
      const input =
        '{"a":[{"b":false},null],"a/b":{"~key":0},"":null,"constructor":"own","__proto__":{"safe":true}}';
      for (const [path, expected] of [
        [".a.0.b", "false"],
        ["/a/1", "null"],
        ["/a~1b/~0key", "0"],
        ["/", "null"],
        [".constructor", '"own"'],
        [".__proto__.safe", "true"],
      ] as const)
        assert.deepStrictEqual(
          (yield* run(query, { in: input }, { query: path })).get("out"),
          Option.some(expected),
        );
      for (const path of [
        ".a.2",
        ".a.01",
        ".a.length",
        ".a.map",
        ".toString",
        ".a.1.x",
        ".a.0.b.value",
        ".missing",
        ".constructor.prototype",
      ])
        assert.deepStrictEqual(
          (yield* run(query, { in: input }, { query: path })).get("out"),
          Option.none(),
        );
      for (const path of ["", "."])
        assert.deepStrictEqual(
          (yield* run(query, { in: "null" }, { query: path })).get("out"),
          Option.some("null"),
        );
      for (const path of ["a", "/bad~2escape", "/bad~"]) {
        const result = yield* Effect.result(run(query, { in: input }, { query: path }));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.instanceOf(result.failure, SyntaxError);
      }
    }),
  );
  it.effect("extracts nested JSON lists and exposes map contents without a map data type", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      assert.deepStrictEqual(
        (yield* run(schema(registered, "JSONGetList"), { in: '["a",null,{"b":1},[false]]' })).get(
          "out",
        ),
        Option.some(['"a"', "null", '{"b":1}', "[false]"]),
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "JSONGetList"), { in: "{}" })).get("out"),
        Option.none(),
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "JSONGetObjectKeys"), {
          in: '{"a":1,"__proto__":null}',
        })).get("out"),
        Option.some(["a", "__proto__"]),
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "JSONGetObjectKeys"), { in: "[]" })).get("out"),
        Option.none(),
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "JSONGetProperty"), { in: '{"a.b":null}', key: "a.b" })).get(
          "out",
        ),
        Option.some("null"),
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "JSONGetProperty"), { in: "{}", key: "__proto__" })).get(
          "out",
        ),
        Option.none(),
      );
    }),
  );
  it.effect("creates objects with dynamic JSON entries and last-write-wins keys", () =>
    Effect.gen(function* () {
      const create = schema(yield* schemas, "JSONCreateObject");
      assert.strictEqual((yield* run(create, {}, { number: 0 })).get("out"), "{}");
      assert.lengthOf(create.generateIO({ number: 3 }).dataInputs, 6);
      const result = yield* run(
        create,
        {
          "key-0": "__proto__",
          "value-0": '{"safe":true}',
          "key-1": "a",
          "value-1": "false",
          "key-2": "a",
          "value-2": "null",
        },
        { number: 3 },
      );
      assert.strictEqual(result.get("out"), '{"__proto__":{"safe":true},"a":null}');
      for (const number of [-1, 1.5, 1025, Infinity, NaN]) {
        assert.lengthOf(create.generateIO({ number }).dataInputs, 0);
        const result = yield* Effect.result(run(create, {}, { number }));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.instanceOf(result.failure, RangeError);
      }
      for (const value of ["{", "1e400", '{"a":[1e400]}'])
        assert.isTrue(Result.isFailure(yield* Effect.result(run(create, { "value-0": value }))));
    }),
  );
  it.effect("edits own keys immutably and distinguishes missing keys from null", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      const source = '{"a":null,"b":[1,false],"__proto__":{"safe":true}}';
      const set = schema(registered, "JSONSetProperty");
      const remove = schema(registered, "JSONRemoveProperty");
      const has = schema(registered, "JSONHasProperty");
      for (const [key, expected] of [
        ["a", "null"],
        ["b", "[1,false]"],
        ["__proto__", '{"safe":true}'],
      ] as const) {
        const result = yield* run(set, { in: source, key, value: '"new"' });
        assert.deepStrictEqual(result.get("previous"), Option.some(expected));
        assert.deepStrictEqual(
          (yield* run(schema(registered, "JSONGetProperty"), { in: result.get("out"), key })).get(
            "out",
          ),
          Option.some('"new"'),
        );
        const removed = yield* run(remove, { in: source, key });
        assert.deepStrictEqual(removed.get("removed"), Option.some(expected));
        assert.strictEqual((yield* run(has, { in: removed.get("out"), key })).get("out"), false);
        assert.strictEqual((yield* run(has, { in: source, key })).get("out"), true);
      }
      for (const key of ["missing", "constructor", "toString"]) {
        assert.strictEqual((yield* run(has, { in: source, key })).get("out"), false);
        const removed = yield* run(remove, { in: source, key });
        assert.deepStrictEqual(removed.get("removed"), Option.none());
        assert.strictEqual(removed.get("out"), source);
        assert.deepStrictEqual(
          (yield* run(set, { in: source, key, value: "0" })).get("previous"),
          Option.none(),
        );
      }
      assert.strictEqual(
        (yield* run(set, { in: "{}", key: "__proto__", value: "null" })).get("out"),
        '{"__proto__":null}',
      );
      assert.strictEqual(
        (yield* run(schema(registered, "JSONGetObjectSize"), { in: source })).get("out"),
        3,
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "JSONGetObjectValues"), { in: source })).get("out"),
        ["null", "[1,false]", '{"safe":true}'],
      );
      for (const id of [
        "JSONSetProperty",
        "JSONRemoveProperty",
        "JSONHasProperty",
        "JSONGetObjectSize",
        "JSONGetObjectValues",
      ])
        for (const input of ["null", "[]", "1", '"text"', "false", "{", '{"a":1e400}']) {
          const result = yield* Effect.result(run(schema(registered, id), { in: input }));
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result))
            assert.instanceOf(
              result.failure,
              input === "{" ? SyntaxError : input === '{"a":1e400}' ? RangeError : TypeError,
            );
        }
      assert.isTrue(Result.isFailure(yield* Effect.result(run(set, { value: "1e400" }))));
    }),
  );
});
