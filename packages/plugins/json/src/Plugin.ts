import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect, Option, Schema } from "effect";

const scalar = (name: string): DataType.Scalar => {
  switch (name) {
    case "String":
      return DataType.String;
    case "Int":
      return DataType.Int;
    case "Float":
      return DataType.Float;
    case "Bool":
      return DataType.Bool;
    default:
      // IO generation is synchronous; reject invalid properties in the run Effect.
      return DataType.String;
  }
};
const validateScalar = (name: string) =>
  name === scalar(name)._tag
    ? Effect.succeed(scalar(name))
    : Effect.fail(new TypeError("Type must be String, Int, Float, or Bool"));
const validCount = (count: number) => Number.isSafeInteger(count) && count >= 0 && count <= 1024;
const typed = {
  type: {
    name: "Type",
    description: "String, Int, Float, or Bool.",
    type: DataType.String,
    defaultValue: "String",
  },
};
const conversion = { ...typed, list: { name: "List", type: DataType.Bool, defaultValue: false } };
const conversionType = (type: string, list: boolean) =>
  list ? DataType.List(scalar(type)) : scalar(type);

// JSON numeric overflow must not silently become null when serialized again.
const parse = Effect.fnUntraced(function* (input: string) {
  let nonfinite = false;
  const value: unknown = yield* Effect.try({
    try: () =>
      JSON.parse(input, (_key, value: unknown) => {
        if (typeof value === "number" && !Number.isFinite(value)) nonfinite = true;
        return value;
      }),
    catch: (error) => error,
  });
  if (nonfinite) return yield* Effect.fail(new RangeError("JSON numbers must be finite"));
  return yield* Schema.decodeUnknownEffect(Schema.Json)(value);
});
const object = (value: Schema.Json): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const member = (value: Schema.Json | undefined, key: string): Schema.Json | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value))
    return /^(0|[1-9][0-9]*)$/.test(key) && Object.hasOwn(value, key)
      ? value[Number(key)]
      : undefined;
  return object(value) && Object.hasOwn(value, key) ? value[key] : undefined;
};
const serializedOption = (value: Schema.Json | undefined): Option.Option<string> =>
  value === undefined ? Option.none() : Option.some(JSON.stringify(value));
const extract = (
  value: Schema.Json,
  type: DataType.Scalar,
): Option.Option<DataType.Value<DataType.Scalar>> => {
  switch (type._tag) {
    case "String":
      return typeof value === "string" ? Option.some(value) : Option.none();
    case "Bool":
      return typeof value === "boolean" ? Option.some(value) : Option.none();
    case "Int":
      return typeof value === "number" && Number.isSafeInteger(value)
        ? Option.some(value)
        : Option.none();
    case "Float":
      return typeof value === "number" && Number.isFinite(value)
        ? Option.some(value)
        : Option.none();
  }
};
const extractList = (
  value: Schema.Json,
  type: DataType.Scalar,
): Option.Option<ReadonlyArray<DataType.Value<DataType.Scalar>>> => {
  if (!Array.isArray(value)) return Option.none();
  const output: Array<DataType.Value<DataType.Scalar>> = [];
  for (const item of value) {
    const extracted = extract(item, type);
    if (Option.isNone(extracted)) return Option.none();
    output.push(extracted.value);
  }
  return Option.some(output);
};

