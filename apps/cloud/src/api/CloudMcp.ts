import { CreateProjectRequest, CurrentUser, ProjectRecord } from "@macrograph/cloud-api";
import { ApiCaller, ProjectMcp } from "@macrograph/project-api";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiError } from "effect/unstable/httpapi";

import * as McpOAuthConfig from "../auth/McpOAuthConfig.ts";

const createProject = Tool.make("createProject", {
  description: "Create a project in the authenticated user's personal team or a specified team.",
  parameters: CreateProjectRequest,
  success: Schema.Struct({ project: ProjectRecord }),
  failure: Schema.Unknown,
}).addDependency(CurrentUser);

export const toolkit = Toolkit.make(
  ProjectMcp.listProjects,
  ProjectMcp.getProject,
  createProject,
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
