import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Clock, Effect, Random } from "effect";
const checked = Effect.fnUntraced(function* (value: number, type: t.Int | t.Float) {
  if (!Number.isFinite(value) || (type._tag === "Int" && !Number.isSafeInteger(value)))
    return yield* Effect.fail(
      new RangeError(type._tag === "Int" ? "Expected a safe integer" : "Expected a finite number"),
    );
  return value;
});
const MathModule = Module.make({
  id: "math",
  name: "Math",
  description: "Perform arithmetic, comparisons, rounding, and other numeric operations.",
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "AddInts",
      name: "Add Ints",
      description:
        "Add two ints. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Int, { defaultValue: 0 }),
        two: io.data.in("two", t.Int, { defaultValue: 0 }),
        output: io.data.out("output", t.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Int);
          const two = yield* checked(io.two, t.Int);
          const value = yield* checked(one + two, t.Int);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "SubtractInts",
      name: "Subtract Ints",
      description:
        "Subtract two ints. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Int, { defaultValue: 0 }),
        two: io.data.in("two", t.Int, { defaultValue: 0 }),
        output: io.data.out("output", t.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Int);
          const two = yield* checked(io.two, t.Int);
          const value = yield* checked(one - two, t.Int);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "MultiplyInts",
      name: "Multiply Ints",
      description:
        "Multiply two ints. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Int, { defaultValue: 0 }),
        two: io.data.in("two", t.Int, { defaultValue: 0 }),
        output: io.data.out("output", t.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Int);
          const two = yield* checked(io.two, t.Int);
          const value = yield* checked(one * two, t.Int);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "DivideInts",
      name: "Divide Ints",
      description:
        "Divide two ints. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Int, { defaultValue: 0 }),
        two: io.data.in("two", t.Int, { defaultValue: 1 }),
        output: io.data.out("output", t.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Int);
          const two = yield* checked(io.two, t.Int);
          if (two === 0) return yield* Effect.fail(new RangeError("Cannot divide by zero"));
          const value = yield* checked(Math.floor(one / two), t.Int);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "MinInts",
      name: "Min Ints",
      description:
        "Min two ints. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Int, { defaultValue: 0 }),
        two: io.data.in("two", t.Int, { defaultValue: 0 }),
        output: io.data.out("output", t.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Int);
          const two = yield* checked(io.two, t.Int);
          const value = yield* checked(Math.min(one, two), t.Int);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "MaxInts",
      name: "Max Ints",
      description:
        "Max two ints. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Int, { defaultValue: 0 }),
        two: io.data.in("two", t.Int, { defaultValue: 0 }),
        output: io.data.out("output", t.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Int);
          const two = yield* checked(io.two, t.Int);
          const value = yield* checked(Math.max(one, two), t.Int);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "RemainderInt",
      name: "Remainder Int",
      description:
        "Computes the signed remainder. A zero divisor, nonfinite numbers, and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Int, { name: "Number", defaultValue: 0 }),
        divisor: io.data.in("divisor", t.Int, { name: "Divisor", defaultValue: 1 }),
        output: io.data.out("remainder", t.Int, { name: "Remainder" }),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          if (io.divisor === 0) return yield* Effect.fail(new RangeError("Cannot divide by zero"));
          const input = yield* checked(io.input, t.Int);
          const divisor = yield* checked(io.divisor, t.Int);
          const value = yield* checked(input % divisor, t.Int);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "CompareInt",
      name: "Compare Int",
      description: "Reports strict equality, greater-than, and less-than for two valid numbers.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("number", t.Int, { name: "Number", defaultValue: 0 }),
        compare: io.data.in("compare", t.Int, { name: "Compare against", defaultValue: 0 }),
        equal: io.data.out("outputE", t.Bool, { name: "Equal" }),
        greater: io.data.out("outputG", t.Bool, { name: "Greater" }),
        less: io.data.out("outputL", t.Bool, { name: "Less" }),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* checked(io.input, t.Int);
          const compare = yield* checked(io.compare, t.Int);
          yield* Effect.try({
            try: () => {
              io.equal(input === compare);
              io.greater(input > compare);
              io.less(input < compare);
            },
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "AddFloats",
      name: "Add Floats",
      description:
        "Add two floats. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Float, { defaultValue: 0 }),
        two: io.data.in("two", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Float);
          const two = yield* checked(io.two, t.Float);
          const value = yield* checked(one + two, t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "SubtractFloats",
      name: "Subtract Floats",
      description:
        "Subtract two floats. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Float, { defaultValue: 0 }),
        two: io.data.in("two", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Float);
          const two = yield* checked(io.two, t.Float);
          const value = yield* checked(one - two, t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "MultiplyFloats",
      name: "Multiply Floats",
      description:
        "Multiply two floats. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Float, { defaultValue: 0 }),
        two: io.data.in("two", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Float);
          const two = yield* checked(io.two, t.Float);
          const value = yield* checked(one * two, t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "DivideFloats",
      name: "Divide Floats",
      description:
        "Divide two floats. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Float, { defaultValue: 0 }),
        two: io.data.in("two", t.Float, { defaultValue: 1 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Float);
          const two = yield* checked(io.two, t.Float);
          if (two === 0) return yield* Effect.fail(new RangeError("Cannot divide by zero"));
          const value = yield* checked(one / two, t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "MinFloats",
      name: "Min Floats",
      description:
        "Min two floats. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Float, { defaultValue: 0 }),
        two: io.data.in("two", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Float);
          const two = yield* checked(io.two, t.Float);
          const value = yield* checked(Math.min(one, two), t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "MaxFloats",
      name: "Max Floats",
      description:
        "Max two floats. Integer division rounds down. Nonfinite results and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Float, { defaultValue: 0 }),
        two: io.data.in("two", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Float);
          const two = yield* checked(io.two, t.Float);
          const value = yield* checked(Math.max(one, two), t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "RemainderFloat",
      name: "Remainder Float",
      description:
        "Computes the signed remainder. A zero divisor, nonfinite numbers, and unsafe integers fail.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Float, { name: "Number", defaultValue: 0 }),
        divisor: io.data.in("divisor", t.Float, { name: "Divisor", defaultValue: 1 }),
        output: io.data.out("remainder", t.Float, { name: "Remainder" }),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          if (io.divisor === 0) return yield* Effect.fail(new RangeError("Cannot divide by zero"));
          const input = yield* checked(io.input, t.Float);
          const divisor = yield* checked(io.divisor, t.Float);
          const value = yield* checked(input % divisor, t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "CompareFloat",
      name: "Compare Float",
      description: "Reports strict equality, greater-than, and less-than for two valid numbers.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("number", t.Float, { name: "Number", defaultValue: 0 }),
        compare: io.data.in("compare", t.Float, { name: "Compare against", defaultValue: 0 }),
        equal: io.data.out("outputE", t.Bool, { name: "Equal" }),
        greater: io.data.out("outputG", t.Bool, { name: "Greater" }),
        less: io.data.out("outputL", t.Bool, { name: "Less" }),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* checked(io.input, t.Float);
          const compare = yield* checked(io.compare, t.Float);
          yield* Effect.try({
            try: () => {
              io.equal(input === compare);
              io.greater(input > compare);
              io.less(input < compare);
            },
            catch: (error) => error,
          });
        }),
    });
    yield* context.schema.register({
      id: "DivideIntsExact",
      name: "Divide Ints Exact",
      description:
        "Computes a finite floating-point result. Invalid domains, zero division, and overflow fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Int, {
          defaultValue: 0,
        }),
        two: io.data.in("two", t.Int, {
          defaultValue: 1,
        }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Int);
          const two = yield* checked(io.two, t.Int);
          if (two === 0) return yield* Effect.fail(new RangeError("Cannot divide by zero"));
          const value = yield* checked(one / two, t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "ExponentFloats",
      name: "Exponent Floats",
      description:
        "Computes a finite floating-point result. Invalid domains, zero division, and overflow fail.",
      type: "pure",
      io: (io) => ({
        one: io.data.in("one", t.Float, {
          name: "Number",
          defaultValue: 0,
        }),
        two: io.data.in("two", t.Float, {
          name: "Exponent",
          defaultValue: 1,
        }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const one = yield* checked(io.one, t.Float);
          const two = yield* checked(io.two, t.Float);
          const value = yield* checked(one ** two, t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "Sin",
      name: "Sin",
      description:
        "Sin of a valid number. Trigonometric inputs are radians; Float To Int rounds to nearest with ties toward positive infinity.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* checked(io.input, t.Float);
          const value = yield* checked(Math.sin(input), t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "Cos",
      name: "Cos",
      description:
        "Cos of a valid number. Trigonometric inputs are radians; Float To Int rounds to nearest with ties toward positive infinity.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* checked(io.input, t.Float);
          const value = yield* checked(Math.cos(input), t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "Tan",
      name: "Tan",
      description:
        "Tan of a valid number. Trigonometric inputs are radians; Float To Int rounds to nearest with ties toward positive infinity.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* checked(io.input, t.Float);
          const value = yield* checked(Math.tan(input), t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "FloatToInt",
      name: "Float To Int",
      description:
        "Float To Int of a valid number. Trigonometric inputs are radians; Float To Int rounds to nearest with ties toward positive infinity.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* checked(io.input, t.Float);
          const value = yield* checked(Math.round(input), t.Int);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "IntToFloat",
      name: "Int To Float",
      description:
        "Int To Float of a valid number. Trigonometric inputs are radians; Float To Int rounds to nearest with ties toward positive infinity.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Int, { defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* checked(io.input, t.Int);
          const value = yield* checked(input, t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "FloorFloat",
      name: "Floor Float",
      description:
        "Floor Float of a valid number. Trigonometric inputs are radians; Float To Int rounds to nearest with ties toward positive infinity.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* checked(io.input, t.Float);
          const value = yield* checked(Math.floor(input), t.Int);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "MakeInt",
      name: "Make Int",
      description:
        "Make Int of a valid number. Trigonometric inputs are radians; Float To Int rounds to nearest with ties toward positive infinity.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Int, { defaultValue: 0 }),
        output: io.data.out("output", t.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* checked(io.input, t.Int);
          const value = yield* checked(input, t.Int);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "MakeFloat",
      name: "Make Float",
      description:
        "Make Float of a valid number. Trigonometric inputs are radians; Float To Int rounds to nearest with ties toward positive infinity.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Float, { defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const input = yield* checked(io.input, t.Float);
          const value = yield* checked(input, t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "RoundFloat",
      name: "Round Float",
      description: "Rounds a finite float to -308 through 308 decimal places. Overflow fails.",
      type: "pure",
      io: (io) => ({
        input: io.data.in("input", t.Float, { defaultValue: 0 }),
        decimal: io.data.in("decimal", t.Int, { name: "Decimal Places", defaultValue: 0 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          yield* checked(io.input, t.Float);
          if (!Number.isSafeInteger(io.decimal) || Math.abs(io.decimal) > 308)
            return yield* Effect.fail(
              new RangeError("Decimal places must be an integer between -308 and 308"),
            );
          const scale = 10 ** io.decimal;
          const value = yield* checked(Math.round(io.input * scale) / scale, t.Float);
          yield* Effect.try({ try: () => io.output(value), catch: (error) => error });
        }),
    });
    yield* context.schema.register({
      id: "RandomFloat",
      name: "Random Float",
      description: "Samples a float in [0, 1) using Effect Random.",
      io: (io) => ({ output: io.data.out("output", t.Float) }),
      run: ({ io }) => Random.next.pipe(Effect.map((value) => io.output(value))),
    });
    yield* context.schema.register({
      id: "RandomFloatInRange",
      name: "Random Float In Range",
      description:
        "Samples a float in [min, max), or min when equal. Bounds and range width must be finite.",
      io: (io) => ({
        min: io.data.in("min", t.Float, { name: "Min", defaultValue: 0 }),
        max: io.data.in("max", t.Float, { name: "Max", defaultValue: 1 }),
        output: io.data.out("output", t.Float),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const min = yield* checked(io.min, t.Float);
          const max = yield* checked(io.max, t.Float);
          if (min > max)
            return yield* Effect.fail(new RangeError("Minimum must not exceed maximum"));
          const width = yield* checked(max - min + 0, t.Float);
          const random = yield* Random.next;
          const value = io.min + random * width;
          // Adjacent floating-point bounds can round a sample up to the excluded maximum.
          io.output(io.min < io.max && value >= io.max ? io.min : Math.min(io.max, value));
        }),
    });
    yield* context.schema.register({
      id: "RandomInteger",
      name: "Random Integer",
      description: "Samples 0 or 1 with equal probability using Effect Random.",
      io: (io) => ({ output: io.data.out("output", t.Int) }),
      run: ({ io }) => Random.next.pipe(Effect.map((value) => io.output(Math.floor(value * 2)))),
    });
    yield* context.schema.register({
      id: "RandomIntegerInRange",
      name: "Random Integer In Range",
      description:
        "Samples an integer from the inclusive range [min, max]. Bounds and range width must be safe integers.",
      io: (io) => ({
        min: io.data.in("min", t.Int, { name: "Min", defaultValue: 0 }),
        max: io.data.in("max", t.Int, { name: "Max", defaultValue: 1 }),
        output: io.data.out("output", t.Int),
      }),
      run: ({ io }) =>
        Effect.gen(function* () {
          const min = yield* checked(io.min, t.Int);
          const max = yield* checked(io.max, t.Int);
          if (min > max)
            return yield* Effect.fail(new RangeError("Minimum must not exceed maximum"));
          const width = yield* checked(max - min + 1, t.Int);
          const random = yield* Random.next;
          const value = io.min + Math.floor(random * width);
          // Adjacent floating-point bounds can round a sample up to the excluded maximum.
          io.output(Math.min(io.max, value));
        }),
    });
    yield* context.schema.register({
      id: "DateNow",
      name: "Date Now (ms)",
      description:
        "Samples epoch milliseconds from the Effect clock on execution, rather than as a pure value.",
      io: (io) => ({
        output: io.data.out("out", t.Int, {
          name: "Time (ms)",
        }),
      }),
      run: ({ io }) => Clock.currentTimeMillis.pipe(Effect.map((value) => io.output(value))),
    });
    yield* context.schema.register({
      id: "CurrentTimestamp",
      name: "Current Timestamp (ms)",
      description:
        "Samples epoch milliseconds from the Effect clock on execution, rather than as a pure value.",
      io: (io) => ({
        output: io.data.out("out", t.Int, {
          name: "Timestamp",
        }),
      }),
      run: ({ io }) => Clock.currentTimeMillis.pipe(Effect.map((value) => io.output(value))),
    });
  }),
});
export default MathModule;
