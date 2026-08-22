import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { ProjectNotFound } from "./Errors.ts";
import { RuntimeEndpoint } from "./Models.ts";

export class PreviewsApiGroup extends HttpApiGroup.make("previews").add(
  HttpApiEndpoint.post("start", "/api/projects/:projectId/preview", {
    params: { projectId: Schema.String },
    payload: Schema.Struct({ previewId: Schema.String }),
    success: Schema.Struct({ endpoints: Schema.Array(RuntimeEndpoint) }),
    error: ProjectNotFound,
  }).middleware(Authentication),
  HttpApiEndpoint.post("stop", "/api/projects/:projectId/preview/stop", {
    params: { projectId: Schema.String },
    payload: Schema.Struct({ previewId: Schema.String }),
    success: Schema.Void,
    error: ProjectNotFound,
  }).middleware(Authentication),
) {}
