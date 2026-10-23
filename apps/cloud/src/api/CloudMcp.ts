import {
  CreateProjectRequest,
  CurrentUser,
  ProjectEventRecord,
  ProjectExecutionNodeRecord,
  ProjectExecutionRecord,
  ProjectRecord,
} from "@macrograph/cloud-api";
import { ApiCaller, ProjectMcp } from "@macrograph/project-api";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiError } from "effect/http-api";

import * as McpOAuthConfig from "../auth/McpOAuthConfig.ts";
import { traceDatasetName } from "../Observability.ts";

const createProject = Tool.make("createProject", {
  description: "Create a project in the authenticated user's personal team or a specified team.",
  parameters: CreateProjectRequest,
  success: Schema.Struct({ project: ProjectRecord }),
  failure: Schema.Unknown,
}).addDependency(CurrentUser);

const ExecutionStatus = ProjectExecutionRecord.fields.status;

const ExecutionSummary = Schema.Struct({
  ...ProjectExecutionRecord.fields,
  eventType: Schema.NullOr(Schema.String),
  traceId: Schema.NullOr(Schema.String),
});

const ExecutionTrace = Schema.Struct({
  traceId: Schema.String,
  dataset: Schema.String,
  query: Schema.String,
}).annotate({
  description:
    "OpenTelemetry trace for the execution. Every span carries attribute macrograph.execution.id; query the dataset by trace_id to see node spans, errors, and exception events.",
});

const listExecutions = Tool.make("listExecutions", {
  description:
    "List a project's recent graph executions, newest first, with status, error, event type, and OpenTelemetry trace ID. Use getExecution for node-level results.",
  parameters: Schema.Struct({
    ...ProjectMcp.projectParameters,
    deploymentId: Schema.optionalKey(Schema.String),
    status: Schema.optionalKey(ExecutionStatus),
    limit: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })).annotate({
        description: "Maximum number of executions to return; defaults to 20.",
        default: 20,
      }),
    ),
  }),
  success: Schema.Struct({ executions: Schema.Array(ExecutionSummary) }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

const getExecution = Tool.make("getExecution", {
  description:
    "Inspect one graph execution by ID (as shown in the executions UI, e.g. '<projectId>-utilities-tick-190'): status, error, triggering event payload, per-node results and errors, and the OpenTelemetry trace to query for spans.",
  parameters: Schema.Struct({
    ...ProjectMcp.projectParameters,
    executionId: Schema.String.annotate({
      description: "Execution ID returned by listExecutions or shown in the executions UI.",
    }),
  }),
  success: Schema.Struct({
    execution: ProjectExecutionRecord,
    event: ProjectEventRecord,
    nodes: Schema.Array(ProjectExecutionNodeRecord),
    trace: Schema.NullOr(ExecutionTrace),
  }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const executionTrace = (traceId: string | null): typeof ExecutionTrace.Type | null =>
  traceId === null
    ? null
    : {
        traceId,
        dataset: traceDatasetName,
        query: `['${traceDatasetName}'] | where trace_id == "${traceId}" | order by _time asc`,
      };

export const toolkit = Toolkit.make(
  ProjectMcp.listProjects,
  ProjectMcp.getProject,
  createProject,
  listExecutions,
  getExecution,
  ...ProjectMcp.editorTools,
);

export const layer = (handlers: Toolkit.HandlersFrom<typeof toolkit.tools>) =>
  ProjectMcp.layer({ name: "MacroGraph Cloud", path: "/api/mcp", toolkit, handlers });

export const authenticated = <A, E, R>(
  app: Effect.Effect<A, E, R>,
  authenticate: Effect.Effect<
    ProjectMcp.Principal,
    HttpApiError.Unauthorized,
    HttpServerRequest.HttpServerRequest
  >,
) =>
  authenticate.pipe(
    Effect.flatMap(({ user, caller }) =>
      app.pipe(
        Effect.provideService(CurrentUser, user),
        Effect.provideService(ApiCaller.Current, caller),
      ),
    ),
    Effect.catchTag("Unauthorized", () =>
      Effect.succeed(
        HttpServerResponse.empty({
          status: 401,
          headers: {
            "www-authenticate": `Bearer realm="mcp", resource_metadata="${McpOAuthConfig.protectedResourceMetadataUrl()}", scope="${McpOAuthConfig.scope}"`,
          },
        }),
      ),
    ),
  );
