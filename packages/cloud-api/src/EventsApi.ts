import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { DeploymentNotFound, EventNotFound, ProjectNotFound } from "./Errors.ts";
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
  HttpApiEndpoint.post("replay", "/api/projects/:projectId/events/:eventId/replay", {
    params: { projectId: Schema.String, eventId: Schema.String },
    payload: Schema.Struct({ kind: Schema.Literals(["event", "ingress"]) }),
    success: Schema.Struct({
      projectEventId: Schema.String,
      executionId: Schema.String,
      deploymentId: Schema.String,
    }),
    error: [ProjectNotFound, EventNotFound, DeploymentNotFound],
  }).middleware(Authentication),
) {}
