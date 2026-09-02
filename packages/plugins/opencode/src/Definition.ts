import { Engine, Resource } from "@macrograph/plugin";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export class RequestFailure extends Schema.TaggedError<RequestFailure>()("OpenCodeRequestFailure", {
  reason: Schema.String,
}) {}

export class OpenCodeConnection extends Resource.make<OpenCodeConnection, string>()(
  "OpenCodeConnection",
  {
    name: "OpenCode Server",
  },
) {}

export class OpenCodeModel extends Resource.make<OpenCodeModel, string>()("OpenCodeModel", {
  name: "OpenCode Model",
}) {}

export const ConnectionConfig = Schema.Struct({
  address: Schema.String,
  name: Schema.String,
  password: Schema.String,
});
export const RuntimeStorage = Schema.Struct({
  connections: Schema.Record(Schema.String, ConnectionConfig),
});
export const Catalog = Schema.Struct({
  providers: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  models: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, providerID: Schema.String }),
  ),
  defaultModel: Schema.NullOr(Schema.String),
});
export const ClientState = Schema.Struct({
  connections: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      address: Schema.String,
      name: Schema.String,
      discovered: Schema.Boolean,
      state: Schema.Literals(["connecting", "connected", "error"]),
      error: Schema.optional(Schema.String),
      catalog: Catalog,
    }),
  ),
});

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("OpenCodeSaveConnection", {
    payload: Schema.Struct({
      id: Schema.optional(Schema.String),
      address: Schema.String,
      name: Schema.String,
      // Omission preserves the password when editing; an empty string clears it.
      password: Schema.optional(Schema.String),
    }),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeRemoveConnection", {
    payload: Schema.Struct({ id: Schema.String }),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeRefresh", { error: RequestFailure }),
) {}

const connection = { connection: Schema.String };
export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("OpenCodeCatalog", {
    payload: Schema.Struct({
      ...connection,
      directory: Schema.String,
      sessionID: Schema.optional(Schema.String),
    }),
    success: Catalog,
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeSessions", {
    payload: Schema.Struct(connection),
    success: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeCreateSession", {
    payload: Schema.Struct({
      ...connection,
      directory: Schema.String,
      title: Schema.String,
      model: Schema.String,
    }),
    success: Schema.String,
    error: RequestFailure,
  }),
  Rpc.make("OpenCodePromptSession", {
    payload: Schema.Struct({
      ...connection,
      sessionID: Schema.String,
      text: Schema.String,
      model: Schema.String,
    }),
    success: Schema.String,
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeWaitForSession", {
    payload: Schema.Struct({ ...connection, sessionID: Schema.String }),
    error: RequestFailure,
  }),
) {}

export class OpenCodeEngine extends Engine.make({
  resources: [OpenCodeConnection, OpenCodeModel],
  storage: RuntimeStorage,
  initialStorage: { connections: {} },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
