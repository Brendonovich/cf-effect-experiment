import * as Engine from "@macrograph/module/Engine";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const GenerateTextRequest = Schema.Struct({
  prompt: Schema.String,
  /** A provider/model reference. An empty string selects OpenCode's default model. */
  model: Schema.String,
});

export const TargetType = Schema.Literals(["remote", "managed"]);
export type TargetType = typeof TargetType.Type;
export const Target = Schema.Union([
  Schema.Struct({ type: Schema.Literal("default") }),
  Schema.Struct({
    type: Schema.Literal("remote"),
    url: Schema.String,
    password: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("managed"),
    config: Schema.String,
  }),
]);
export type Target = typeof Target.Type;
export const TargetSummary = Schema.Union([
  Schema.Struct({ type: Schema.Literal("default") }),
  Schema.Struct({ type: Schema.Literal("remote"), url: Schema.String }),
  Schema.Struct({ type: Schema.Literal("managed") }),
]);

export const RuntimeStorage = Schema.Struct({ target: Target });
export const initialStorage: typeof RuntimeStorage.Type = { target: { type: "default" } };

export class RequestFailure extends Schema.TaggedError<RequestFailure>()("OpenCodeRequestFailure", {
  reason: Schema.String,
}) {}

export const ClientState = Schema.Struct({
  target: TargetSummary,
  defaultTarget: TargetType,
  availableTargets: Schema.Array(TargetType),
});
export const initialClientState: typeof ClientState.Type = {
  target: { type: "default" },
  defaultTarget: "remote",
  availableTargets: ["remote"],
};
export class ClientRpcs extends RpcGroup.make(
  Rpc.make("OpenCodeSetTarget", { payload: Target, error: RequestFailure }),
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
  storage: RuntimeStorage,
  initialStorage,
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
