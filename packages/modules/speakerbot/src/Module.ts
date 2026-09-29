import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Effect } from "effect";

import { SpeakerBotConnection, SpeakerBotEngine } from "./Definition.ts";

const properties = { connection: { name: "Connection", resource: SpeakerBotConnection } } as const;

const SpeakerBotModule = Module.make({
  id: "speakerbot",
  name: "SpeakerBot",
  engine: SpeakerBotEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "Speak",
      name: "SpeakerBot Speak",
      properties,
      io: (io) => ({
        voice: io.data.in("voice", t.String, { name: "Voice" }),
        message: io.data.in("message", t.String, { name: "Message" }),
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
    yield* context.schema.register({
      id: "StopCurrent",
      name: "SpeakerBot Stop Current",
      properties,
      io: () => ({}),
      run: ({ properties, engine }) =>
        engine.SpeakerBotWebSocketSendMessage({
          connectionId: properties.connection,
          data: JSON.stringify({ id: "Macrograph", request: "Stop" }),
        }),
    });
    yield* context.schema.register({
      id: "QueueClear",
      name: "SpeakerBot Queue Clear",
      properties,
      io: () => ({}),
      run: ({ properties, engine }) =>
        engine.SpeakerBotWebSocketSendMessage({
          connectionId: properties.connection,
          data: JSON.stringify({ id: "Macrograph", request: "Clear" }),
        }),
    });
    yield* context.schema.register({
      id: "ToggleTTS",
      name: "SpeakerBot Toggle TTS",
      properties,
      io: (io) => ({ state: io.data.in("state", t.Bool, { name: "State" }) }),
      run: ({ io, properties, engine }) =>
        engine.SpeakerBotWebSocketSendMessage({
          connectionId: properties.connection,
          data: JSON.stringify({ id: "Macrograph", request: io.state ? "Enable" : "Disable" }),
        }),
    });
    yield* context.schema.register({
      id: "QueueToggle",
      name: "SpeakerBot Queue Toggle",
      properties,
      io: (io) => ({ state: io.data.in("state", t.Bool, { name: "Queue Paused" }) }),
      run: ({ io, properties, engine }) =>
        engine.SpeakerBotWebSocketSendMessage({
          connectionId: properties.connection,
          data: JSON.stringify({ id: "Macrograph", request: io.state ? "Pause" : "Resume" }),
        }),
    });
    yield* context.schema.register({
      id: "EventsToggle",
      name: "SpeakerBot Events Toggle",
      properties,
      io: (io) => ({ state: io.data.in("state", t.Bool, { name: "State" }) }),
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

export default SpeakerBotModule;
