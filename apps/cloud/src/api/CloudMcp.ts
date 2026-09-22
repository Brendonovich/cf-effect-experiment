import { CreateProjectRequest, CurrentUser, ProjectRecord } from "@macrograph/cloud-api";
import { layer as mcpLayer, ProjectToolkit } from "@macrograph/mcp";
import { Effect, Option, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiError } from "effect/unstable/httpapi";

const projectParameters = {
  projectId: Schema.String.annotate({
    description: "Accessible project ID returned by listProjects.",
  }),
};
export const toolkit = Toolkit.make(
  Tool.make("listProjects", {
    description: "List all projects accessible to the authenticated user.",
    success: Schema.Struct({ projects: Schema.Array(ProjectRecord) }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentUser)
    .annotate(Tool.Readonly, true),
  Tool.make("getProject", {
    description: "Get an accessible project's metadata by project ID.",
    parameters: Schema.Struct(projectParameters),
    success: Schema.Struct({ project: ProjectRecord }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentUser)
    .annotate(Tool.Readonly, true),
  Tool.make("createProject", {
    description: "Create a project in the authenticated user's personal team or a specified team.",
    parameters: CreateProjectRequest,
    success: Schema.Struct({ project: ProjectRecord }),
    failure: Schema.Unknown,
  }).addDependency(CurrentUser),
  ...ProjectToolkit.make(projectParameters, CurrentUser),
);

export const layer = (handlers: Toolkit.HandlersFrom<typeof toolkit.tools>) => {
  return mcpLayer(
    toolkit,
    handlers,
    { name: "MacroGraph Cloud", version: "1.0.0", path: "/api/mcp" },
    (effect) =>
      Effect.serviceOption(CurrentUser).pipe(
        Effect.flatMap((user) =>
          Option.match(user, {
            onNone: () => Effect.die("MCP tool request is missing its authenticated user"),
            onSome: (currentUser) => Effect.provideService(effect, CurrentUser, currentUser),
          }),
        ),
      ),
  );
};

export const authenticated = <A, E, R>(
  app: Effect.Effect<A, E, R>,
  authenticate: Effect.Effect<
    CurrentUser["Service"],
    HttpApiError.Unauthorized,
    HttpServerRequest.HttpServerRequest
  >,
) =>
  authenticate.pipe(
    Effect.flatMap((user) => app.pipe(Effect.provideService(CurrentUser, user))),
    Effect.catchTag("Unauthorized", () =>
      Effect.succeed(HttpServerResponse.empty({ status: 401 })),
    ),
  );
