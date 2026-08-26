import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { ExecutionNotFound, ProjectNotFound } from "./Errors.ts";
import { ProjectEventRecord, ProjectExecutionNodeRecord, ProjectExecutionRecord } from "./Models.ts";

export class ExecutionsApiGroup extends HttpApiGroup.make("executions").add(
  HttpApiEndpoint.get("list", "/api/projects/:projectId/executions", {
    params: { projectId: Schema.String },
    query: { deploymentId: Schema.optional(Schema.String) },
    success: Schema.Struct({
      executions: Schema.Array(ProjectExecutionRecord),
      events: Schema.Array(ProjectEventRecord),
    }),
    error: ProjectNotFound,
  }).middleware(Authentication),
  HttpApiEndpoint.get("get", "/api/projects/:projectId/executions/:executionId", {
    params: { projectId: Schema.String, executionId: Schema.String },
    success: Schema.Struct({
      execution: ProjectExecutionRecord,
      event: ProjectEventRecord,
      nodes: Schema.Array(ProjectExecutionNodeRecord),
    }),
    error: [ProjectNotFound, ExecutionNotFound],
  }).middleware(Authentication),
) {}
