import * as Engine from "@macrograph/plugin/Engine";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const RequestMethod = Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type RequestMethod = typeof RequestMethod.Type;

export class RequestFailure extends Schema.TaggedError<RequestFailure>()(
  "HttpClientRequestFailure",
  {
    method: RequestMethod,
    url: Schema.String,
    reason: Schema.String,
  },
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("HttpClientRequest", {
    payload: Schema.Struct({ method: RequestMethod, url: Schema.String }),
    success: Schema.Int,
    error: RequestFailure,
  }),
) {}

export const ClientState = Schema.Struct({});
export class ClientRpcs extends RpcGroup.make() {}

export class HttpClientEngine extends Engine.make({
  events: Array.empty<never>(),
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
