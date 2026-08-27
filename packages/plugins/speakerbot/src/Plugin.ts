import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import { SpeakerBotConnection, SpeakerBotEngine } from "./Definition.ts";

const properties = { connection: { name: "Connection", resource: SpeakerBotConnection } } as const;

const SpeakerBotPlugin = Plugin.make({
  id: "speakerbot",
  name: "SpeakerBot",
  engine: SpeakerBotEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "Speak",
      name: "SpeakerBot Speak",
      properties,
      io: (io) => ({
        voice: io.data.in("voice", DataType.String, { name: "Voice" }),
        message: io.data.in("message", DataType.String, { name: "Message" }),
      }),
      run: ({ io, properties, engine }) =>
        engine.SpeakerBotWebSocketSendMessage({
          connectionId: properties.connection,
          data: JSON.stringify({
            voice: io.voice,
            message: io.message,
            id: "Macrograph",
            request: "Speak",
          }),
        }),
    });
    for (const [id, name, request] of [
      ["StopCurrent", "SpeakerBot Stop Current", "Stop"],
      ["QueueClear", "SpeakerBot Queue Clear", "Clear"],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        properties,
        io: () => ({}),
        run: ({ properties, engine }) =>
          engine.SpeakerBotWebSocketSendMessage({
            connectionId: properties.connection,
            data: JSON.stringify({ id: "Macrograph", request }),
          }),
      });
    }
    for (const [id, name, enabled, disabled] of [
      ["ToggleTTS", "SpeakerBot Toggle TTS", "Enable", "Disable"],
      ["QueueToggle", "SpeakerBot Queue Toggle", "Pause", "Resume"],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        properties,
        io: (io) => ({
          state: io.data.in("state", DataType.Bool, {
            name: id === "QueueToggle" ? "Queue Paused" : "State",
          }),
        }),
        run: ({ io, properties, engine }) =>
          engine.SpeakerBotWebSocketSendMessage({
            connectionId: properties.connection,
            data: JSON.stringify({ id: "Macrograph", request: io.state ? enabled : disabled }),
          }),
      });
    }
    yield* context.schema.register({
      id: "EventsToggle",
      name: "SpeakerBot Events Toggle",
      properties,
      io: (io) => ({ state: io.data.in("state", DataType.Bool, { name: "State" }) }),
      run: ({ io, properties, engine }) =>
        engine.SpeakerBotWebSocketSendMessage({
          connectionId: properties.connection,
          data: JSON.stringify({
            id: "Macrograph",
            request: "Events",
            state: io.state ? "on" : "off",
          }),
        }),
    });
  }),
});

export default SpeakerBotPlugin;
