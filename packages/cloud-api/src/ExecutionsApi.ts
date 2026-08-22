import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { ExecutionNotFound, ProjectNotFound } from "./Errors.ts";
import { ProjectExecutionNodeRecord, ProjectExecutionRecord } from "./Models.ts";

export class ExecutionsApiGroup extends HttpApiGroup.make("executions").add(
  HttpApiEndpoint.get("list", "/api/projects/:projectId/executions", {
    params: { projectId: Schema.String },
    query: { revisionId: Schema.optional(Schema.String) },
    success: Schema.Struct({ executions: Schema.Array(ProjectExecutionRecord) }),
    error: ProjectNotFound,
  }).middleware(Authentication),
  HttpApiEndpoint.get("get", "/api/projects/:projectId/executions/:executionId", {
    params: { projectId: Schema.String, executionId: Schema.String },
    success: Schema.Struct({
      execution: ProjectExecutionRecord,
      nodes: Schema.Array(ProjectExecutionNodeRecord),
    }),
    error: [ProjectNotFound, ExecutionNotFound],
  }).middleware(Authentication),
) {}
