import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { ProjectNotFound } from "./Errors.ts";
import { ProjectIngressEventRecord } from "./Models.ts";

export class IngressEventsApiGroup extends HttpApiGroup.make("ingressEvents").add(
  HttpApiEndpoint.get("list", "/api/projects/:projectId/ingress-events", {
    params: { projectId: Schema.String },
    success: Schema.Struct({ events: Schema.Array(ProjectIngressEventRecord) }),
    error: ProjectNotFound,
  }).middleware(Authentication),
) {}
