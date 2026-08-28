import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect, Option } from "effect";

const radix = Effect.fnUntraced(function* (base: number) {
  if (!Number.isInteger(base) || base < 2 || base > 36)
    return yield* Effect.fail(new RangeError("Base must be an integer between 2 and 36"));
  return base;
});
const validEntries = (number: number) =>
  Number.isSafeInteger(number) && number >= 0 && number <= 1024;
const decimal = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

const StringPlugin = Plugin.make({
  id: "string",
  name: "String",
  effect: Effect.fnUntraced(function* (context) {
    for (const [id, name, second, calculate] of [
      ["StringIncludes", "String Includes", "needle", (a: string, b: string) => a.includes(b)],
      [
        "StringStartsWith",
        "String Starts With",
        "prefix",
        (a: string, b: string) => a.startsWith(b),
      ],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description: "Performs a case-sensitive literal string comparison.",
        type: "pure",
        io: (io) => ({
          input: io.data.in("input", DataType.String, { defaultValue: "" }),
          second: io.data.in(second, DataType.String, { defaultValue: "" }),
          output: io.data.out("bool", DataType.Bool),
        }),
        run: ({ io }) => Effect.sync(() => io.output(calculate(io.input, io.second))),
      });
    }
    for (const [id, name, all] of [
      ["StringReplaceAll", "String Replace All", true],
      ["StringReplaceFirst", "String Replace First", false],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description:
          "Replaces literal text. Replacement text is literal, including dollar signs; the search is not a regex.",
        type: "pure",
        io: (io) => ({
          input: io.data.in("input", DataType.String, { defaultValue: "" }),
          find: io.data.in("find", DataType.String, { defaultValue: "" }),
          replace: io.data.in("replace", DataType.String, { defaultValue: "" }),
          output: io.data.out("out", DataType.String),
        }),
        run: ({ io }) =>
          Effect.sync(() =>
            io.output(
              all
                ? io.input.replaceAll(io.find, () => io.replace)
                : io.input.replace(io.find, () => io.replace),
            ),
          ),
      });
    }
    yield* context.schema.register({
      id: "StringLength",
      name: "String Length",
      description: "Counts UTF-16 code units, matching JavaScript string length.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.String, { defaultValue: "" }),
        output: io.data.out("int", DataType.Int),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.length)),
    });
    yield* context.schema.register({
      id: "Substring",
      name: "Substring",
      description:
        "Extracts UTF-16 code units using clamped, end-exclusive substring indices. End 0 means the string's end; reversed bounds are swapped.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.String, { defaultValue: "" }),
        start: io.data.in("start", DataType.Int, { defaultValue: 0 }),
        end: io.data.in("end", DataType.Int, { defaultValue: 0 }),
        output: io.data.out("output", DataType.String),
      }),
      run: ({ io }) =>
        Number.isSafeInteger(io.start) && Number.isSafeInteger(io.end)
          ? Effect.sync(() =>
              io.output(io.input.substring(io.start, io.end === 0 ? undefined : io.end)),
            )
          : Effect.fail(new RangeError("Substring indices must be safe integers")),
    });
    for (const [id, name, calculate] of [
      ["StringToUppercase", "String To Uppercase", (value: string) => value.toUpperCase()],
      ["StringToLowercase", "String To Lowercase", (value: string) => value.toLowerCase()],
      ["ReverseString", "Reverse String", (value: string) => [...value].reverse().join("")],
      ["MakeString", "Make String", (value: string) => value],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description: `${name}. Reverse String reverses Unicode code points, not grapheme clusters.`,
        type: "pure",
        io: (io) => ({
          input: io.data.in("input", DataType.String, { defaultValue: "" }),
          output: io.data.out("output", DataType.String),
        }),
        run: ({ io }) => Effect.sync(() => io.output(calculate(io.input))),
      });
    }
    yield* context.schema.register({
      id: "AppendString",
      name: "Append String",
      description: "Concatenates five strings without a separator.",
      type: "pure",
      io: (io) => ({
        inputs: ["one", "two", "three", "four", "five"].map((id) =>
          io.data.in(id, DataType.String, { defaultValue: "" }),
        ),
        output: io.data.out("output", DataType.String),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.inputs.join(""))),
    });
    yield* context.schema.register({
      id: "CreateString",
      name: "Create String",
      description:
        "Concatenates 0 to 1024 strings. Entries explicitly controls the pin count instead of legacy connection-driven pins.",
      type: "pure",
      properties: { number: { name: "Entries", type: DataType.Int, defaultValue: 1 } },
      io: (io, properties) => ({
        inputs: Array.from(
          { length: validEntries(properties.number) ? properties.number : 0 },
          (_, index) => io.data.in(`value-${index}`, DataType.String, { defaultValue: "" }),
        ),
        output: io.data.out("output", DataType.String),
      }),
      run: ({ io, properties }) =>
        validEntries(properties.number)
          ? Effect.sync(() => io.output(io.inputs.join("")))
          : Effect.fail(new RangeError("Entries must be an integer between 0 and 1024")),
    });
    for (const [id, name, type] of [
      ["IntToString", "Int To String", DataType.Int],
      ["FloatToString", "Float To String", DataType.Float],
      ["BoolToString", "Bool To String", DataType.Bool],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description: "Converts a scalar value to its string representation.",
        type: "pure",
        io: (io) => ({
          input: io.data.in("input", type, { defaultValue: type._tag === "Bool" ? false : 0 }),
          output: io.data.out("string", DataType.String),
        }),
        run: ({ io }) =>
          DataType.isValue(type, io.input)
            ? Effect.sync(() => io.output(String(io.input)))
            : Effect.fail(new TypeError("Input does not match the scalar conversion type")),
      });
    }
    yield* context.schema.register({
      id: "IntToStringBase",
      name: "Int To String (Specify Base)",
      description: "Formats a safe integer using base 2 through 36.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("int", DataType.Int, { defaultValue: 0 }),
        base: io.data.in("base", DataType.Int, { defaultValue: 10 }),
        output: io.data.out("string", DataType.String),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          if (!Number.isSafeInteger(io.input))
            return yield* Effect.fail(new RangeError("Expected a safe integer"));
          const base = yield* radix(io.base);
          yield* Effect.try({
            try: () => io.output(io.input.toString(base)),
            catch: (error) => error,
          });
        }),
    });
    for (const [id, name, type] of [
      ["StringToInt", "String To Int", DataType.Int],
      ["StringToFloat", "String To Float", DataType.Float],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description:
          "Parses a complete decimal numeric literal (surrounding whitespace allowed). Empty, partial, nonfinite, or unsafe integer results return None. String To Int rounds down.",
        type: "pure",
        io: (io) => ({
          input: io.data.in("string", DataType.String, { defaultValue: "" }),
          output: io.data.out(type._tag === "Int" ? "int" : "float", DataType.Option(type)),
        }),
        run: ({ io }) =>
          Effect.sync(() => {
            const text = io.input.trim();
            const parsed = Number(text);
            const value = type._tag === "Int" ? Math.floor(parsed) : parsed;
            io.output(
              decimal.test(text) &&
                Number.isFinite(value) &&
                (type._tag !== "Int" || Number.isSafeInteger(value))
                ? Option.some(value)
                : Option.none(),
            );
          }),
      });
    }
    yield* context.schema.register({
      id: "StringToIntBase",
      name: "String To Int (Specify Base)",
      description:
        "Parses a complete signed integer in base 2 through 36, without radix prefixes. Invalid digits or unsafe results return None; invalid bases fail.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("string", DataType.String, { defaultValue: "" }),
        base: io.data.in("base", DataType.Int, { defaultValue: 10 }),
        output: io.data.out("int", DataType.Option(DataType.Int)),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const base = yield* radix(io.base);
          yield* Effect.try({
            try: () => {
              const text = io.input.trim();
              const digits = text.replace(/^[+-]/, "").toLowerCase();
              const value = Number.parseInt(text, base);
              const valid =
                digits.length > 0 &&
                [...digits].every((digit) => {
                  const index = "0123456789abcdefghijklmnopqrstuvwxyz".indexOf(digit);
                  return index >= 0 && index < base;
                });
              io.output(valid && Number.isSafeInteger(value) ? Option.some(value) : Option.none());
            },
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "SplitString",
      name: "Split String",
      description:
        "Splits a string using a literal separator. An empty separator splits UTF-16 code units.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.String, { defaultValue: "" }),
        separator: io.data.in("separator", DataType.String, { defaultValue: "" }),
        output: io.data.out("output", DataType.List(DataType.String)),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.split(io.separator))),
    });
    yield* context.schema.register({
      id: "SplitLines",
      name: "Split Lines",
      description:
        "Splits on runs of CR or LF, matching legacy behavior (consecutive line breaks collapse).",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.String, { defaultValue: "" }),
        output: io.data.out("output", DataType.List(DataType.String)),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.split(/[\r\n]+/))),
    });
    yield* context.schema.register({
      id: "JoinLines",
      name: "Join Lines",
      description: "Joins a list of strings with LF line breaks.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.List(DataType.String), { defaultValue: [] }),
        output: io.data.out("output", DataType.String),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.join("\n"))),
    });
    yield* context.schema.register({
      id: "NthWord",
      name: "Nth Word",
      description:
        "Gets a zero-based whitespace-delimited word. Empty text and out-of-range indices return None; negative indices count from the end.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.String, { defaultValue: "" }),
        index: io.data.in("index", DataType.Int, { defaultValue: 0 }),
        output: io.data.out("output", DataType.Option(DataType.String)),
      }),
      run: ({ io }) =>
        Number.isSafeInteger(io.index)
          ? Effect.sync(() => {
              const text = io.input.trim();
              io.output(
                text === "" ? Option.none() : Option.fromNullishOr(text.split(/\s+/).at(io.index)),
              );
            })
          : Effect.fail(new RangeError("Word index must be a safe integer")),
    });
    yield* context.schema.register({
      id: "ExecuteRegex",
      name: "Execute Regex",
      description:
        "Executes a JavaScript regex once, returning an optional full match and optional named groups. Invalid regex properties fail IO generation; unmatched groups return None.",
      properties: {
        regex: { name: "Regex", type: DataType.String, defaultValue: "" },
        flags: { name: "Flags", type: DataType.String, defaultValue: "" },
      },
      io: (io, properties) => {
        const regex = new RegExp(`(?:${properties.regex})|`, properties.flags);
        const names = Object.keys(regex.exec("")?.groups ?? {});
        return {
          input: io.data.in("input", DataType.String, { defaultValue: "" }),
          output: io.data.out("match", DataType.Option(DataType.String)),
          groups: names.map((name) => ({
            name,
            output: io.data.out(`group-${name}`, DataType.Option(DataType.String), { name }),
          })),
        };
      },
      run: ({ io, properties }) =>
        Effect.try({
          try: () => {
            const match = new RegExp(properties.regex, properties.flags).exec(io.input);
            io.output(Option.fromNullishOr(match?.[0]));
            for (const group of io.groups)
              group.output(Option.fromNullishOr(match?.groups?.[group.name]));
          },
          catch: (error) => error,
        }),
    });
    yield* context.schema.register({
      id: "UUID",
      name: "UUID",
      description:
        "Generates a cryptographically random UUID v4 on execution using Web Crypto. Requires a secure context in browsers.",
      io: (io) => ({ output: io.data.out("uuid", DataType.String, { name: "UUID" }) }),
      run: ({ io }) =>
        Effect.try({
          try: () => io.output(globalThis.crypto.randomUUID()),
          catch: (error) => error,
        }),
    });
    yield* context.schema.register({
      id: "DateParse",
      name: "Date Parse",
      description:
        "Parses a JavaScript date string to optional epoch milliseconds. Invalid dates return None; use ISO 8601 with an explicit timezone for portable results.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("timeIn", DataType.String, { name: "Time", defaultValue: "" }),
        output: io.data.out("timeOut", DataType.Option(DataType.Int), { name: "Time (ms)" }),
      }),
      run: ({ io }) =>
        Effect.sync(() => {
          const value = Date.parse(io.input);
          io.output(Number.isSafeInteger(value) ? Option.some(value) : Option.none());
        }),
    });
  }),
});

export default StringPlugin;
