import { HttpEndpoint } from "@macrograph/plugin";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

export class IngressApiGroup extends HttpApiGroup.make("ingress").add(
  HttpApiEndpoint.post("handle", "/ingress/:projectId/:endpointId", {
    params: {
      projectId: Schema.String,
      endpointId: HttpEndpoint.Id,
    },
    success: Schema.Void,
  }),
) {}

export class IngressApi extends HttpApi.make("IngressApi").add(IngressApiGroup) {}
