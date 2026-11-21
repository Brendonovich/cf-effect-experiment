import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/module";
import { Effect } from "effect";

import { KeyEvent } from "../src/Definition.ts";
import module from "../src/Module.ts";

const execution = {
  projectId: "project",
  graphId: "graph",
  eventNodeId: "event",
  traceId: "trace",
};
const node = {
  nodeId: "node",
  kind: "event" as const,
  executionPath: "node",
  traceId: "trace",
  withSpan: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
};

const key = (
  key: string,
  state: KeyEvent["state"],
  modifiers: Partial<Pick<KeyEvent, "ctrl" | "shift" | "alt" | "meta">> = {},
) =>
  new KeyEvent({
    key,
    state,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    ...modifiers,
  });

const run = (schema: Registration.RegisteredSchema, event: KeyEvent) => {
  const outputs: Record<string, unknown> = {};
  return schema
    .run({
      input: () => undefined,
      output: (ref, value) => {
        outputs[ref.id] = value;
      },
      properties: {},
      event,
      execution,
      node,
      engine: {},
    })
    .pipe(Effect.map((selected) => ({ selected: selected?.id, outputs })));
};

describe("Keyboard catalog", () => {
  it.effect("registers event nodes with keybind properties and press/release outputs", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(module.effect);
      assert.strictEqual(module.name, "Keyboard");
      assert.deepStrictEqual(
        schemas.map((schema) => [schema.id, schema.type]),
        [
          ["Keybind", "event"],
          ["KeyPressed", "event"],
          ["KeyReleased", "event"],
        ],
      );
      const keybind = schemas[0]!;
      assert.deepStrictEqual(
        keybind.properties.map((property) => property.id),
        ["key", "ctrl", "shift", "alt", "meta"],
      );
      assert.deepStrictEqual(
        keybind.executionOutputs.map((output) => [output.id, output.name]),
        [
          ["exec", "Pressed"],
          ["released", "Released"],
        ],
      );
    }),
  );

  it.effect("matches keybinds with exactly the chosen modifiers", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(module.effect);
      const keybind = schemas.find((schema) => schema.id === "Keybind")!;
      const ctrlK = { key: "k", ctrl: true };

      assert.isTrue(yield* keybind.matches(key("K", "pressed", { ctrl: true }), ctrlK));
      assert.isTrue(yield* keybind.matches(key("K", "released", { ctrl: true }), ctrlK));
      assert.isFalse(yield* keybind.matches(key("K", "pressed"), ctrlK));
      assert.isFalse(
        yield* keybind.matches(key("K", "pressed", { ctrl: true, shift: true }), ctrlK),
      );
      assert.isFalse(yield* keybind.matches(key("J", "pressed", { ctrl: true }), ctrlK));
      // Defaults: key A without modifiers.
      assert.isTrue(yield* keybind.matches(key("A", "pressed"), {}));
      assert.isTrue(yield* keybind.matches(key("Escape", "pressed"), { key: "esc" }));
      assert.isFalse(yield* keybind.matches(key("A", "pressed"), { key: "not a key" }));

      assert.strictEqual((yield* run(keybind, key("A", "pressed"))).selected, "exec");
      assert.strictEqual((yield* run(keybind, key("A", "released"))).selected, "released");
    }),
  );

  it.effect("reports every key and its modifiers from the generic events", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(module.effect);
      const pressed = schemas.find((schema) => schema.id === "KeyPressed")!;
      const released = schemas.find((schema) => schema.id === "KeyReleased")!;
      const event = key("F5", "pressed", { shift: true, meta: true });

      assert.isTrue(yield* pressed.matches(event, {}));
      assert.isFalse(yield* released.matches(event, {}));
      assert.isTrue(yield* released.matches(key("F5", "released"), {}));
      assert.deepStrictEqual((yield* run(pressed, event)).outputs, {
        key: "F5",
        ctrl: false,
        shift: true,
        alt: false,
        meta: true,
      });
    }),
  );
});
