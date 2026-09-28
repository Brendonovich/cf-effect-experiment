import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Effect, Option } from "effect";
const radix = Effect.fnUntraced(function* (base: number) {
  if (!Number.isInteger(base) || base < 2 || base > 36)
    return yield* Effect.fail(new RangeError("Base must be an integer between 2 and 36"));
  return base;
});
const validEntries = (number: number) =>
  Number.isSafeInteger(number) && number >= 0 && number <= 1024;
const decimal = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
const StringModule = Module.make({
  id: "string",
  name: "String",
  description: "Create, compare, format, and transform text.",
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "StringIncludes",
      name: "String Includes",
      description: "Performs a case-sensitive literal string comparison.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { name: "String", defaultValue: "" }),
        second: io.data.in("needle", t.String, {
          name: "Includes",
          defaultValue: "",
        }),
        output: io.data.out("bool", t.Bool),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.includes(io.second))),
    });
    yield* context.schema.register({
      id: "StringStartsWith",
      name: "String Starts With",
      description: "Performs a case-sensitive literal string comparison.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { name: "String", defaultValue: "" }),
        second: io.data.in("prefix", t.String, {
          name: "Starts With",
          defaultValue: "",
        }),
        output: io.data.out("bool", t.Bool),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.startsWith(io.second))),
    });
    yield* context.schema.register({
      id: "StringReplaceAll",
      name: "String Replace All",
      description:
        "Replaces literal text. Replacement text is literal, including dollar signs; the search is not a regex.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { name: "String", defaultValue: "" }),
        find: io.data.in("find", t.String, { name: "Find", defaultValue: "" }),
        replace: io.data.in("replace", t.String, { name: "Replace", defaultValue: "" }),
        output: io.data.out("out", t.String),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.replaceAll(io.find, () => io.replace))),
    });
    yield* context.schema.register({
      id: "StringReplaceFirst",
      name: "String Replace First",
      description:
        "Replaces literal text. Replacement text is literal, including dollar signs; the search is not a regex.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { name: "String", defaultValue: "" }),
        find: io.data.in("find", t.String, { name: "Find", defaultValue: "" }),
        replace: io.data.in("replace", t.String, { name: "Replace", defaultValue: "" }),
        output: io.data.out("out", t.String),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.replace(io.find, () => io.replace))),
    });
    yield* context.schema.register({
      id: "StringLength",
      name: "String Length",
      description: "Counts UTF-16 code units, matching JavaScript string length.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { name: "String", defaultValue: "" }),
        output: io.data.out("int", t.Int),
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
        input: io.data.in("input", t.String, { defaultValue: "" }),
        start: io.data.in("start", t.Int, { name: "Start", defaultValue: 0 }),
        end: io.data.in("end", t.Int, { name: "End", defaultValue: 0 }),
        output: io.data.out("output", t.String),
      }),
      run: ({ io }) =>
        Number.isSafeInteger(io.start) && Number.isSafeInteger(io.end)
          ? Effect.sync(() =>
              io.output(io.input.substring(io.start, io.end === 0 ? undefined : io.end)),
            )
          : Effect.fail(new RangeError("Substring indices must be safe integers")),
    });
    yield* context.schema.register({
      id: "StringToUppercase",
      name: "String To Uppercase",
      description:
        "String To Uppercase. Reverse String reverses Unicode code points, not grapheme clusters.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { defaultValue: "" }),
        output: io.data.out("output", t.String),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.toUpperCase())),
    });
    yield* context.schema.register({
      id: "StringToLowercase",
      name: "String To Lowercase",
      description:
        "String To Lowercase. Reverse String reverses Unicode code points, not grapheme clusters.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { defaultValue: "" }),
        output: io.data.out("output", t.String),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.toLowerCase())),
    });
    yield* context.schema.register({
      id: "ReverseString",
      name: "Reverse String",
      description:
        "Reverse String. Reverse String reverses Unicode code points, not grapheme clusters.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { defaultValue: "" }),
        output: io.data.out("output", t.String),
      }),
      run: ({ io }) => Effect.sync(() => io.output([...io.input].reverse().join(""))),
    });
    yield* context.schema.register({
      id: "MakeString",
      name: "Make String",
      description:
        "Make String. Reverse String reverses Unicode code points, not grapheme clusters.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.String, { defaultValue: "" }),
        output: io.data.out("output", t.String),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input)),
    });
    yield* context.schema.register({
      id: "AppendString",
      name: "Append String",
      description: "Concatenates five strings without a separator.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.String, { defaultValue: "" }),
        two: io.data.in("two", t.String, { defaultValue: "" }),
        three: io.data.in("three", t.String, { defaultValue: "" }),
        four: io.data.in("four", t.String, { defaultValue: "" }),
        five: io.data.in("five", t.String, { defaultValue: "" }),
        output: io.data.out("output", t.String),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.one + io.two + io.three + io.four + io.five)),
    });
    yield* context.schema.register({
      id: "CreateString",
      name: "Create String",
      description:
        "Concatenates 0 to 1024 strings. Entries explicitly controls the pin count instead of legacy connection-driven pins.",
      type: "pure",
      properties: { number: { name: "Entries", type: t.Int, defaultValue: 1 } },
      io: (io, properties) => ({
        inputs: Array.from(
          { length: validEntries(properties.number) ? properties.number : 0 },
          (_, index) => io.data.in(`value-${index}`, t.String, { defaultValue: "" }),
        ),
        output: io.data.out("output", t.String),
      }),
      run: ({ io, properties }) =>
        validEntries(properties.number)
          ? Effect.sync(() => io.output(io.inputs.join("")))
          : Effect.fail(new RangeError("Entries must be an integer between 0 and 1024")),
    });
    yield* context.schema.register({
      id: "IntToString",
      name: "Int To String",
      description: "Converts a scalar value to its string representation.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Int, { defaultValue: 0 }),
        output: io.data.out("string", t.String),
      }),
      run: ({ io }) =>
        t.isValue(t.Int, io.input)
          ? Effect.sync(() => io.output(String(io.input)))
          : Effect.fail(new TypeError("Input does not match the scalar conversion type")),
    });
    yield* context.schema.register({
      id: "FloatToString",
      name: "Float To String",
      description: "Converts a scalar value to its string representation.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Float, { defaultValue: 0 }),
        output: io.data.out("string", t.String),
      }),
      run: ({ io }) =>
        t.isValue(t.Float, io.input)
          ? Effect.sync(() => io.output(String(io.input)))
          : Effect.fail(new TypeError("Input does not match the scalar conversion type")),
    });
    yield* context.schema.register({
      id: "BoolToString",
      name: "Bool To String",
      description: "Converts a scalar value to its string representation.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Bool, { defaultValue: false }),
        output: io.data.out("string", t.String),
      }),
      run: ({ io }) =>
        t.isValue(t.Bool, io.input)
          ? Effect.sync(() => io.output(String(io.input)))
          : Effect.fail(new TypeError("Input does not match the scalar conversion type")),
    });
    yield* context.schema.register({
      id: "IntToStringBase",
      name: "Int To String (Specify Base)",
      description: "Formats a safe integer using base 2 through 36.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("int", t.Int, { defaultValue: 0 }),
        base: io.data.in("base", t.Int, { name: "Base", defaultValue: 10 }),
        output: io.data.out("string", t.String),
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
    yield* context.schema.register({
      id: "StringToInt",
      name: "String To Int",
      description:
        "Parses a complete decimal numeric literal (surrounding whitespace allowed). Empty, partial, nonfinite, or unsafe integer results return None. String To Int rounds down.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("string", t.String, { defaultValue: "" }),
        output: io.data.out("int", t.Option(t.Int)),
      }),
      run: ({ io }) =>
        Effect.sync(() => {
          const text = io.input.trim();
          const parsed = Number(text);
          const value = Math.floor(parsed);
          io.output(
            decimal.test(text) && Number.isFinite(value) && Number.isSafeInteger(value)
              ? Option.some(value)
              : Option.none(),
          );
        }),
    });
    yield* context.schema.register({
      id: "StringToFloat",
      name: "String To Float",
      description:
        "Parses a complete decimal numeric literal (surrounding whitespace allowed). Empty, partial, nonfinite, or unsafe integer results return None. String To Int rounds down.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("string", t.String, { defaultValue: "" }),
        output: io.data.out("float", t.Option(t.Float)),
      }),
      run: ({ io }) =>
        Effect.sync(() => {
          const text = io.input.trim();
          const parsed = Number(text);
          const value = parsed;
          io.output(
            decimal.test(text) && Number.isFinite(value) && true
              ? Option.some(value)
              : Option.none(),
          );
        }),
    });
    yield* context.schema.register({
      id: "StringToIntBase",
      name: "String To Int (Specify Base)",
      description:
        "Parses a complete signed integer in base 2 through 36, without radix prefixes. Invalid digits or unsafe results return None; invalid bases fail.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("string", t.String, { defaultValue: "" }),
        base: io.data.in("base", t.Int, { name: "Base", defaultValue: 10 }),
        output: io.data.out("int", t.Option(t.Int)),
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
        input: io.data.in("input", t.String, { name: "String", defaultValue: "" }),
        separator: io.data.in("separator", t.String, {
          name: "Separator",
          defaultValue: "",
        }),
        output: io.data.out("output", t.List(t.String)),
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
        input: io.data.in("input", t.String, { name: "String", defaultValue: "" }),
        output: io.data.out("output", t.List(t.String)),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.split(/[\r\n]+/))),
    });
    yield* context.schema.register({
      id: "JoinLines",
      name: "Join Lines",
      description: "Joins a list of strings with LF line breaks.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.List(t.String), {
          name: "Lines",
          defaultValue: [],
        }),
        output: io.data.out("output", t.String),
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
        input: io.data.in("input", t.String, { defaultValue: "" }),
        index: io.data.in("index", t.Int, { name: "N", defaultValue: 0 }),
        output: io.data.out("output", t.Option(t.String)),
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
        regex: { name: "Regex", type: t.String, defaultValue: "" },
        flags: { name: "Flags", type: t.String, defaultValue: "" },
      },
      io: (io, properties) => {
        const regex = new RegExp(`(?:${properties.regex})|`, properties.flags);
        const names = Object.keys(regex.exec("")?.groups ?? {});
        return {
          input: io.data.in("input", t.String, { defaultValue: "" }),
          output: io.data.out("match", t.Option(t.String)),
          groups: names.map((name) => ({
            name,
            output: io.data.out(`group-${name}`, t.Option(t.String), { name }),
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
      io: (io) => ({ output: io.data.out("uuid", t.String, { name: "UUID" }) }),
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
        input: io.data.in("timeIn", t.String, { name: "Time", defaultValue: "" }),
        output: io.data.out("timeOut", t.Option(t.Int), { name: "Time (ms)" }),
      }),
      run: ({ io }) =>
        Effect.sync(() => {
          const value = Date.parse(io.input);
          io.output(Number.isSafeInteger(value) ? Option.some(value) : Option.none());
        }),
    });
  }),
});
export default StringModule;
