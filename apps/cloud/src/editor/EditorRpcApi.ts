import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export class EditorRpcApiGroup extends HttpApiGroup.make("editorRpc").add(
  HttpApiEndpoint.get("connect", "/rpc", { success: Schema.Void }),
  HttpApiEndpoint.post("request", "/rpc", { success: Schema.Void }),
  // Each module's RPCs, forwarded into the project's editor as NDJSON over HTTP.
  HttpApiEndpoint.post(
    "moduleRpc",
    "/rpc/projects/:projectId/module/:namespace/:publisher/:name/rpc",
    {
      params: {
        projectId: Schema.String,
        namespace: Schema.String,
        publisher: Schema.String,
        name: Schema.String,
      },
      success: Schema.Void,
    },
  ),
) {}
