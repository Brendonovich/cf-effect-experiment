import {
  CreateGraphRequest,
  CreateProjectRequest,
  CurrentUser,
  ProjectRecord,
} from "@macrograph/cloud-api";
import {
  Connection,
  Graph,
  GraphId,
  Node,
  NodeIO,
  Package,
  PackageId,
  ResourceConstant,
} from "@macrograph/core";
import { Cause, Context, Effect, Layer, Option, Schema, Sink, Stream } from "effect";
import { McpProtocol, McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiError } from "effect/unstable/httpapi";

const projectParameters = {
  projectId: Schema.String.annotate({
    description: "Accessible project ID returned by listProjects.",
  }),
};
const graphParameters = {
  ...projectParameters,
  graphId: Schema.String.annotate({ description: "Graph ID returned by listGraphs or createGraph." }),
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
  Tool.make("listGraphs", {
    description: "List graph IDs and names in an accessible project.",
    parameters: Schema.Struct(projectParameters),
    success: Schema.Struct({
      graphs: Schema.Array(Schema.Struct({ id: GraphId, name: Schema.String })),
    }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentUser)
    .annotate(Tool.Readonly, true),
  Tool.make("getGraph", {
    description:
      "Inspect a graph, including all nodes, connections, and resolved node inputs and outputs.",
    parameters: Schema.Struct(graphParameters),
    success: Schema.Struct({ graph: Graph.Model, nodeIO: Schema.Record(Schema.String, NodeIO) }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentUser)
    .annotate(Tool.Readonly, true),
  Tool.make("createGraph", {
    description:
      "PREFERRED: Create an entire graph in one request, including its name, nodes, and connections. Nodes are keyed by temporary local IDs, and connections reference those IDs. Node schemas use { package, schema }; resource properties use matching resource IDs returned by searchSchemas. Use searchSchemas only if schema IDs, ports, or resources are unknown. Prefer this compound tool over separate createNode/createConnection calls.",
    parameters: Schema.Struct({ ...projectParameters, ...CreateGraphRequest.fields }),
    success: Schema.Struct({ graph: Graph.Model }),
    failure: Schema.Unknown,
  }).addDependency(CurrentUser),
  Tool.make("deleteGraph", {
    description: "Permanently delete a graph and all of its nodes and connections.",
    parameters: Schema.Struct(graphParameters),
    success: Schema.Struct({ deleted: Schema.Boolean }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentUser)
    .annotate(Tool.Destructive, true),
  Tool.make("searchSchemas", {
    description:
      "Find ranked node schemas by package, name, ID, or description. Use queries to find multiple unrelated node types in one request. Results include ports, properties, and matching configured resource IDs for resource-backed properties. Returns at most 20 schemas by default.",
    parameters: Schema.Struct({
      ...projectParameters,
      query: Schema.optionalKey(
        Schema.String.annotate({
          description: "Search phrase; all words must match the same package or schema.",
        }),
      ),
      queries: Schema.optionalKey(
        Schema.Array(Schema.String).annotate({
          description:
            "Alternative search phrases. Schemas matching any phrase are returned, allowing multiple node types to be discovered in one call.",
        }),
      ),
      limit: Schema.optionalKey(
        Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).annotate({
          description: "Maximum number of ranked schemas to return; defaults to 20.",
          default: 20,
        }),
      ),
    }),
    success: Schema.Struct({
      schemas: Schema.Array(
        Schema.Struct({
          package: PackageId,
          schema: Package.SchemaModel,
          resources: Schema.Record(
            Schema.String,
            Schema.Array(Schema.Struct({ id: ResourceConstant.Id, name: Schema.String })),
          ).annotate({
            description:
              "Matching configured resources keyed by resource-backed property ID. Use a resource ID as that node property's value; an empty array means none are configured.",
          }),
        }),
      ),
    }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentUser)
    .annotate(Tool.Readonly, true),
  Tool.make("listResources", {
    description:
      "List configured resource constants and their IDs. Use these IDs for matching resource-typed node properties when creating graphs or nodes.",
    parameters: Schema.Struct(projectParameters),
    success: Schema.Struct({ resources: Schema.Array(ResourceConstant.Model) }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentUser)
    .annotate(Tool.Readonly, true),
  Tool.make("createNode", {
    description:
      "Add one node to an existing graph. Prefer createGraph when building a complete graph.",
    parameters: Schema.Struct({ ...graphParameters, ...Node.CreateInput.fields }),
    success: Schema.Struct({ node: Node.Model, io: NodeIO }),
    failure: Schema.Unknown,
  }).addDependency(CurrentUser),
  Tool.make("createConnection", {
    description:
      "Connect an output pin to an input pin in an existing graph. Prefer createGraph for complete graphs.",
    parameters: Schema.Struct({ ...graphParameters, ...Connection.CreateInput.fields }),
    success: Schema.Struct({ connection: Connection.Model }),
    failure: Schema.Unknown,
  }).addDependency(CurrentUser),
);

export const layer = (handlers: Toolkit.HandlersFrom<typeof toolkit.tools>) => {
  const registration = Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* McpServer.McpServer;
      const built = yield* toolkit;

      for (const tool of Object.values(built.tools)) {
        const outputSchema = Tool.getJsonSchemaFromSchema(tool.successSchema);
        yield* registry.addTool({
          tool: new McpSchema.Tool({
            name: tool.name,
            description: Tool.getDescription(tool),
            inputSchema: Tool.getJsonSchema(tool),
            ...(outputSchema.type === "object" ? { outputSchema } : {}),
            annotations: {
              readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
              destructiveHint: Context.get(tool.annotations, Tool.Destructive),
              idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
              openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
            },
          }),
          annotations: tool.annotations,
          handle: (payload) =>
            Effect.serviceOption(CurrentUser).pipe(
              Effect.flatMap((user) =>
                Option.match(user, {
                  onNone: () => Effect.die("MCP tool request is missing its authenticated user"),
                  onSome: (currentUser) =>
                    built.handle(tool.name, payload).pipe(
                      Stream.unwrap,
                      Stream.run(Sink.last()),
                      Effect.flatMap(Effect.fromOption),
                      Effect.provideService(CurrentUser, currentUser),
                      Effect.map(
                        (result) =>
                          new McpSchema.CallToolResult({
                            isError: false,
                            structuredContent:
                              typeof result.encodedResult === "object"
                                ? result.encodedResult
                                : undefined,
                            content: [{ type: "text", text: JSON.stringify(result.encodedResult) }],
                          }),
                      ),
                    ),
                }),
              ),
              Effect.catchCause((cause) =>
                Effect.succeed(
                  new McpSchema.CallToolResult({
                    isError: true,
                    content: [{ type: "text", text: Cause.pretty(cause) }],
                  }),
                ),
              ),
            ),
        });
      }
    }),
  ).pipe(Layer.provide(toolkit.toLayer(handlers)));

  return registration.pipe(
    Layer.provide(
      McpServer.layerHttp({
        name: "MacroGraph Cloud",
        version: "1.0.0",
        path: "/api/mcp",
        protocols: [McpProtocol.v2025_06_18],
      }).pipe(Layer.orDie),
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
