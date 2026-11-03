import {
  CreateGraphRequest,
  CreateGraphResponse,
  CurrentUser,
  ProjectRecord,
} from "@macrograph/cloud-api";
import {
  Canvas,
  Connection,
  GraphId,
  Node,
  NodeIO,
  Package,
  PackageId,
  ResourceConstant,
} from "@macrograph/core";
import { Cause, Context, Effect, Layer, Schema, Sink, Stream } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { type HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiError } from "effect/http-api";

import { ApiCaller } from "./ApiCaller.ts";
import { McpServer } from "./McpServer.ts";

export const projectParameters = {
  projectId: Schema.String.annotate({
    description: "Accessible project ID returned by listProjects.",
  }),
};
const graphParameters = {
  ...projectParameters,
  graphId: Schema.String.annotate({
    description: "Graph ID returned by listGraphs or createGraph.",
  }),
};

export const listProjects = Tool.make("listProjects", {
  description: "List all projects accessible to the authenticated user.",
  success: Schema.Struct({ projects: Schema.Array(ProjectRecord) }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const getProject = Tool.make("getProject", {
  description: "Get an accessible project's metadata by project ID.",
  parameters: Schema.Struct(projectParameters),
  success: Schema.Struct({ project: ProjectRecord }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const listGraphs = Tool.make("listGraphs", {
  description: "List graph IDs and names in an accessible project.",
  parameters: Schema.Struct(projectParameters),
  success: Schema.Struct({
    graphs: Schema.Array(Schema.Struct({ id: GraphId, name: Schema.String })),
  }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const getGraph = Tool.make("getGraph", {
  description:
    "Inspect a graph, including all nodes, connections, and resolved node inputs and outputs.",
  parameters: Schema.Struct(graphParameters),
  success: Schema.Struct({ graph: Canvas.Model, nodeIO: Schema.Record(Schema.String, NodeIO) }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const createGraph = Tool.make("createGraph", {
  description:
    "PREFERRED: Create an entire graph in one request, including its name, nodes, and connections. Nodes are keyed by temporary local IDs, and connections reference those IDs. The response maps each temporary ID to its created node ID in nodeIds, and includes each created node's inputs and outputs in nodeIO. Ports that depend on node properties, such as Format String placeholders, are listed there and can be connected with createConnection in the same script. Node schemas use { package, schema }; resource properties use matching resource IDs returned by searchSchemas. Use searchSchemas only if schema IDs, ports, or resources are unknown. Prefer this compound tool over separate createNode/createConnection calls.",
  parameters: Schema.Struct({ ...projectParameters, ...CreateGraphRequest.fields }),
  success: CreateGraphResponse,
  failure: Schema.Unknown,
}).addDependency(CurrentUser);

export const deleteGraph = Tool.make("deleteGraph", {
  description: "Permanently delete a graph and all of its nodes and connections.",
  parameters: Schema.Struct(graphParameters),
  success: Schema.Struct({ deleted: Schema.Boolean }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Destructive, true);

export const searchSchemas = Tool.make("searchSchemas", {
  description:
    "Find ranked node schemas by package, name, ID, or description. Use queries to find multiple unrelated node types in one request. Results include ports, properties, and matching configured resource IDs for resource-backed properties. Returns at most 20 schemas by default and up to 100 with limit.",
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
        description: "Maximum number of ranked schemas to return, from 1 to 100; defaults to 20.",
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
  .annotate(Tool.Readonly, true);

export const listResources = Tool.make("listResources", {
  description:
    "List configured resource constants and their IDs. Use these IDs for matching resource-typed node properties when creating graphs or nodes.",
  parameters: Schema.Struct(projectParameters),
  success: Schema.Struct({ resources: Schema.Array(ResourceConstant.Model) }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const createNode = Tool.make("createNode", {
  description:
    "Add one node to an existing graph and return its inputs and outputs, including ports that depend on its properties. Prefer createGraph when building a complete graph.",
  parameters: Schema.Struct({ ...graphParameters, ...Node.CreateInput.fields }),
  success: Schema.Struct({ node: Node.Model, io: NodeIO }),
  failure: Schema.Unknown,
}).addDependency(CurrentUser);

export const createConnection = Tool.make("createConnection", {
  description:
    "Connect an output pin to an input pin in an existing graph. Prefer createGraph for complete graphs.",
  parameters: Schema.Struct({ ...graphParameters, ...Connection.CreateInput.fields }),
  success: Schema.Struct({ connection: Connection.Model }),
  failure: Schema.Unknown,
}).addDependency(CurrentUser);

/** Tools for reading and editing graphs, served by every MacroGraph host. */
export const editorTools = [
  listGraphs,
  getGraph,
  createGraph,
  deleteGraph,
  searchSchemas,
  listResources,
  createNode,
  createConnection,
] as const;

/** The tool set of hosts with a fixed set of projects, such as self-hosted servers. */
export const toolkit = Toolkit.make(listProjects, getProject, ...editorTools);

/**
 * Serves a toolkit over MCP (see `McpServer`). Tool calls run as the authenticated user and as an
 * `mcp` caller identified by the MCP session, falling back to the API key.
 */
export const layer = <Tools extends Record<string, Tool.Any>>(options: {
  readonly name: string;
  readonly path: `/${string}`;
  readonly toolkit: Toolkit.Toolkit<Tools>;
  readonly handlers: Toolkit.HandlersFrom<Tools>;
}) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const built = yield* options.toolkit;
      const tools = Object.values(built.tools).map((tool): McpServer.ToolDescriptor => {
        const outputSchema = Tool.getJsonSchemaFromSchema(tool.successSchema);
        return {
          name: tool.name,
          description: Tool.getDescription(tool) ?? "",
          inputSchema: Tool.getJsonSchema(tool),
          ...(outputSchema.type === "object" ? { outputSchema } : {}),
          annotations: {
            readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
            destructiveHint: Context.get(tool.annotations, Tool.Destructive),
            idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
            openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
          },
        };
      });
      return McpServer.layer({
        name: options.name,
        path: options.path,
        listTools: Effect.succeed(tools),
        callTool: (name, args) =>
          Object.hasOwn(built.tools, name)
            ? built.handle(name as keyof Tools, args as never).pipe(
                Stream.unwrap,
                Stream.run(Sink.last()),
                Effect.flatMap(Effect.fromOption),
                Effect.map((result) => McpServer.jsonResult(result.encodedResult)),
                Effect.catchCause((cause) =>
                  Effect.succeed(McpServer.textResult(Cause.pretty(cause), true)),
                ),
              )
            : Effect.succeed(new McpServer.UnknownTool()),
      });
    }),
  ).pipe(Layer.provide(options.toolkit.toLayer(options.handlers)));

/** An API-key-authenticated user and the key they used. */
export interface Principal {
  readonly user: CurrentUser["Service"];
  readonly caller: ApiCaller.Caller;
}

/** Runs an MCP app as the request's authenticated principal, answering 401 when it has none. */
export const authenticated = <A, E, R>(
  app: Effect.Effect<A, E, R>,
  authenticate: Effect.Effect<
    Principal,
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
      Effect.succeed(HttpServerResponse.empty({ status: 401 })),
    ),
  );

export * as ProjectMcp from "./ProjectMcp.ts";
