import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Effect } from "effect";

import { StreamDeckEngine, StreamDeckServer } from "./Definition.ts";

const StreamDeckModule = Module.make({
  id: "streamdeck",
  name: "Stream Deck WebSocket",
  engine: StreamDeckEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "KeyDown",
      name: "Stream Deck Key Down",
      type: "event",
      properties: { server: { name: "Server", resource: StreamDeckServer } },
      event: (event, { properties }) =>
        Effect.succeed(event.serverId === properties.server && event.event === "keyDown"),
      io: (io) => ({ id: io.data.out("id", t.String, { name: "Key ID" }) }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event) io.id(event.payload.settings.id);
        }),
    });
    yield* context.schema.register({
      id: "KeyUp",
      name: "Stream Deck Key Up",
      type: "event",
      properties: { server: { name: "Server", resource: StreamDeckServer } },
      event: (event, { properties }) =>
        Effect.succeed(event.serverId === properties.server && event.event === "keyUp"),
      io: (io) => ({ id: io.data.out("id", t.String, { name: "Key ID" }) }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event) io.id(event.payload.settings.id);
        }),
    });
  }),
});

export default StreamDeckModule;
