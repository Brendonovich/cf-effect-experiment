import { Engine, Resource } from "@macrograph/plugin";
import { Array, Schema } from "effect";
import * as S from "effect/Schema";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import * as ObsEvent from "./Events.ts";
import { SocketAddress } from "./Types.ts";

export { SocketAddress } from "./Types.ts";

export class ConnectionFailed extends S.TaggedErrorClass<ConnectionFailed>()("ConnectionFailed", {
  cause: S.Unknown,
}) {}

export class SocketNotFound extends S.TaggedErrorClass<SocketNotFound>()("SocketNotFound", {
  address: SocketAddress,
}) {}

export class RequestFailed extends S.TaggedErrorClass<RequestFailed>()("RequestFailed", {
  requestType: S.String,
  code: S.Number,
  comment: S.optional(S.String),
}) {}

export class OBSSocket extends Resource.make<OBSSocket, SocketAddress>()("OBSWebSocket", {
  name: "OBS WebSocket",
}) {}

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("AddSocket", {
    payload: S.Struct({
      address: SocketAddress,
      password: S.optional(S.String),
      name: S.optional(S.String),
    }),
    error: ConnectionFailed,
  }),
  Rpc.make("RemoveSocket", { payload: S.Struct({ address: SocketAddress }) }),
  Rpc.make("ConnectSocket", {
    payload: S.Struct({ address: SocketAddress }),
    error: S.Union([ConnectionFailed, SocketNotFound]),
  }),
  Rpc.make("DisconnectSocket", { payload: S.Struct({ address: SocketAddress }) }),
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("Call", {
    payload: S.Struct({
      address: SocketAddress,
      requestType: S.String,
      requestData: S.optional(S.Record(S.String, S.Unknown)),
    }),
    success: S.Unknown,
    error: S.Union([SocketNotFound, RequestFailed, ConnectionFailed]),
  }),
) {}

export const RuntimeStorage = Schema.Struct({
  sockets: Schema.Record(
    SocketAddress,
    Schema.Struct({
      name: Schema.optional(Schema.String),
      password: Schema.optional(Schema.String),
      connectOnStartup: Schema.Boolean,
    }),
  ),
});

export const ClientState = Schema.Struct({
  sockets: Schema.Array(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      address: SocketAddress,
      state: S.Union([S.Literal("disconnected"), S.Literal("connecting"), S.Literal("connected")]),
    }),
  ),
});

export class OBSEngine extends Engine.make({
  resources: [OBSSocket],
  events: Array.empty<ObsEvent.Any>(),
  storage: RuntimeStorage,
  initialStorage: { sockets: {} },
  rpcs: RuntimeRpcs,
  client: {
    state: ClientState,
    rpcs: ClientRpcs,
  },
}) {}
