import { Engine, Resource } from "@macrograph/plugin";
import { Array, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const ServerId = Schema.String.pipe(Schema.brand("WebSocketServerId"));
export type ServerId = typeof ServerId.Type;

export const ClientId = Schema.String.pipe(Schema.brand("WebSocketServerClientId"));
export type ClientId = typeof ClientId.Type;

export const ServerDefinition = Schema.Struct({
  id: ServerId,
  name: Schema.String,
  host: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed("127.0.0.1"))),
  port: Schema.Int.pipe(Schema.withDecodingDefaultKey(Effect.succeed(1890))),
  manuallyDisabled: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
});
export type ServerDefinition = typeof ServerDefinition.Type;

export const ServerStatus = Schema.Literals([
  "stopped",
  "starting",
  "running",
  "error",
]);
export type ServerStatus = typeof ServerStatus.Type;

export const ServerState = Schema.Struct({
  definition: ServerDefinition,
  status: ServerStatus,
  clientCount: Schema.Int,
  error: Schema.optional(Schema.String),
});
export type ServerState = typeof ServerState.Type;

export class InvalidServer extends Schema.TaggedError<InvalidServer>()(
  "WebSocketInvalidServer",
  { reason: Schema.String },
) {}

export class ServerNotFound extends Schema.TaggedError<ServerNotFound>()(
  "WebSocketServerNotFound",
  { id: ServerId },
) {}

export class ServerStartFailed extends Schema.TaggedError<ServerStartFailed>()(
  "WebSocketServerStartFailed",
  { id: ServerId, reason: Schema.String },
) {}

export class ServerNotRunning extends Schema.TaggedError<ServerNotRunning>()(
  "WebSocketServerNotRunning",
  { id: ServerId },
) {}

export class ClientNotFound extends Schema.TaggedError<ClientNotFound>()(
  "WebSocketServerClientNotFound",
  { serverId: ServerId, clientId: ClientId },
) {}

export class MessageTooLarge extends Schema.TaggedError<MessageTooLarge>()(
  "WebSocketServerMessageTooLarge",
  { size: Schema.Int, limit: Schema.Int },
) {}

export class SendFailed extends Schema.TaggedError<SendFailed>()("WebSocketServerSendFailed", {
  serverId: ServerId,
  reason: Schema.String,
}) {}

export class ClientConnected extends Schema.TaggedClass<ClientConnected>()(
  "WebSocketServerClientConnected",
  { serverId: ServerId, clientId: ClientId },
) {}

export class ClientDisconnected extends Schema.TaggedClass<ClientDisconnected>()(
  "WebSocketServerClientDisconnected",
  {
    serverId: ServerId,
    clientId: ClientId,
    cause: Schema.Literals(["peer", "server", "error"]),
    reason: Schema.String,
  },
) {}

export class MessageReceived extends Schema.TaggedClass<MessageReceived>()(
  "WebSocketServerMessageReceived",
  { serverId: ServerId, clientId: ClientId, message: Schema.String },
) {}

export const ServerEvent = Schema.Union([ClientConnected, ClientDisconnected, MessageReceived]);

export class WebSocketServer extends Resource.make<WebSocketServer, ServerId>()("WebSocketServer", {
  name: "WebSocket Server",
  description: "A configured local WebSocket listener.",
}) {}

const serverMutationErrors = Schema.Union([InvalidServer, ServerNotFound]);
const startErrors = Schema.Union([ServerNotFound, ServerStartFailed]);

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("WebSocketServerAdd", {
    payload: Schema.Struct({
      name: Schema.String,
      host: Schema.String,
      port: Schema.Int,
    }),
    success: ServerId,
    error: InvalidServer,
  }),
  Rpc.make("WebSocketServerUpdate", {
    payload: ServerDefinition,
    error: serverMutationErrors,
  }),
  Rpc.make("WebSocketServerRemove", {
    payload: Schema.Struct({ id: ServerId }),
    error: ServerNotFound,
  }),
  Rpc.make("WebSocketServerStart", {
    payload: Schema.Struct({ id: ServerId }),
    error: startErrors,
  }),
  Rpc.make("WebSocketServerStop", {
    payload: Schema.Struct({ id: ServerId }),
    error: ServerNotFound,
  }),
  Rpc.make("WebSocketServerStatus", {
    payload: Schema.Struct({ id: ServerId }),
    success: ServerState,
    error: ServerNotFound,
  }),
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("WebSocketServerSendToClient", {
    payload: Schema.Struct({
      serverId: ServerId,
      clientId: ClientId,
      message: Schema.String,
    }),
    error: Schema.Union([
      ServerNotFound,
      ServerNotRunning,
      ClientNotFound,
      MessageTooLarge,
      SendFailed,
    ]),
  }),
  Rpc.make("WebSocketServerBroadcast", {
    payload: Schema.Struct({ serverId: ServerId, message: Schema.String }),
    error: Schema.Union([
      ServerNotFound,
      ServerNotRunning,
      MessageTooLarge,
      SendFailed,
    ]),
  }),
) {}

export const RuntimeStorage = Schema.Struct({
  servers: Schema.Array(ServerDefinition).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
});

export const ClientState = Schema.Struct({ servers: Schema.Array(ServerState) });

export class WebSocketServerEngine extends Engine.make({
  resources: [WebSocketServer],
  events: Array.empty<typeof ServerEvent.Type>(),
  storage: RuntimeStorage,
  initialStorage: { servers: [] },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}

export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const MAX_BUFFERED_BYTES = 4 * MAX_MESSAGE_BYTES;
export const MAX_PENDING_MESSAGES = 64;