const JsonPlugin = Plugin.make({
  id: "json",
  name: "JSON",
  effect: Effect.fnUntraced(function* (context) {
    for (const [id, name, type] of [
      ["ParseJSON", "Parse JSON", "exec"],
      ["StringifyJSON", "Stringify JSON", "pure"],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        type,
        description:
          "Validates JSON text and emits compact JSON text. Invalid JSON and nonfinite numbers fail.",
        io: (io) => ({
          input: io.data.in("in", DataType.String, { name: "JSON", defaultValue: "null" }),
          output: io.data.out("out", DataType.String, { name: "JSON" }),
        }),
        run: ({ io }) =>
          Effect.gen(function* () {
            const value = yield* parse(io.input);
            yield* Effect.try({
              try: () => io.output(JSON.stringify(value)),
              catch: (error) => error,
            });
          }),
      });
    }
    yield* context.schema.register({
      id: "ToJSON",
      name: "To JSON",
      description: "Serializes a configured scalar or scalar list to JSON text.",
      type: "pure",
      properties: conversion,
      io: (io, properties) => ({
        input: io.data.in("in", conversionType(properties.type, properties.list), {
          defaultValue: properties.list
            ? []
            : scalar(properties.type)._tag === "String"
              ? ""
              : properties.type === "Bool"
                ? false
                : 0,
        }),
        output: io.data.out("out", DataType.String, { name: "JSON" }),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          const valid = yield* Effect.try({
            try: () => DataType.isValue(conversionType(properties.type, properties.list), io.input),
            catch: (error) => error,
          });
          if (!valid)
            return yield* Effect.fail(
              new TypeError("Input does not match the configured JSON conversion type"),
            );
          yield* Effect.try({
            try: () => io.output(JSON.stringify(io.input)),
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "FromJSON",
      name: "From JSON",
      description:
        "Extracts an optional configured scalar or scalar list from JSON text. Type mismatches and unsafe Int values return None; malformed JSON fails.",
      type: "pure",
      properties: conversion,
      io: (io, properties) => ({
        input: io.data.in("in", DataType.String, { name: "JSON", defaultValue: "null" }),
        output: io.data.out(
          "out",
          DataType.Option(conversionType(properties.type, properties.list)),
        ),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          const type = yield* validateScalar(properties.type);
          const value = yield* parse(io.input);
          yield* Effect.try({
            try: () => io.output(properties.list ? extractList(value, type) : extract(value, type)),
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "QueryJSON",
      name: "Query JSON",
      description:
        "Queries own object keys and array indices using .dot.paths or RFC 6901 /JSON/pointers. Empty query or '.' selects the root. Missing values return None; JSON null returns Some('null').",
      properties: { query: { name: "Query", type: DataType.String, defaultValue: "" } },
      io: (io) => ({
        input: io.data.in("in", DataType.String, { name: "JSON", defaultValue: "null" }),
        output: io.data.out("out", DataType.Option(DataType.String), { name: "JSON" }),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          const query = properties.query;
          let keys: ReadonlyArray<string>;
          if (query === "" || query === ".") keys = [];
          else if (query.startsWith(".")) keys = query.slice(1).split(".");
          else if (query.startsWith("/")) {
            keys = query.slice(1).split("/");
            if (keys.some((key) => /~(?:[^01]|$)/.test(key)))
              return yield* Effect.fail(new SyntaxError("Invalid JSON pointer escape"));
            keys = keys.map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
          } else
            return yield* Effect.fail(
              new SyntaxError("Query must be empty, a dot path, or a JSON pointer"),
            );
          let value: Schema.Json | undefined = yield* parse(io.input);
          yield* Effect.try({
            try: () => {
              for (const key of keys) value = member(value, key);
              io.output(serializedOption(value));
            },
            catch: (error) => error,
          });
        }),
    });
    for (const [id, name, type] of [
      ["JSONGetString", "JSON Get String", DataType.String],
      ["JSONGetNumber", "JSON Get Number", DataType.Float],
      ["JSONGetInt", "JSON Get Int", DataType.Int],
      ["JSONGetBoolean", "JSON Get Boolean", DataType.Bool],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description:
          "Extracts Some for the matching JSON scalar type, or None for a mismatch or unsafe Int value. Malformed JSON fails.",
        type: "pure",
        io: (io) => ({
          input: io.data.in("in", DataType.String, { name: "JSON", defaultValue: "null" }),
          output: io.data.out("out", DataType.Option(type)),
        }),
        run: ({ io }) =>
          Effect.gen(function* () {
            const value = yield* parse(io.input);
            yield* Effect.try({
              try: () => io.output(extract(value, type)),
              catch: (error) => error,
            });
          }),
      });
    }
    yield* context.schema.register({
      id: "JSONGetList",
      name: "JSON Get List",
      description:
        "Extracts a JSON array as an optional list of JSON texts, preserving nested objects, arrays, and null.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("in", DataType.String, { name: "JSON", defaultValue: "null" }),
        output: io.data.out("out", DataType.Option(DataType.List(DataType.String))),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const value = yield* parse(io.input);
          yield* Effect.try({
            try: () => {
              io.output(
                Array.isArray(value)
                  ? Option.some(value.map((item) => JSON.stringify(item)))
                  : Option.none(),
              );
            },
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "JSONGetScalarList",
      name: "JSON Get Scalar List",
      description:
        "Extracts a homogeneous scalar array. Returns None if any element has the wrong type or is an unsafe Int; empty arrays return Some([]).",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        input: io.data.in("in", DataType.String, { name: "JSON", defaultValue: "null" }),
        output: io.data.out("out", DataType.Option(DataType.List(scalar(properties.type)))),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          const type = yield* validateScalar(properties.type);
          const value = yield* parse(io.input);
          yield* Effect.try({
            try: () => io.output(extractList(value, type)),
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "JSONGetObjectKeys",
      name: "JSON Get Object Keys",
      description:
        "Extracts an object's own keys as an optional string list. No map type is required.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("in", DataType.String, { name: "JSON", defaultValue: "null" }),
        output: io.data.out("out", DataType.Option(DataType.List(DataType.String))),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const value = yield* parse(io.input);
          yield* Effect.try({
            try: () => io.output(object(value) ? Option.some(Object.keys(value)) : Option.none()),
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "JSONGetProperty",
      name: "JSON Get Property",
      description:
        "Gets an own object key or canonical array index as optional JSON text. Missing values return None, distinct from JSON null.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("in", DataType.String, { name: "JSON", defaultValue: "null" }),
        key: io.data.in("key", DataType.String, { defaultValue: "" }),
        output: io.data.out("out", DataType.Option(DataType.String)),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const value = yield* parse(io.input);
          yield* Effect.try({
            try: () => io.output(serializedOption(member(value, io.key))),
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "JSONCreateObject",
      name: "JSON Create Object",
      description:
        "Builds an object from JSON-text entries. Entries must be between 0 and 1024. Duplicate keys use the last value; invalid JSON fails.",
      type: "pure",
      properties: { number: { name: "Entries", type: DataType.Int, defaultValue: 1 } },
      io: (io, properties) => {
        return {
          entries: Array.from(
            { length: validCount(properties.number) ? properties.number : 0 },
            (_, index) => ({
              key: io.data.in(`key-${index}`, DataType.String, { defaultValue: "" }),
              value: io.data.in(`value-${index}`, DataType.String, {
                name: `JSON Value ${index}`,
                defaultValue: "null",
              }),
            }),
          ),
          output: io.data.out("out", DataType.String, { name: "JSON Object" }),
        };
      },
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          if (!validCount(properties.number))
            return yield* Effect.fail(
              new RangeError("Entries must be an integer between 0 and 1024"),
            );
          const entries: Array<readonly [string, Schema.Json]> = [];
          for (const { key, value } of io.entries) entries.push([key, yield* parse(value)]);
          yield* Effect.try({
            try: () => io.output(JSON.stringify(Object.fromEntries(entries))),
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "JSONSetProperty",
      name: "JSON Set Property",
      description:
        "Inserts or replaces an own object key with a JSON-text value. Returns a new object and the previous optional JSON value. Does not modify the source. Non-object inputs fail.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("in", DataType.String, { name: "JSON Object", defaultValue: "{}" }),
        key: io.data.in("key", DataType.String, { defaultValue: "" }),
        value: io.data.in("value", DataType.String, { name: "JSON Value", defaultValue: "null" }),
        output: io.data.out("out", DataType.String, { name: "JSON Object" }),
        previous: io.data.out("previous", DataType.Option(DataType.String)),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* parse(io.input);
          if (!object(input)) return yield* Effect.fail(new TypeError("Expected a JSON object"));
          const value = yield* parse(io.value);
          yield* Effect.try({
            try: () => {
              const previous = serializedOption(member(input, io.key));
              // A computed property defines __proto__ as data rather than invoking its setter.
              io.output(JSON.stringify({ ...input, [io.key]: value }));
              io.previous(previous);
            },
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "JSONRemoveProperty",
      name: "JSON Remove Property",
      description:
        "Removes an own object key from a new JSON object and returns the optional removed JSON value. Missing keys return None; JSON null is Some('null'). Non-object inputs fail.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("in", DataType.String, { name: "JSON Object", defaultValue: "{}" }),
        key: io.data.in("key", DataType.String, { defaultValue: "" }),
        output: io.data.out("out", DataType.String, { name: "JSON Object" }),
        removed: io.data.out("removed", DataType.Option(DataType.String)),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* parse(io.input);
          if (!object(input)) return yield* Effect.fail(new TypeError("Expected a JSON object"));
          yield* Effect.try({
            try: () => {
              io.output(
                JSON.stringify(
                  Object.fromEntries(Object.entries(input).filter(([key]) => key !== io.key)),
                ),
              );
              io.removed(serializedOption(member(input, io.key)));
            },
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "JSONHasProperty",
      name: "JSON Has Property",
      description:
        "Tests whether an object has an own key, including keys whose value is null. Non-object inputs fail.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("in", DataType.String, { name: "JSON Object", defaultValue: "{}" }),
        key: io.data.in("key", DataType.String, { defaultValue: "" }),
        output: io.data.out("out", DataType.Bool),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* parse(io.input);
          if (!object(input)) return yield* Effect.fail(new TypeError("Expected a JSON object"));
          yield* Effect.try({
            try: () => io.output(Object.hasOwn(input, io.key)),
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "JSONGetObjectValues",
      name: "JSON Get Object Values",
      description:
        "Returns an object's own values as a list of JSON texts, in Object.keys order. Non-object inputs fail.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("in", DataType.String, { name: "JSON Object", defaultValue: "{}" }),
        output: io.data.out("out", DataType.List(DataType.String)),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* parse(io.input);
          if (!object(input)) return yield* Effect.fail(new TypeError("Expected a JSON object"));
          yield* Effect.try({
            try: () => io.output(Object.values(input).map((value) => JSON.stringify(value))),
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "JSONGetObjectSize",
      name: "JSON Get Object Size",
      description: "Counts an object's own keys. Non-object inputs fail.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("in", DataType.String, { name: "JSON Object", defaultValue: "{}" }),
        output: io.data.out("out", DataType.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* parse(io.input);
          if (!object(input)) return yield* Effect.fail(new TypeError("Expected a JSON object"));
          yield* Effect.try({
            try: () => io.output(Object.keys(input).length),
            catch: (error) => error,
          });
        }),
    });
  }),
});

export default JsonPlugin;
