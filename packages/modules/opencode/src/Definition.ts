import * as Engine from "@macrograph/module/Engine";
import * as Resource from "@macrograph/module/Resource";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const ConnectionId = Schema.String.pipe(Schema.brand("OpenCodeConnectionId"));
export type ConnectionId = typeof ConnectionId.Type;

/** A named OpenCode instance that nodes and resource constants bind to explicitly. */
export class OpenCodeConnection extends Resource.make<OpenCodeConnection, ConnectionId>()(
  "OpenCodeConnection",
  { name: "OpenCode Connection" },
) {}

export const ConnectionType = Schema.Literals(["managed", "remote", "local"]);
export type ConnectionType = typeof ConnectionType.Type;

export const ConnectionTarget = Schema.Union([
  /** OpenCode embedded in a platform-provisioned instance with the given config JSON. */
  Schema.Struct({ type: Schema.Literal("managed"), config: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("remote"),
    url: Schema.String,
    password: Schema.String,
  }),
  /** The OpenCode service discovered on the host running MacroGraph. */
  Schema.Struct({ type: Schema.Literal("local") }),
]);
export type ConnectionTarget = typeof ConnectionTarget.Type;

/** Connection edits omit the remote password to keep the stored one. */
export const ConnectionTargetInput = Schema.Union([
  Schema.Struct({ type: Schema.Literal("managed"), config: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("remote"),
    url: Schema.String,
    password: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("local") }),
]);
export type ConnectionTargetInput = typeof ConnectionTargetInput.Type;

export const Connection = Schema.Struct({ name: Schema.String, target: ConnectionTarget });
export type Connection = typeof Connection.Type;

export const RuntimeStorage = Schema.Struct({
  connections: Schema.Record(ConnectionId, Connection),
});
export const initialStorage: typeof RuntimeStorage.Type = { connections: {} };

export const GenerateTextRequest = Schema.Struct({
  connectionId: ConnectionId,
  prompt: Schema.String,
  /** A provider/model reference. An empty string selects OpenCode's default model. */
  model: Schema.String,
});

export const CredentialSummary = Schema.Struct({
  id: Schema.String,
  integrationID: Schema.String,
  label: Schema.String,
  active: Schema.Boolean,
});
export const OAuthMethodSummary = Schema.Struct({
  integrationID: Schema.String,
  integrationName: Schema.String,
  methodID: Schema.String,
  label: Schema.String,
});
export const OAuthAttempt = Schema.Struct({
  integrationID: Schema.String,
  attemptID: Schema.String,
  url: Schema.String,
  instructions: Schema.String,
  mode: Schema.Literals(["auto", "code"]),
  expires: Schema.Number,
});
export const OAuthStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("complete") }),
  Schema.Struct({ status: Schema.Literal("failed"), message: Schema.String }),
  Schema.Struct({ status: Schema.Literal("expired") }),
]);

export class RequestFailure extends Schema.TaggedError<RequestFailure>()("OpenCodeRequestFailure", {
  reason: Schema.String,
}) {
  override get message() {
    return this.reason;
  }
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined;
const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
const json = (value: unknown) => {
  try {
    return text(JSON.stringify(value)?.slice(0, 500));
  } catch {
    return undefined;
  }
};

/**
 * Describes an OpenCode client or host failure for error messages and traces. Declared API errors
 * arrive as Errors carrying the response body (`_tag`, `data`) and often an empty message, so the
 * tag and payload are kept instead of collapsing to a generic reason.
 */
export const describeFailure = (cause: unknown): string => {
  if (cause instanceof RequestFailure) return cause.reason;
  const tag =
    text(field(cause, "_tag")) ??
    (cause instanceof Error && cause.name !== "Error" ? cause.name : undefined);
  const data = field(cause, "data");
  const message =
    text(field(cause, "message")) ??
    text(field(data, "message")) ??
    text(cause) ??
    (data === undefined ? undefined : json(data));
  const parts = [
    message !== undefined && tag !== undefined && message.startsWith(tag) ? undefined : tag,
    message,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? "OpenCode request failed" : parts.join(": ");
};

export const ConnectionTargetSummary = Schema.Union([
  Schema.Struct({ type: Schema.Literal("managed"), config: Schema.String }),
  Schema.Struct({ type: Schema.Literal("remote"), url: Schema.String }),
  Schema.Struct({ type: Schema.Literal("local") }),
]);

export const ConnectionStatus = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("ready"),
    /** The config the instance is currently running, when it differs from the saved one. */
    appliedConfig: Schema.optional(Schema.String),
  }),
  Schema.Struct({ state: Schema.Literal("error"), message: Schema.String }),
]);

export const ConnectionState = Schema.Struct({
  id: ConnectionId,
  name: Schema.String,
  target: ConnectionTargetSummary,
  status: ConnectionStatus,
  credentials: Schema.Array(CredentialSummary),
  oauthMethods: Schema.Array(OAuthMethodSummary),
});
export type ConnectionState = typeof ConnectionState.Type;

export const ClientState = Schema.Struct({
  connectionTypes: Schema.Array(ConnectionType),
  connections: Schema.Array(ConnectionState),
});
export const initialClientState: typeof ClientState.Type = {
  connectionTypes: [],
  connections: [],
};

const ConnectionScoped = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct({ connectionId: ConnectionId, ...fields });

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("OpenCodeCreateConnection", {
    payload: Schema.Struct({ name: Schema.String, target: ConnectionTarget }),
    success: ConnectionId,
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeUpdateConnection", {
    payload: ConnectionScoped({ name: Schema.String, target: ConnectionTargetInput }),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeRemoveConnection", {
    payload: ConnectionScoped({}),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeConnectKey", {
    payload: ConnectionScoped({ integrationID: Schema.String, key: Schema.String }),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeRemoveCredential", {
    payload: ConnectionScoped({ credentialID: Schema.String }),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeStartOAuth", {
    payload: ConnectionScoped({ integrationID: Schema.String, methodID: Schema.String }),
    success: OAuthAttempt,
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeOAuthStatus", {
    payload: ConnectionScoped({ integrationID: Schema.String, attemptID: Schema.String }),
    success: OAuthStatus,
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeCompleteOAuth", {
    payload: ConnectionScoped({
      integrationID: Schema.String,
      attemptID: Schema.String,
      code: Schema.String,
    }),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeCancelOAuth", {
    payload: ConnectionScoped({ integrationID: Schema.String, attemptID: Schema.String }),
    error: RequestFailure,
  }),
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("OpenCodeGenerateText", {
    payload: GenerateTextRequest,
    success: Schema.String,
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeListModels", {
    payload: ConnectionScoped({}),
    success: Schema.Array(Schema.String),
    error: RequestFailure,
  }),
) {}

export class OpenCodeEngine extends Engine.make({
  resources: [OpenCodeConnection],
  events: Array.empty<never>(),
  storage: RuntimeStorage,
  initialStorage,
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
