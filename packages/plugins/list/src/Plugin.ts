import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect, Option, Random } from "effect";

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
    description: "Element type: String, Int, Float, or Bool.",
    type: DataType.String,
    defaultValue: "String",
  },
};
const scalarDefault = (type: DataType.Scalar): DataType.Value<DataType.Scalar> =>
  type._tag === "String" ? "" : type._tag === "Bool" ? false : 0;
const indexOf = (index: number, length: number) =>
  Number.isSafeInteger(index)
    ? Effect.succeed(index < 0 ? length + index : index)
    : Effect.fail(new RangeError("Index must be a safe integer"));

const ListPlugin = Plugin.make({
  id: "list",
  name: "List",
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "ListCreate",
      name: "List Create",
      description: "Creates a typed scalar list from 0 to 1024 entries.",
      type: "pure",
      properties: { ...typed, number: { name: "Entries", type: DataType.Int, defaultValue: 1 } },
      io: (io, properties) => {
        const type = scalar(properties.type);
        return {
          inputs: Array.from(
            { length: validCount(properties.number) ? properties.number : 0 },
            (_, index) => io.data.in(`value-${index}`, type, { defaultValue: scalarDefault(type) }),
          ),
          output: io.data.out("out", DataType.List(type)),
        };
      },
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          if (!validCount(properties.number))
            return yield* Effect.fail(
              new RangeError("Entries must be an integer between 0 and 1024"),
            );
          io.output([...io.inputs]);
        }),
    });
    yield* context.schema.register({
      id: "PushListValue",
      name: "Push List Value",
      description: "Appends a scalar to a new list without modifying the input.",
      properties: typed,
      io: (io, properties) => {
        const type = scalar(properties.type);
        return {
          list: io.data.in("list", DataType.List(type), { defaultValue: [] }),
          value: io.data.in("value", type, { defaultValue: scalarDefault(type) }),
          output: io.data.out("outList", DataType.List(type)),
        };
      },
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          io.output([...io.list, io.value]);
        }),
    });
    for (const [id, name, insert] of [
      ["InsertListValue", "Insert List Value", true],
      ["SetListValue", "Set List Value", false],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description: `${insert ? "Inserts" : "Replaces"} a scalar in a new list. Negative indices count from the end; out-of-range indices fail.`,
        properties: typed,
        io: (io, properties) => {
          const type = scalar(properties.type);
          return {
            list: io.data.in("list", DataType.List(type), { defaultValue: [] }),
            index: io.data.in("index", DataType.Int, { defaultValue: 0 }),
            value: io.data.in("value", type, { defaultValue: scalarDefault(type) }),
            output: io.data.out("outList", DataType.List(type)),
          };
        },
        run: ({ io, properties }) =>
          Effect.gen(function* () {
            yield* validateScalar(properties.type);
            const index = yield* indexOf(io.index, io.list.length);
            if (index < 0 || index > io.list.length || (!insert && index === io.list.length))
              return yield* Effect.fail(new RangeError("List index out of range"));
            yield* Effect.try({
              try: () => {
                const list = [...io.list];
                list.splice(index, insert ? 0 : 1, io.value);
                io.output(list);
              },
              catch: (error) => error,
            });
          }),
      });
    }
    yield* context.schema.register({
      id: "RemoveListValue",
      name: "Remove List Value",
      description:
        "Removes an element immutably, returning None and an unchanged copy if out of range. Negative indices count from the end.",
      properties: typed,
      io: (io, properties) => {
        const type = scalar(properties.type);
        return {
          list: io.data.in("list", DataType.List(type), { defaultValue: [] }),
          index: io.data.in("index", DataType.Int, { defaultValue: 0 }),
          output: io.data.out("returnList", DataType.List(type)),
          value: io.data.out("returnValue", DataType.Option(type)),
        };
      },
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          const index = yield* indexOf(io.index, io.list.length);
          yield* Effect.try({
            try: () => {
              const list = [...io.list];
              const value =
                index >= 0 && index < list.length
                  ? Option.fromNullishOr(list.splice(index, 1)[0])
                  : Option.none();
              io.output(list);
              io.value(value);
            },
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "GetListValue",
      name: "Get List Value",
      description:
        "Gets an optional element. Negative indices count from the end; out-of-range indices return None.",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        list: io.data.in("list", DataType.List(scalar(properties.type)), { defaultValue: [] }),
        index: io.data.in("index", DataType.Int, { defaultValue: 0 }),
        output: io.data.out("return", DataType.Option(scalar(properties.type))),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          const index = yield* indexOf(io.index, io.list.length);
          yield* Effect.try({
            try: () => io.output(Option.fromNullishOr(io.list[index])),
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "GetRandomListItem",
      name: "Get Random List Item",
      description:
        "Samples an optional element from a typed scalar list on execution using Effect Random. Empty lists return None without sampling.",
      properties: typed,
      io: (io, properties) => ({
        list: io.data.in("list", DataType.List(scalar(properties.type)), { defaultValue: [] }),
        output: io.data.out("return", DataType.Option(scalar(properties.type)), { name: "Value" }),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          if (io.list.length === 0) return io.output(Option.none());
          const value = yield* Random.next;
          io.output(
            Option.fromNullishOr(
              io.list[Math.min(io.list.length - 1, Math.floor(value * io.list.length))],
            ),
          );
        }),
    });
    yield* context.schema.register({
      id: "JoinStringList",
      name: "Join String List",
      description: "Joins strings with the provided separator.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.List(DataType.String), { defaultValue: [] }),
        separator: io.data.in("separator", DataType.String, { defaultValue: "" }),
        output: io.data.out("output", DataType.String),
      }),
      run: ({ io }) => Effect.sync(() => io.output(io.input.join(io.separator))),
    });
    yield* context.schema.register({
      id: "ListIncludes",
      name: "List Includes",
      description: "Checks whether a typed scalar list contains a value.",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        input: io.data.in("input", scalar(properties.type), {
          defaultValue: scalarDefault(scalar(properties.type)),
        }),
        list: io.data.in("list", DataType.List(scalar(properties.type)), { defaultValue: [] }),
        output: io.data.out("output", DataType.Bool),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          io.output(io.list.includes(io.input));
        }),
    });
    yield* context.schema.register({
      id: "ListLength",
      name: "List Length",
      description: "Counts elements in a typed scalar list.",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        list: io.data.in("list", DataType.List(scalar(properties.type)), { defaultValue: [] }),
        output: io.data.out("output", DataType.Int),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          io.output(io.list.length);
        }),
    });
    yield* context.schema.register({
      id: "SliceList",
      name: "Slice List",
      description:
        "Copies a slice using clamped, end-exclusive indices. Negative indices count from the end; end 0 means the list's end.",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        list: io.data.in("list", DataType.List(scalar(properties.type)), { defaultValue: [] }),
        start: io.data.in("start", DataType.Int, { defaultValue: 0 }),
        end: io.data.in("end", DataType.Int, { defaultValue: 0 }),
        output: io.data.out("output", DataType.List(scalar(properties.type))),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          if (!Number.isSafeInteger(io.start) || !Number.isSafeInteger(io.end))
            return yield* Effect.fail(new RangeError("Slice indices must be safe integers"));
          io.output(io.list.slice(io.start, io.end === 0 ? undefined : io.end));
        }),
    });
  }),
});

export default ListPlugin;
