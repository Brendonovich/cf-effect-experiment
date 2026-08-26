import type { Registration } from "@macrograph/plugin";

import { assert, describe, it } from "@effect/vitest";
import { Registration as PluginRegistration } from "@macrograph/plugin";
import { Effect, Logger, Redacted, Result } from "effect";

import { TickEvent } from "../src/Definition.ts";
import UtilitiesPlugin, { formatValue, parseFormatString } from "../src/Plugin.ts";

const schemas = PluginRegistration.collect(UtilitiesPlugin.effect);

const schema = (registered: ReadonlyArray<Registration.RegisteredSchema>, id: string) => {
  const value = registered.find((candidate) => candidate.id === id);
  assert.isDefined(value);
  return value;
};

const run = (
  registered: Registration.RegisteredSchema,
  inputs: Readonly<Record<string, unknown>> = {},
  properties: Readonly<Record<string, unknown>> = {},
  event?: TickEvent,
) => {
  const outputs = new Map<string, unknown>();
  return registered
    .run({
      input: (ref) => inputs[ref.id] ?? ref.defaultValue,
      output: (ref, value) => outputs.set(ref.id, value),
      properties,
      event,
      engine: undefined,
      execution: {
        projectId: "project",
        graphId: "graph",
        eventNodeId: "event",
        traceId: "execution-trace",
      },
      node: {
        nodeId: "node",
        kind: registered.type,
        executionPath: "event:event",
        traceId: "node-trace",
        withSpan: (_name, effect) => effect,
      },
    })
    .pipe(Effect.map((selected) => ({ outputs, selected })));
};

