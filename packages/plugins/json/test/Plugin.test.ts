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
      assert.lengthOf(registered, 13);
      assert.strictEqual(new Set(registered.map((item) => item.id)).size, 13);
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
      assert.throws(() => schema(registered, "ToJSON").generateIO({ type: "Map" }), TypeError);
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
        for (const input of ["", "undefined", "{", "NaN", "[1,]", "1e400", '{"nested":[1e400]}'])
          assert.isTrue(
            Result.isFailure(yield* Effect.result(run(schema(registered, id), { in: input }))),
          );
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
      for (const path of ["a", "/bad~2escape", "/bad~"])
        assert.isTrue(
          Result.isFailure(yield* Effect.result(run(query, { in: input }, { query: path }))),
        );
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
});
