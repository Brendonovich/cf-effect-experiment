import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Effect } from "effect";

import { KeyboardEngine, type KeyEvent } from "./Definition.ts";
import * as Keys from "./Keys.ts";

const keybindProperties = {
  key: {
    name: "Key",
    description: "A key name such as A, 1, F5, Space, Enter, Escape, ArrowUp or Numpad0.",
    type: t.String,
    defaultValue: "A",
  },
  ctrl: { name: "Ctrl", type: t.Bool, defaultValue: false },
  shift: { name: "Shift", type: t.Bool, defaultValue: false },
  alt: { name: "Alt / Option", type: t.Bool, defaultValue: false },
  meta: { name: "Meta / Cmd / Win", type: t.Bool, defaultValue: false },
} as const;

/** A keybind matches its key with exactly the chosen modifiers held. */
export const matchesKeybind = (
  event: KeyEvent,
  keybind: {
    readonly key: string;
    readonly ctrl: boolean;
    readonly shift: boolean;
    readonly alt: boolean;
    readonly meta: boolean;
  },
) =>
  event.key === Keys.parse(keybind.key) &&
  event.ctrl === keybind.ctrl &&
  event.shift === keybind.shift &&
  event.alt === keybind.alt &&
  event.meta === keybind.meta;

const KeyboardModule = Module.make({
  name: "Keyboard",
  engine: KeyboardEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "Keybind",
      name: "Keybind",
      description:
        "Fires when the key is pressed with exactly the chosen modifiers held, and again when it is released. Held keys don't repeat.",
      type: "event",
      properties: keybindProperties,
      event: (event, { properties }) => Effect.succeed(matchesKeybind(event, properties)),
      io: (io) => ({
        pressed: io.exec.out("exec", { name: "Pressed" }),
        released: io.exec.out("released", { name: "Released" }),
      }),
      run: ({ event, io }) =>
        Effect.succeed(event?.state === "released" ? io.released : io.pressed),
    });

    const registerKeyEvent = (
      id: string,
      name: string,
      description: string,
      state: KeyEvent["state"],
    ) =>
      context.schema.register({
        id,
        name,
        description,
        type: "event",
        event: (event) => Effect.succeed(event.state === state),
        io: (io) => ({
          key: io.data.out("key", t.String, { name: "Key" }),
          ctrl: io.data.out("ctrl", t.Bool, { name: "Ctrl" }),
          shift: io.data.out("shift", t.Bool, { name: "Shift" }),
          alt: io.data.out("alt", t.Bool, { name: "Alt / Option" }),
          meta: io.data.out("meta", t.Bool, { name: "Meta / Cmd / Win" }),
        }),
        run: ({ event, io }) =>
          Effect.sync(() => {
            if (!event) return;
            io.key(event.key);
            io.ctrl(event.ctrl);
            io.shift(event.shift);
            io.alt(event.alt);
            io.meta(event.meta);
          }),
      });

    yield* registerKeyEvent(
      "KeyPressed",
      "Key Pressed",
      "Fires for every key press, with the modifiers that were held.",
      "pressed",
    );
    yield* registerKeyEvent(
      "KeyReleased",
      "Key Released",
      "Fires for every key release, with the modifiers held when it was pressed.",
      "released",
    );
  }),
});

export default KeyboardModule;
