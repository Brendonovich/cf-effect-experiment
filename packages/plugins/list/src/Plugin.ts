import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect, Equal, Option, Random } from "effect";

// Persisted primitive selectors remain valid; nested/custom selectors use JSON descriptors.
const elementType = (name: string): DataType.Any => DataType.parseSelector(name) ?? DataType.String;
const validateType = (name: string) => {
  const type = DataType.parseSelector(name);
  return type === undefined
    ? Effect.fail(new TypeError("Type must be a primitive name or a JSON data type descriptor"))
    : Effect.succeed(type);
};
const validCount = (count: number) => Number.isSafeInteger(count) && count >= 0 && count <= 1024;
const typed = {
  type: {
    name: "Type",
    description: "Element type: a primitive name or JSON descriptor for nested and custom types.",
    type: DataType.String,
    defaultValue: "String",
  },
};
const inputOptions = (
  type: DataType.Any,
): { readonly defaultValue?: DataType.Value<DataType.Any> } => {
  switch (type._tag) {
    case "String":
      return { defaultValue: "" };
    case "Bool":
      return { defaultValue: false };
    case "Int":
    case "Float":
      return { defaultValue: 0 };
    case "List":
      return { defaultValue: [] };
    case "Option":
      return { defaultValue: Option.none() };
    case "Custom":
    case "DateTime":
      return {};
  }
};
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
      description:
        "Creates a typed list from 0 to 1024 entries, including nested and custom values.",
      type: "pure",
      properties: { ...typed, number: { name: "Entries", type: DataType.Int, defaultValue: 1 } },
      io: (io, properties) => {
        const type = elementType(properties.type);
        return {
          inputs: Array.from(
            { length: validCount(properties.number) ? properties.number : 0 },
            (_, index) => io.data.in(`value-${index}`, type, inputOptions(type)),
          ),
          output: io.data.out("out", DataType.List(type)),
        };
      },
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateType(properties.type);
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
      description: "Appends a typed value to a new list without modifying the input.",
      properties: typed,
      io: (io, properties) => {
        const type = elementType(properties.type);
        return {
          list: io.data.in("list", DataType.List(type), { defaultValue: [] }),
          value: io.data.in("value", type, inputOptions(type)),
          output: io.data.out("outList", DataType.List(type)),
        };
      },
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateType(properties.type);
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
        description: `${insert ? "Inserts" : "Replaces"} a typed value in a new list. Negative indices count from the end; out-of-range indices fail.`,
        properties: typed,
        io: (io, properties) => {
          const type = elementType(properties.type);
          return {
            list: io.data.in("list", DataType.List(type), { defaultValue: [] }),
            index: io.data.in("index", DataType.Int, { defaultValue: 0 }),
            value: io.data.in("value", type, inputOptions(type)),
            output: io.data.out("outList", DataType.List(type)),
          };
        },
        run: ({ io, properties }) =>
          Effect.gen(function* () {
            yield* validateType(properties.type);
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
        const type = elementType(properties.type);
        return {
          list: io.data.in("list", DataType.List(type), { defaultValue: [] }),
          index: io.data.in("index", DataType.Int, { defaultValue: 0 }),
          output: io.data.out("returnList", DataType.List(type)),
          value: io.data.out("returnValue", DataType.Option(type)),
        };
      },
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateType(properties.type);
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
        list: io.data.in("list", DataType.List(elementType(properties.type)), { defaultValue: [] }),
        index: io.data.in("index", DataType.Int, { defaultValue: 0 }),
        output: io.data.out("return", DataType.Option(elementType(properties.type))),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateType(properties.type);
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
        "Samples an optional element from a typed list on execution using Effect Random. Empty lists return None without sampling.",
      properties: typed,
      io: (io, properties) => ({
        list: io.data.in("list", DataType.List(elementType(properties.type)), { defaultValue: [] }),
        output: io.data.out("return", DataType.Option(elementType(properties.type)), {
          name: "Value",
        }),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateType(properties.type);
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
      description:
        "Checks whether a typed list contains a structurally equal value, including nominal custom identity.",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        input: io.data.in(
          "input",
          elementType(properties.type),
          inputOptions(elementType(properties.type)),
        ),
        list: io.data.in("list", DataType.List(elementType(properties.type)), { defaultValue: [] }),
        output: io.data.out("output", DataType.Bool),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateType(properties.type);
          io.output(io.list.some((value) => Equal.equals(value, io.input)));
        }),
    });
    yield* context.schema.register({
      id: "ListLength",
      name: "List Length",
      description: "Counts elements in a typed list.",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        list: io.data.in("list", DataType.List(elementType(properties.type)), { defaultValue: [] }),
        output: io.data.out("output", DataType.Int),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateType(properties.type);
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
        list: io.data.in("list", DataType.List(elementType(properties.type)), { defaultValue: [] }),
        start: io.data.in("start", DataType.Int, { defaultValue: 0 }),
        end: io.data.in("end", DataType.Int, { defaultValue: 0 }),
        output: io.data.out("output", DataType.List(elementType(properties.type))),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateType(properties.type);
          if (!Number.isSafeInteger(io.start) || !Number.isSafeInteger(io.end))
            return yield* Effect.fail(new RangeError("Slice indices must be safe integers"));
          io.output(io.list.slice(io.start, io.end === 0 ? undefined : io.end));
        }),
    });
  }),
});

export default ListPlugin;
