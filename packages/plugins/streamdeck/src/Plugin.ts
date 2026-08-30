import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import { StreamDeckButton, StreamDeckEngine } from "./Definition.ts";

const buttonProperties = { button: { name: "Button", resource: StreamDeckButton } } as const;

const StreamDeckPlugin = Plugin.make({
  id: "streamdeck",
  name: "Stream Deck",
  engine: StreamDeckEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "KeyDown",
      name: "Stream Deck Button Down",
      description: "Fires when a bound key is pressed. Defaults to all buttons.",
      type: "event",
      properties: {
        button: {
          name: "Button",
          description: "All buttons, or a specific MacroGraph button.",
          resource: StreamDeckButton,
          optional: true,
        },
      },
      event: (event, { properties }) =>
        Effect.succeed(
          event._tag === "StreamDeckKeyDown" &&
            (properties.button === undefined || event.buttonId === properties.button),
        ),
      io: (io) => ({
        name: io.data.out("name", DataType.String, { name: "Button Name" }),
        state: io.data.out("state", DataType.Bool, { name: "State" }),
        device: io.data.out("device", DataType.String, { name: "Device" }),
        payload: io.data.out("payload", DataType.String, { name: "Payload JSON" }),
        settings: io.data.out("settings", DataType.String, { name: "Settings JSON" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event?._tag !== "StreamDeckKeyDown") return;
          io.name(event.buttonName);
          io.state(event.state !== 0);
          io.device(event.deviceId);
          io.payload(JSON.stringify(event.payload ?? {}));
          io.settings(JSON.stringify(event.settings));
        }),
    });

    yield* context.schema.register({
      id: "KeyUp",
      name: "Stream Deck Button Up",
      type: "event",
      properties: buttonProperties,
      event: (event, { properties }) =>
        Effect.succeed(
          event._tag === "StreamDeckKeyUp" && event.buttonId === properties.button,
        ),
      io: (io) => ({
        state: io.data.out("state", DataType.Bool, { name: "State" }),
        device: io.data.out("device", DataType.String, { name: "Device" }),
        payload: io.data.out("payload", DataType.String, { name: "Payload JSON" }),
        settings: io.data.out("settings", DataType.String, { name: "Settings JSON" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event?._tag !== "StreamDeckKeyUp") return;
          io.state(event.state !== 0);
          io.device(event.deviceId);
          io.payload(JSON.stringify(event.payload ?? {}));
          io.settings(JSON.stringify(event.settings));
        }),
    });

    yield* context.schema.register({
      id: "SetButtonState",
      name: "Set Stream Deck Button State",
      description: "Switches the key between its two icons (0 = off, 1 = on).",
      properties: buttonProperties,
      io: (io) => ({
        state: io.data.in("state", DataType.Bool, { name: "State", defaultValue: false }),
      }),
      run: ({ io, properties, engine }) =>
        engine.StreamDeckSetState({
          button: properties.button,
          state: io.state ? 1 : 0,
        }),
    });

    yield* context.schema.register({
      id: "SetButtonTitle",
      name: "Set Stream Deck Button Title",
      description: "Sets the text shown on the key.",
      properties: buttonProperties,
      io: (io) => ({
        title: io.data.in("title", DataType.String, { name: "Title", defaultValue: "" }),
      }),
      run: ({ io, properties, engine }) =>
        engine.StreamDeckSetTitle({ button: properties.button, title: io.title }),
    });
  }),
});

export default StreamDeckPlugin;