describe("Utilities plugin", () => {
  it.effect("registers six complete schemas", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      assert.deepStrictEqual(
        registered.map((item) => item.id),
        ["Print", "ConcatStrings", "IntToString", "Branch", "FormatString", "Tick"],
      );
      assert.isTrue(registered.every((item) => item.description !== undefined));

      const print = schema(registered, "Print");
      assert.strictEqual(print.type, "exec");
      assert.deepStrictEqual(
        print.dataInputs.map(({ id, name, type, defaultValue }) => ({
          id,
          name,
          type: type._tag,
          defaultValue,
        })),
        [{ id: "in", name: "Input", type: "String", defaultValue: "" }],
      );
      assert.deepStrictEqual(print.executionInputs.map((input) => input.id), ["exec"]);
      assert.deepStrictEqual(print.executionOutputs.map((output) => output.id), ["exec"]);

      const branch = schema(registered, "Branch");
      assert.deepStrictEqual(branch.executionInputs.map((input) => input.id), ["exec"]);
      assert.deepStrictEqual(branch.executionOutputs.map((output) => output.id), [
        "exec",
        "trueOut",
        "falseOut",
      ]);

      const tick = schema(registered, "Tick");
      assert.deepStrictEqual(
        tick.properties.map((property) => ({
          id: property.id,
          name: property.name,
          optional: property.optional,
          defaultValue: "defaultValue" in property ? property.defaultValue : undefined,
        })),
        [
          {
            id: "intervalSeconds",
            name: "Interval (seconds)",
            optional: false,
            defaultValue: 1,
          },
        ],
      );
      assert.deepStrictEqual(
        tick.dataOutputs.map(({ id, name, type }) => ({ id, name, type: type._tag })),
        [{ id: "tick", name: "Tick", type: "Int" }],
      );
    }),
  );

  it.effect("Print writes through the injectable Effect logger", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      const messages: Array<unknown> = [];
      const logger = Logger.make<unknown, void>((options) => {
        messages.push(options.message);
      });
      yield* run(schema(registered, "Print"), { in: "hello" }).pipe(
        Effect.provide(Logger.layer([logger])),
      );
      assert.strictEqual(messages.length, 1);
      assert.deepStrictEqual(messages[0], ["Utilities Print", { value: "hello" }]);
    }),
  );

  it.effect("Concat Strings joins both inputs", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      const concat = schema(registered, "ConcatStrings");
      const result = yield* run(concat, {
        str1: "macro",
        str2: "graph",
      });
      assert.strictEqual(result.outputs.get("result"), "macrograph");
      assert.strictEqual((yield* run(concat)).outputs.get("result"), "");
    }),
  );

  it.effect("Int To String emits a decimal string", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      const intToString = schema(registered, "IntToString");
      const result = yield* run(intToString, { int: -42 });
      assert.strictEqual(result.outputs.get("str"), "-42");
      assert.isTrue(Result.isFailure(yield* Effect.result(run(intToString, { int: 1.5 }))));
    }),
  );

  it.effect("Branch selects exactly the matching execution output", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      const branch = schema(registered, "Branch");
      const whenTrue = yield* run(branch, { condition: true });
      const whenFalse = yield* run(branch, { condition: false });
      assert.strictEqual(whenTrue.selected?.id, "trueOut");
      assert.strictEqual(whenFalse.selected?.id, "falseOut");
    }),
  );

  it.effect("Format String parses syntax, deduplicates inputs, and formats safely", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(parseFormatString("{{{name}}} {name} {bad-name} {open"), [
        { type: "text", value: "{" },
        { type: "placeholder", name: "name" },
        { type: "text", value: "} " },
        { type: "placeholder", name: "name" },
        { type: "text", value: " {bad-name} {open" },
      ]);
      assert.deepStrictEqual(parseFormatString("{__proto__} {constructor} } {"), [
        { type: "placeholder", name: "__proto__" },
        { type: "text", value: " " },
        { type: "placeholder", name: "constructor" },
        { type: "text", value: " } {" },
      ]);

      const registered = yield* schemas;
      const format = schema(registered, "FormatString");
      const io = format.generateIO({ format: "{name}: {name} / {other}" });
      assert.deepStrictEqual(
        io.dataInputs.map((input) => input.id),
        ["name", "other"],
      );
      assert.deepStrictEqual(
        format
          .generateIO({ format: "{constructor} {__proto__} {constructor}" })
          .dataInputs.map((input) => input.id),
        ["constructor", "__proto__"],
      );
      const result = yield* run(
        format,
        { name: "A$&", other: "{literal}" },
        { format: "{name}: {name} / {other}" },
      );
      assert.strictEqual(result.outputs.get("result"), "A$&: A$& / {literal}");
      const composite = yield* run(
        format,
        { value: { nested: [1, true, null] } },
        { format: "Value: {value}" },
      );
      assert.strictEqual(composite.outputs.get("result"), 'Value: {"nested":[1,true,null]}');
      assert.strictEqual(formatValue({ nested: [1, true, null] }), '{"nested":[1,true,null]}');
      assert.notInclude(formatValue(Redacted.make("private-value")), "private-value");
    }),
  );

  it.effect("Tick matches configured intervals and emits its counter", () =>
    Effect.gen(function* () {
      const registered = yield* schemas;
      const tick = schema(registered, "Tick");
      assert.isFalse(yield* tick.matches(new TickEvent({ tick: 3 }), { intervalSeconds: 2 }));
      assert.isTrue(yield* tick.matches(new TickEvent({ tick: 4 }), { intervalSeconds: 2 }));
      assert.isFalse(yield* tick.matches(new TickEvent({ tick: 1 }), { intervalSeconds: 0 }));
      assert.isFalse(yield* tick.matches(new TickEvent({ tick: 1 }), { intervalSeconds: -1 }));
      assert.isFalse(yield* tick.matches(new TickEvent({ tick: 1 }), { intervalSeconds: 1.5 }));
      assert.strictEqual(new TickEvent({ tick: 1 })._tag, "TickEvent");
      const result = yield* run(tick, {}, {}, new TickEvent({ tick: 7 }));
      assert.strictEqual(result.outputs.get("tick"), 7);
    }),
  );
});
