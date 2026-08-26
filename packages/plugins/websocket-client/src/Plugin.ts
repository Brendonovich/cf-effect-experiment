import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import {
  MessageReceived,
  WebSocketClientEngine,
  WebSocketConnection,
} from "./Definition.ts";

const connectionProperty = {
  connection: {
    name: "Connection",
    description: "The configured WebSocket connection.",
    resource: WebSocketConnection,
  },
} as const;

const WebSocketClientPlugin = Plugin.make({
  id: "websocket-client",
  name: "WebSocket Client",
  engine: WebSocketClientEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "SendMessage",
      name: "Send Message",
      description: "Sends a text message over a connected WebSocket.",
      properties: connectionProperty,
      io: (io) => ({
        message: io.data.in("message", DataType.String, { name: "Message" }),
      }),
      run: ({ io, properties, engine }) =>
        engine.WebSocketSendMessage({
          connectionId: properties.connection,
          data: io.message,
        }),
    });
    yield* context.schema.register({
      id: "MessageReceived",
      name: "Message Received",
      description:
        "Runs when a text message arrives from the selected WebSocket.",
      type: "event",
      properties: connectionProperty,
      event: (event, { properties }) =>
        Effect.succeed(
          event._tag === "WebSocketMessageReceived" &&
            event.connectionId === properties.connection,
        ),
      io: (io) => ({
        message: io.data.out("message", DataType.String, { name: "Message" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event instanceof MessageReceived) io.message(event.data);
        }),
    });
  }),
});

export default WebSocketClientPlugin;
