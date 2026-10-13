import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export class EditorRpcApiGroup extends HttpApiGroup.make("editorRpc").add(
  HttpApiEndpoint.get("connect", "/rpc", { success: Schema.Void }),
  HttpApiEndpoint.post("request", "/rpc", { success: Schema.Void }),
) {}
