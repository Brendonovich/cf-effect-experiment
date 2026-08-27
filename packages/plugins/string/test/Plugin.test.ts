import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Option, Result } from "effect";

import StringPlugin from "../src/Plugin.ts";

const schemas = Registration.collect(StringPlugin.effect);
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

describe("String plugin", () => {
  it.effect("defaults every string catalog input and runs pure schemas without node defaults", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const item of registered) {
        for (const input of item.dataInputs)
          assert.isTrue(DataType.isValue(input.type, input.defaultValue), `${item.id}.${input.id}`);
        if (item.type === "pure") yield* run(item);
      }
      assert.strictEqual((yield* run(schema(registered, "JoinLines"))).get("output"), "");
      for (const [id, expected] of [
        ["IntToString", "0"],
        ["FloatToString", "0"],
        ["BoolToString", "false"],
      ] as const)
        assert.strictEqual((yield* run(schema(registered, id))).get("string"), expected);
    }),
  );
  it.effect("registers 26 complete schemas and explicitly controls dynamic string pins", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      assert.lengthOf(registered, 26);
      assert.strictEqual(new Set(registered.map((item) => item.id)).size, 26);
      assert.isTrue(registered.every((item) => !!item.description));
      const create = schema(registered, "CreateString");
      assert.lengthOf(create.generateIO({ number: 0 }).dataInputs, 0);
      assert.lengthOf(create.generateIO({ number: 1024 }).dataInputs, 1024);
      for (const number of [-1, 1.5, 1025, Infinity])
        assert.throws(() => create.generateIO({ number }), RangeError);
      assert.strictEqual(
        (yield* run(create, { "value-0": "a", "value-1": "b" }, { number: 2 })).get("output"),
        "ab",
      );
      assert.strictEqual((yield* run(create, {}, { number: 0 })).get("output"), "");
      assert.strictEqual(
        (yield* run(schema(registered, "AppendString"), { one: "a", two: "b", five: "c" })).get(
          "output",
        ),
        "abc",
      );
    }),
  );
  it.effect("implements literal string transformations and UTF-16 substring boundaries", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      assert.strictEqual(
        (yield* run(schema(registered, "StringIncludes"), { input: "abc", needle: "b" })).get(
          "bool",
        ),
        true,
      );
      assert.strictEqual(
        (yield* run(schema(registered, "StringIncludes"), { input: "abc", needle: "B" })).get(
          "bool",
        ),
        false,
      );
      assert.strictEqual(
        (yield* run(schema(registered, "StringStartsWith"), { input: "abc", prefix: "ab" })).get(
          "bool",
        ),
        true,
      );
      assert.strictEqual(
        (yield* run(schema(registered, "StringStartsWith"), { input: "abc", prefix: "b" })).get(
          "bool",
        ),
        false,
      );
      assert.strictEqual(
        (yield* run(schema(registered, "StringReplaceAll"), {
          input: "a.a",
          find: "a",
          replace: "$&",
        })).get("out"),
        "$&.$&",
      );
      assert.strictEqual(
        (yield* run(schema(registered, "StringReplaceFirst"), {
          input: "a.a",
          find: "a",
          replace: "$&",
        })).get("out"),
        "$&.a",
      );
      assert.strictEqual(
        (yield* run(schema(registered, "StringReplaceAll"), {
          input: "ab",
          find: "",
          replace: ":",
        })).get("out"),
        ":a:b:",
      );
      for (const [id, input, expected] of [
        ["StringToUppercase", "Abc", "ABC"],
        ["StringToLowercase", "Abc", "abc"],
        ["ReverseString", "a\u{1f600}b", "b\u{1f600}a"],
        ["MakeString", "abc", "abc"],
      ] as const)
        assert.strictEqual((yield* run(schema(registered, id), { input })).get("output"), expected);
      assert.strictEqual(
        (yield* run(schema(registered, "StringLength"), { input: "a\u{1f600}b" })).get("int"),
        4,
      );
      const substring = schema(registered, "Substring");
      assert.strictEqual(
        (yield* run(substring, { input: "abc", start: 1, end: 0 })).get("output"),
        "bc",
      );
      assert.strictEqual(
        (yield* run(substring, { input: "abc", start: 2, end: 1 })).get("output"),
        "b",
      );
      assert.strictEqual(
        (yield* run(substring, { input: "abc", start: -2, end: 100 })).get("output"),
        "abc",
      );
      assert.isTrue(
        Result.isFailure(yield* Effect.result(run(substring, { input: "abc", start: 0.5 }))),
      );
    }),
  );
  it.effect("performs scalar formatting and strict decimal and radix parsing", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      for (const [id, input, expected] of [
        ["IntToString", -42, "-42"],
        ["FloatToString", 1.5, "1.5"],
        ["BoolToString", false, "false"],
      ] as const)
        assert.strictEqual((yield* run(schema(registered, id), { input })).get("string"), expected);
      assert.strictEqual(
        (yield* run(schema(registered, "IntToStringBase"), { int: 255, base: 16 })).get("string"),
        "ff",
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "StringToIntBase"), { string: "-FF", base: 16 })).get("int"),
        Option.some(-255),
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "StringToIntBase"), { string: "z", base: 36 })).get("int"),
        Option.some(35),
      );
      for (const input of ["12x", "0xff", "", "+", "9007199254740992"])
        assert.deepStrictEqual(
          (yield* run(schema(registered, "StringToIntBase"), { string: input, base: 16 })).get(
            "int",
          ),
          Option.none(),
        );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "StringToInt"), { string: " -1.5 " })).get("int"),
        Option.some(-2),
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "StringToFloat"), { string: " +1.5e2 " })).get("float"),
        Option.some(150),
      );
      for (const id of ["StringToInt", "StringToFloat"])
        for (const string of ["", " ", "12abc", "Infinity", "1e400", "0xff", "NaN"])
          assert.deepStrictEqual(
            (yield* run(schema(registered, id), { string })).get(
              id === "StringToInt" ? "int" : "float",
            ),
            Option.none(),
          );
      for (const base of [0, 1, 37, 2.5]) {
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(run(schema(registered, "IntToStringBase"), { int: 1, base })),
          ),
        );
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(run(schema(registered, "StringToIntBase"), { string: "1", base })),
          ),
        );
      }
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(run(schema(registered, "IntToString"), { input: 1.5 })),
        ),
      );
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(run(schema(registered, "FloatToString"), { input: Infinity })),
        ),
      );
    }),
  );
  it.effect("splits and joins text and extracts optional words", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      assert.deepStrictEqual(
        (yield* run(schema(registered, "SplitString"), { input: "a..b", separator: "." })).get(
          "output",
        ),
        ["a", "", "b"],
      );
      assert.deepStrictEqual(
        (yield* run(schema(registered, "SplitLines"), { input: "a\r\n\nb\rc" })).get("output"),
        ["a", "b", "c"],
      );
      assert.strictEqual(
        (yield* run(schema(registered, "JoinLines"), { input: Object.freeze(["a", "b"]) })).get(
          "output",
        ),
        "a\nb",
      );
      const word = schema(registered, "NthWord");
      assert.deepStrictEqual(
        (yield* run(word, { input: " one\t two\nthree ", index: 1 })).get("output"),
        Option.some("two"),
      );
      assert.deepStrictEqual(
        (yield* run(word, { input: "one two", index: -1 })).get("output"),
        Option.some("two"),
      );
      assert.deepStrictEqual(
        (yield* run(word, { input: "  ", index: 0 })).get("output"),
        Option.none(),
      );
      assert.deepStrictEqual(
        (yield* run(word, { input: "one", index: 1 })).get("output"),
        Option.none(),
      );
      assert.isTrue(
        Result.isFailure(yield* Effect.result(run(word, { input: "one", index: 0.5 }))),
      );
    }),
  );
  it.effect(
    "generates optional named regex outputs and does not retain global lastIndex state",
    () =>
      Effect.gen(function* () {
        const regex = schema(yield* schemas, "ExecuteRegex");
        const properties = { regex: "(?<word>[a-z]+)(?:-(?<number>[0-9]+))?", flags: "g" };
        assert.deepStrictEqual(
          regex.generateIO(properties).dataOutputs.map((ref) => ({ id: ref.id, type: ref.type })),
          [
            { id: "match", type: DataType.Option(DataType.String) },
            { id: "group-word", type: DataType.Option(DataType.String) },
            { id: "group-number", type: DataType.Option(DataType.String) },
          ],
        );
        for (let index = 0; index < 2; index++) {
          const result = yield* run(regex, { input: "abc-123" }, properties);
          assert.deepStrictEqual(result.get("match"), Option.some("abc-123"));
          assert.deepStrictEqual(result.get("group-word"), Option.some("abc"));
          assert.deepStrictEqual(result.get("group-number"), Option.some("123"));
        }
        assert.deepStrictEqual(
          (yield* run(regex, { input: "abc" }, properties)).get("group-number"),
          Option.none(),
        );
        const missing = yield* run(regex, { input: "123" }, properties);
        assert.deepStrictEqual(
          [...missing.values()],
          [Option.none(), Option.none(), Option.none()],
        );
        assert.throws(() => regex.generateIO({ regex: "(" }), SyntaxError);
        assert.throws(() => regex.generateIO({ flags: "gg" }), SyntaxError);
      }),
  );
  it.effect("generates UUIDs and represents invalid date parsing with None", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      const uuid = schema(registered, "UUID");
      assert.strictEqual(uuid.type, "exec");
      const first = (yield* run(uuid)).get("uuid");
      assert.isTrue(
        typeof first === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(first),
      );
      assert.notStrictEqual(first, (yield* run(uuid)).get("uuid"));
      const parse = schema(registered, "DateParse");
      assert.deepStrictEqual(
        (yield* run(parse, { timeIn: "1970-01-01T00:00:00.000Z" })).get("timeOut"),
        Option.some(0),
      );
      assert.deepStrictEqual(
        (yield* run(parse, { timeIn: "not a date" })).get("timeOut"),
        Option.none(),
      );
      assert.deepStrictEqual((yield* run(parse)).get("timeOut"), Option.none());
    }),
  );
});
