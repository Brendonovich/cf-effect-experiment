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
      throw new TypeError("Type must be String, Int, Float, or Bool");
  }
};
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
const parse = (input: string): Schema.Json =>
  Schema.decodeUnknownSync(Schema.Json)(
    JSON.parse(input, (_key, value: unknown) => {
      if (typeof value === "number" && !Number.isFinite(value))
        throw new RangeError("JSON numbers must be finite");
      return value;
    }),
  );
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
          Effect.try({
            try: () => io.output(JSON.stringify(parse(io.input))),
            catch: (error) => error,
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
            : properties.type === "String"
              ? ""
              : properties.type === "Bool"
                ? false
                : 0,
        }),
        output: io.data.out("out", DataType.String, { name: "JSON" }),
      }),
      run: ({ io, properties }) =>
        Effect.try({
          try: () => {
            if (!DataType.isValue(conversionType(properties.type, properties.list), io.input))
              throw new TypeError("Input does not match the configured JSON conversion type");
            io.output(JSON.stringify(io.input));
          },
          catch: (error) => error,
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
        Effect.try({
          try: () => {
            const value = parse(io.input);
            const type = scalar(properties.type);
            io.output(properties.list ? extractList(value, type) : extract(value, type));
          },
          catch: (error) => error,
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
        Effect.try({
          try: () => {
            const query = properties.query;
            let keys: ReadonlyArray<string>;
            if (query === "" || query === ".") keys = [];
            else if (query.startsWith(".")) keys = query.slice(1).split(".");
            else if (query.startsWith("/"))
              keys = query
                .slice(1)
                .split("/")
                .map((key) => {
                  if (/~(?:[^01]|$)/.test(key))
                    throw new SyntaxError("Invalid JSON pointer escape");
                  return key.replaceAll("~1", "/").replaceAll("~0", "~");
                });
            else throw new SyntaxError("Query must be empty, a dot path, or a JSON pointer");
            let value: Schema.Json | undefined = parse(io.input);
            for (const key of keys) value = member(value, key);
            io.output(serializedOption(value));
          },
          catch: (error) => error,
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
          Effect.try({
            try: () => io.output(extract(parse(io.input), type)),
            catch: (error) => error,
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
        Effect.try({
          try: () => {
            const value = parse(io.input);
            io.output(
              Array.isArray(value)
                ? Option.some(value.map((item) => JSON.stringify(item)))
                : Option.none(),
            );
          },
          catch: (error) => error,
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
        Effect.try({
          try: () => io.output(extractList(parse(io.input), scalar(properties.type))),
          catch: (error) => error,
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
        Effect.try({
          try: () => {
            const value = parse(io.input);
            io.output(object(value) ? Option.some(Object.keys(value)) : Option.none());
          },
          catch: (error) => error,
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
        Effect.try({
          try: () => io.output(serializedOption(member(parse(io.input), io.key))),
          catch: (error) => error,
        }),
    });
  }),
});

export default JsonPlugin;
