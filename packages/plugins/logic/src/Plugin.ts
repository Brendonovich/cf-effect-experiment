import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect, Option } from "effect";

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
const scalarDefault = (type: DataType.Scalar): DataType.Value<DataType.Scalar> =>
  type._tag === "String" ? "" : type._tag === "Bool" ? false : 0;

const LogicPlugin = Plugin.make({
  id: "logic",
  name: "Logic",
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "Branch",
      name: "Branch",
      description: "Routes execution to exactly one boolean branch.",
      io: (io) => ({
        condition: io.data.in("condition", DataType.Bool, { defaultValue: false }),
        whenTrue: io.exec.out("true", { name: "True" }),
        whenFalse: io.exec.out("false", { name: "False" }),
      }),
      run: ({ io }) => Effect.succeed(io.condition ? io.whenTrue : io.whenFalse),
    });
    yield* context.schema.register({
      id: "Wait",
      name: "Wait",
      description:
        "Waits an interruptible, nonnegative whole number of milliseconds (at most 2147483647).",
      io: (io) => ({
        delay: io.data.in("delay", DataType.Int, { name: "Wait in ms", defaultValue: 0 }),
      }),
      run: ({ io }) =>
        Number.isSafeInteger(io.delay) && io.delay >= 0 && io.delay <= 2147483647
          ? Effect.sleep(io.delay)
          : Effect.fail(new RangeError("Delay must be an integer between 0 and 2147483647 ms")),
    });
    for (const [id, operation] of [
      ["AND", (a: boolean, b: boolean) => a && b],
      ["NAND", (a: boolean, b: boolean) => !(a && b)],
      ["OR", (a: boolean, b: boolean) => a || b],
      ["NOR", (a: boolean, b: boolean) => !(a || b)],
      ["XOR", (a: boolean, b: boolean) => a !== b],
    ] as const) {
      yield* context.schema.register({
        id,
        name: id,
        description: `Boolean ${id} of two inputs.`,
        type: "pure",
        io: (io) => ({
          one: io.data.in("one", DataType.Bool, { defaultValue: false }),
          two: io.data.in("two", DataType.Bool, { defaultValue: false }),
          value: io.data.out("value", DataType.Bool),
        }),
        run: ({ io }) => Effect.sync(() => io.value(operation(io.one, io.two))),
      });
    }
    yield* context.schema.register({
      id: "NOT",
      name: "NOT",
      description: "Inverts a boolean input.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", DataType.Bool, { defaultValue: false }),
        output: io.data.out("output", DataType.Bool),
      }),
      run: ({ io }) => Effect.sync(() => io.output(!io.input)),
    });
    yield* context.schema.register({
      id: "Conditional",
      name: "Conditional",
      description: "Selects one of two values of the explicitly configured scalar type.",
      type: "pure",
      properties: typed,
      io: (io, properties) => {
        const type = scalar(properties.type);
        return {
          condition: io.data.in("condition", DataType.Bool, { defaultValue: false }),
          whenTrue: io.data.in("trueValue", type, { defaultValue: scalarDefault(type) }),
          whenFalse: io.data.in("falseValue", type, { defaultValue: scalarDefault(type) }),
          output: io.data.out("output", type),
        };
      },
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          io.output(io.condition ? io.whenTrue : io.whenFalse);
        }),
    });
    yield* context.schema.register({
      id: "Switch",
      name: "Switch",
      description:
        "Selects the first matching scalar case or Default. Keys must be between 0 and 1024. The comparison value and every case key intentionally require an input or explicit default to avoid accidental empty-value matches.",
      properties: { ...typed, number: { name: "Keys", type: DataType.Int, defaultValue: 1 } },
      io: (io, properties) => {
        const type = scalar(properties.type);
        return {
          input: io.data.in("switchOn", type),
          output: io.data.out("switchOut", type),
          fallback: io.exec.out("exec", { name: "Default" }),
          cases: Array.from(
            { length: validCount(properties.number) ? properties.number : 0 },
            (_, index) => ({
              value: io.data.in(`key-${index}`, type),
              exec: io.exec.out(`key-${index}`, { name: `Case ${index}` }),
            }),
          ),
        };
      },
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          if (!validCount(properties.number))
            return yield* Effect.fail(new RangeError("Keys must be an integer between 0 and 1024"));
          io.output(io.input);
          return io.cases.find((item) => item.value === io.input)?.exec ?? io.fallback;
        }),
    });
    yield* context.schema.register({
      id: "Equal",
      name: "Equal",
      description: "Compares two values of the configured scalar type using strict equality.",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        one: io.data.in("one", scalar(properties.type), {
          defaultValue: scalarDefault(scalar(properties.type)),
        }),
        two: io.data.in("two", scalar(properties.type), {
          defaultValue: scalarDefault(scalar(properties.type)),
        }),
        equal: io.data.out("equal", DataType.Bool),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          io.equal(io.one === io.two);
        }),
    });
    yield* context.schema.register({
      id: "MakeSome",
      name: "Make Some",
      description: "Wraps a scalar value in Some.",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        input: io.data.in("in", scalar(properties.type), {
          defaultValue: scalarDefault(scalar(properties.type)),
        }),
        output: io.data.out("out", DataType.Option(scalar(properties.type))),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          io.output(Option.some(io.input));
        }),
    });
    yield* context.schema.register({
      id: "UnwrapOption",
      name: "Unwrap Option",
      description: "Extracts a scalar Some value; fails for None.",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        input: io.data.in("input", DataType.Option(scalar(properties.type)), {
          defaultValue: Option.none(),
        }),
        output: io.data.out("output", scalar(properties.type)),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          if (Option.isNone(io.input)) return yield* Effect.fail(new Error("Cannot unwrap None"));
          io.output(io.input.value);
        }),
    });
    yield* context.schema.register({
      id: "UnwrapOptionOr",
      name: "Unwrap Option Or",
      description: "Extracts a scalar Some value or returns the fallback for None.",
      type: "pure",
      properties: typed,
      io: (io, properties) => ({
        input: io.data.in("input", DataType.Option(scalar(properties.type)), {
          defaultValue: Option.none(),
        }),
        fallback: io.data.in("or", scalar(properties.type), {
          defaultValue: scalarDefault(scalar(properties.type)),
        }),
        output: io.data.out("output", scalar(properties.type)),
      }),
      run: ({ io, properties }) =>
        Effect.gen(function* () {
          yield* validateScalar(properties.type);
          io.output(Option.getOrElse(io.input, () => io.fallback));
        }),
    });
    for (const [id, name, predicate] of [
      ["IsOptionSome", "Is Option Some", Option.isSome],
      ["IsOptionNone", "Is Option None", Option.isNone],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        description: `${name} for an option of the configured scalar type.`,
        type: "pure",
        properties: typed,
        io: (io, properties) => ({
          input: io.data.in("input", DataType.Option(scalar(properties.type)), {
            defaultValue: Option.none(),
          }),
          output: io.data.out("output", DataType.Bool),
        }),
        run: ({ io, properties }) =>
          Effect.gen(function* () {
            yield* validateScalar(properties.type);
            io.output(predicate(io.input));
          }),
      });
    }
    for (const id of ["Cache", "Copy"] as const) {
      yield* context.schema.register({
        id,
        name: id,
        description:
          id === "Copy"
            ? "Captures a scalar or shallow-copies a typed scalar list on execution. Enable List to copy a list without modifying the input."
            : "Captures a scalar or typed scalar list on execution for downstream reuse. Enable List for list pins; the captured value is not cloned.",
        properties: {
          ...typed,
          list: { name: "List", type: DataType.Bool, defaultValue: false },
        },
        io: (io, properties) => {
          const element = scalar(properties.type);
          const type = properties.list ? DataType.List(element) : element;
          return {
            input: io.data.in("in", type, {
              defaultValue: properties.list ? [] : scalarDefault(element),
            }),
            output: io.data.out("out", type),
          };
        },
        run: ({ io, properties }) =>
          Effect.gen(function* () {
            yield* validateScalar(properties.type);
            io.output(id === "Copy" && Array.isArray(io.input) ? [...io.input] : io.input);
          }),
      });
    }
  }),
});

export default LogicPlugin;
