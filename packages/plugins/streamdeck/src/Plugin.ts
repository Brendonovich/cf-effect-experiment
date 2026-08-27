import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import { StreamDeckEngine, StreamDeckServer } from "./Definition.ts";

const StreamDeckPlugin = Plugin.make({
  id: "streamdeck",
  name: "Stream Deck WebSocket",
  engine: StreamDeckEngine,
  effect: Effect.fnUntraced(function* (context) {
    for (const [id, name, eventName] of [
      ["KeyDown", "Stream Deck Key Down", "keyDown"],
      ["KeyUp", "Stream Deck Key Up", "keyUp"],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        type: "event",
        properties: { server: { name: "Server", resource: StreamDeckServer } },
        event: (event, { properties }) =>
          Effect.succeed(event.serverId === properties.server && event.event === eventName),
        io: (io) => ({ id: io.data.out("id", DataType.String, { name: "Key ID" }) }),
        run: ({ event, io }) =>
          Effect.sync(() => {
            if (event) io.id(event.payload.settings.id);
          }),
      });
    }
  }),
});

export default StreamDeckPlugin;
