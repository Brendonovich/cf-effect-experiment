import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

export class EditorRpcApiGroup extends HttpApiGroup.make("editorRpc").add(
  HttpApiEndpoint.get("connect", "/rpc", { success: Schema.Void }),
  HttpApiEndpoint.post("request", "/rpc", { success: Schema.Void }),
) {}
