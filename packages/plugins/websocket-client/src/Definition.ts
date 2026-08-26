import * as Engine from "@macrograph/plugin/Engine";
import * as Resource from "@macrograph/plugin/Resource";
import { Array, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const ConnectionId = Schema.String.pipe(
  Schema.brand("WebSocketConnectionId"),
);
export type ConnectionId = typeof ConnectionId.Type;

export const ConnectionDefinition = Schema.Struct({
  id: ConnectionId,
  name: Schema.String,
  url: Schema.String,
  connectOnStartup: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false)),
  ),
});
export type ConnectionDefinition = typeof ConnectionDefinition.Type;

export const ConnectionStatus = Schema.Literals([
  "disconnected",
  "connecting",
  "connected",
  "error",
]);
export type ConnectionStatus = typeof ConnectionStatus.Type;

export class InvalidConnection extends Schema.TaggedError<InvalidConnection>()(
  "WebSocketInvalidConnection",
  { reason: Schema.String },
) {}

export class ConnectionNotFound extends Schema.TaggedError<ConnectionNotFound>()(
  "WebSocketConnectionNotFound",
  { id: ConnectionId },
) {}

export class ConnectionFailed extends Schema.TaggedError<ConnectionFailed>()(
  "WebSocketConnectionFailed",
  { id: ConnectionId, reason: Schema.String },
) {}

export class NotConnected extends Schema.TaggedError<NotConnected>()(
  "WebSocketNotConnected",
  { id: ConnectionId },
) {}

export class MessageTooLarge extends Schema.TaggedError<MessageTooLarge>()(
  "WebSocketMessageTooLarge",
  { size: Schema.Int, limit: Schema.Int },
) {}

export class SendFailed extends Schema.TaggedError<SendFailed>()(
  "WebSocketSendFailed",
  {
    id: ConnectionId,
    reason: Schema.String,
  },
) {}

export class MessageReceived extends Schema.TaggedClass<MessageReceived>()(
  "WebSocketMessageReceived",
  { connectionId: ConnectionId, data: Schema.String },
) {}

export class WebSocketConnection extends Resource.make<
  WebSocketConnection,
  ConnectionId
>()("WebSocketConnection", {
  name: "WebSocket Connection",
  description: "A configured outbound WebSocket connection.",
}) {}

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("WebSocketAddConnection", {
    payload: Schema.Struct({
      name: Schema.String,
      url: Schema.String,
    }),
    success: ConnectionId,
    error: InvalidConnection,
  }),
  Rpc.make("WebSocketUpdateConnection", {
    payload: ConnectionDefinition,
    error: Schema.Union([InvalidConnection, ConnectionNotFound]),
  }),
  Rpc.make("WebSocketRemoveConnection", {
    payload: Schema.Struct({ id: ConnectionId }),
    error: ConnectionNotFound,
  }),
  Rpc.make("WebSocketConnect", {
    payload: Schema.Struct({ id: ConnectionId }),
    error: Schema.Union([
      ConnectionNotFound,
      ConnectionFailed,
    ]),
  }),
  Rpc.make("WebSocketDisconnect", {
    payload: Schema.Struct({ id: ConnectionId }),
    error: ConnectionNotFound,
  }),
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("WebSocketSendMessage", {
    payload: Schema.Struct({ connectionId: ConnectionId, data: Schema.String }),
    error: Schema.Union([
      ConnectionNotFound,
      NotConnected,
      MessageTooLarge,
      SendFailed,
    ]),
  }),
) {}

export const RuntimeStorage = Schema.Struct({
  connections: Schema.Array(ConnectionDefinition).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
});

export const ClientState = Schema.Struct({
  connections: Schema.Array(
    Schema.Struct({
      definition: ConnectionDefinition,
      status: ConnectionStatus,
      error: Schema.optional(Schema.String),
    }),
  ),
});

export class WebSocketClientEngine extends Engine.make({
  resources: [WebSocketConnection],
  events: Array.empty<MessageReceived>(),
  storage: RuntimeStorage,
  initialStorage: { connections: [] },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}

export const MAX_MESSAGE_BYTES = 1024 * 1024;
