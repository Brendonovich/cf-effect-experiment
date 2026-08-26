import { DataType, Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import {
  ClientConnected,
  ClientDisconnected,
  ClientId,
  MessageReceived,
  WebSocketServer,
  WebSocketServerEngine,
} from "./Definition.ts";

const serverProperty = {
  server: {
    name: "Server",
    description: "The configured WebSocket server.",
    resource: WebSocketServer,
  },
} as const;

const WebSocketServerPlugin = Plugin.make({
  id: "websocket-server",
  name: "WebSocket Server",
  engine: WebSocketServerEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "SendToClient",
      name: "Send To Client",
      description: "Sends a text message to one connected client.",
      properties: serverProperty,
      io: (io) => ({
        clientId: io.data.in("clientId", DataType.String, { name: "Client ID" }),
        message: io.data.in("message", DataType.String, { name: "Message" }),
      }),
      run: ({ io, properties, engine }) =>
        engine.WebSocketServerSendToClient({
          serverId: properties.server,
          clientId: ClientId.make(io.clientId),
          message: io.message,
        }),
    });
    yield* context.schema.register({
      id: "Broadcast",
      name: "Broadcast",
      description: "Sends a text message to every connected client.",
      properties: serverProperty,
      io: (io) => ({
        message: io.data.in("message", DataType.String, { name: "Message" }),
      }),
      run: ({ io, properties, engine }) =>
        engine.WebSocketServerBroadcast({
          serverId: properties.server,
          message: io.message,
        }),
    });
    yield* context.schema.register({
      id: "ClientConnected",
      name: "Client Connected",
      description: "Runs when a client connects to the selected server.",
      type: "event",
      properties: serverProperty,
      event: (event, { properties }) =>
        Effect.succeed(
          event._tag === "WebSocketServerClientConnected" && event.serverId === properties.server,
        ),
      io: (io) => ({
        clientId: io.data.out("clientId", DataType.String, { name: "Client ID" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event instanceof ClientConnected) io.clientId(event.clientId);
        }),
    });
    yield* context.schema.register({
      id: "ClientDisconnected",
      name: "Client Disconnected",
      description: "Runs when a client disconnects from the selected server.",
      type: "event",
      properties: serverProperty,
      event: (event, { properties }) =>
        Effect.succeed(
          event._tag === "WebSocketServerClientDisconnected" &&
            event.serverId === properties.server,
        ),
      io: (io) => ({
        clientId: io.data.out("clientId", DataType.String, { name: "Client ID" }),
        cause: io.data.out("cause", DataType.String, { name: "Cause" }),
        reason: io.data.out("reason", DataType.String, { name: "Reason" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event instanceof ClientDisconnected) {
            io.clientId(event.clientId);
            io.cause(event.cause);
            io.reason(event.reason);
          }
        }),
    });
    yield* context.schema.register({
      id: "MessageReceived",
      name: "Message Received",
      description: "Runs when text arrives from a client on the selected server.",
      type: "event",
      properties: serverProperty,
      event: (event, { properties }) =>
        Effect.succeed(
          event._tag === "WebSocketServerMessageReceived" && event.serverId === properties.server,
        ),
      io: (io) => ({
        clientId: io.data.out("clientId", DataType.String, { name: "Client ID" }),
        message: io.data.out("message", DataType.String, { name: "Message" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event instanceof MessageReceived) {
            io.clientId(event.clientId);
            io.message(event.message);
          }
        }),
    });
  }),
});

export default WebSocketServerPlugin;
