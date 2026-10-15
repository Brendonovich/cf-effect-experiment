import * as Engine from "@macrograph/module/Engine";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const GenerateTextRequest = Schema.Struct({
  prompt: Schema.String,
  /** A provider/model reference. An empty string selects OpenCode's default model. */
  model: Schema.String,
});

export class RequestFailure extends Schema.TaggedError<RequestFailure>()("OpenCodeRequestFailure", {
  reason: Schema.String,
}) {}

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
export const ClientState = Schema.Struct({
  mode: Schema.Literals(["server", "cloudflare"]),
  credentials: Schema.Array(CredentialSummary),
  oauthMethods: Schema.Array(OAuthMethodSummary),
});
export const initialClientState: typeof ClientState.Type = {
  mode: "server",
  credentials: [],
  oauthMethods: [],
};
export class ClientRpcs extends RpcGroup.make(
  Rpc.make("OpenCodeConnectKey", {
    payload: Schema.Struct({ integrationID: Schema.String, key: Schema.String }),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeRemoveCredential", {
    payload: Schema.Struct({ credentialID: Schema.String }),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeStartOAuth", {
    payload: Schema.Struct({ integrationID: Schema.String, methodID: Schema.String }),
    success: OAuthAttempt,
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeOAuthStatus", {
    payload: Schema.Struct({ integrationID: Schema.String, attemptID: Schema.String }),
    success: OAuthStatus,
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeCompleteOAuth", {
    payload: Schema.Struct({
      integrationID: Schema.String,
      attemptID: Schema.String,
      code: Schema.String,
    }),
    error: RequestFailure,
  }),
  Rpc.make("OpenCodeCancelOAuth", {
    payload: Schema.Struct({ integrationID: Schema.String, attemptID: Schema.String }),
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
    success: Schema.Array(Schema.String),
    error: RequestFailure,
  }),
) {}

export class OpenCodeEngine extends Engine.make({
  events: Array.empty<never>(),
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
