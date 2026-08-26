import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { ProjectNotFound } from "./Errors.ts";
import {
  ProjectEventRecord,
  ProjectExecutionRecord,
  ProjectIngressEndpoint,
  ProjectIngressEventRecord,
} from "./Models.ts";

export class EventsApiGroup extends HttpApiGroup.make("events").add(
  HttpApiEndpoint.get("list", "/api/projects/:projectId/events", {
    params: { projectId: Schema.String },
    success: Schema.Struct({
      ingresses: Schema.Array(ProjectIngressEndpoint),
      ingressEvents: Schema.Array(ProjectIngressEventRecord),
      events: Schema.Array(ProjectEventRecord),
      executions: Schema.Array(ProjectExecutionRecord),
    }),
    error: ProjectNotFound,
  }).middleware(Authentication),
) {}
