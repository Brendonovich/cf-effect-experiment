import * as Engine from "@macrograph/module/Engine";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const GenerateTextRequest = Schema.Struct({
  prompt: Schema.String,
  /** A provider/model reference. An empty string selects OpenCode's default model. */
  model: Schema.String,
});

export class RequestFailure extends Schema.TaggedError<RequestFailure>()("OpenCodeRequestFailure", {
  reason: Schema.String,
}) {}

export const ClientState = Schema.Struct({});
export class ClientRpcs extends RpcGroup.make() {}

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
