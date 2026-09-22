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
import { Editor, EditorEvents, Packages, ProjectOperations } from "@macrograph/editor";
import { layer as mcpLayer } from "@macrograph/mcp";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ClientSessions } from "./ClientSessions.ts";

export class CurrentSession extends Context.Service<CurrentSession, ClientSessions.Session>()(
  "macrograph/server/McpCurrentSession",
) {}

const graphParameters = {
  graphId: Schema.String.annotate({
    description: "Graph ID returned by listGraphs or createGraph.",
  }),
};

export const toolkit = Toolkit.make(
  Tool.make("listGraphs", {
    description: "List graph IDs and names in this server's project.",
    success: Schema.Struct({
      graphs: Schema.Array(Schema.Struct({ id: GraphId, name: Schema.String })),
    }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentSession)
    .annotate(Tool.Readonly, true),
  Tool.make("getGraph", {
    description:
      "Inspect a graph, including all nodes, connections, and resolved node inputs and outputs.",
    parameters: Schema.Struct(graphParameters),
    success: Schema.Struct({ graph: Graph.Model, nodeIO: Schema.Record(Schema.String, NodeIO) }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentSession)
    .annotate(Tool.Readonly, true),
  Tool.make("createGraph", {
    description:
      "PREFERRED: Create an entire graph in one request, including its name, nodes, and connections. Nodes are keyed by temporary local IDs, and connections reference those IDs. Node schemas use { package, schema }; resource properties use matching resource IDs returned by searchSchemas. Use searchSchemas only if schema IDs, ports, or resources are unknown. Prefer this compound tool over separate createNode/createConnection calls.",
    parameters: Graph.CreateRequest,
    success: Schema.Struct({ graph: Graph.Model }),
    failure: Schema.Unknown,
  }).addDependency(CurrentSession),
  Tool.make("deleteGraph", {
    description: "Permanently delete a graph and all of its nodes and connections.",
    parameters: Schema.Struct(graphParameters),
    success: Schema.Struct({ deleted: Schema.Boolean }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentSession)
    .annotate(Tool.Destructive, true),
  Tool.make("searchSchemas", {
    description:
      "Find ranked node schemas by package, name, ID, or description. Use queries to find multiple unrelated node types in one call. Results include ports, properties, and matching configured resource IDs for resource-backed properties. Returns at most 20 schemas by default.",
    parameters: Schema.Struct({
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
          ),
        }),
      ),
    }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentSession)
    .annotate(Tool.Readonly, true),
  Tool.make("listResources", {
    description:
      "List configured resource constants and their IDs. Use these IDs for matching resource-typed node properties when creating graphs or nodes.",
    success: Schema.Struct({ resources: Schema.Array(ResourceConstant.Model) }),
    failure: Schema.Unknown,
  })
    .addDependency(CurrentSession)
    .annotate(Tool.Readonly, true),
  Tool.make("createNode", {
    description:
      "Add one node to an existing graph. Prefer createGraph when building a complete graph.",
    parameters: Schema.Struct({ ...graphParameters, ...Node.CreateInput.fields }),
    success: Schema.Struct({ node: Node.Model, io: NodeIO }),
    failure: Schema.Unknown,
  }).addDependency(CurrentSession),
  Tool.make("createConnection", {
    description:
      "Connect an output pin to an input pin in an existing graph. Prefer createGraph for complete graphs.",
    parameters: Schema.Struct({ ...graphParameters, ...Connection.CreateInput.fields }),
    success: Schema.Struct({ connection: Connection.Model }),
    failure: Schema.Unknown,
  }).addDependency(CurrentSession),
);

export const layer = (basePath: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const editorEvents = yield* EditorEvents.Service;
      const packages = yield* Packages.Service;
      const withActor = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        CurrentSession.pipe(
          Effect.flatMap((session) =>
            editorEvents.withActor(effect, { type: "CLIENT", id: `mcp-${session.userId}` }),
          ),
        );
      const handlers = toolkit.of({
        listGraphs: () =>
          editor.project.get().pipe(
            Effect.map((project) => ({
              graphs: Object.values(project.graphs).map((graph) => ({
                id: graph.id,
                name: graph.name,
              })),
            })),
          ),
        getGraph: ({ graphId }) => ProjectOperations.getGraph(editor, graphId),
        createGraph: (input) =>
          withActor(ProjectOperations.createGraph(editor, input)).pipe(
            Effect.map((graph) => ({ graph })),
          ),
        deleteGraph: ({ graphId }) =>
          withActor(editor.graph.delete({ graphID: graphId, force: true })).pipe(
            Effect.as({ deleted: true }),
          ),
        searchSchemas: (options) =>
          Effect.gen(function* () {
            const [loadedPackages, project] = yield* Effect.all([
              packages.getPackages(),
              editor.project.get(),
            ]);
            return {
              schemas: ProjectOperations.searchSchemas(
                loadedPackages,
                Object.values(project.constants),
                options,
              ),
            };
          }),
        listResources: () =>
          editor.project
            .get()
            .pipe(Effect.map((project) => ({ resources: Object.values(project.constants) }))),
        createNode: ({ graphId, ...node }) =>
          withActor(editor.node.create({ graphID: graphId, node })).pipe(
            Effect.map((event) => ({ node: event.node, io: event.io })),
          ),
        createConnection: ({ graphId, ...connection }) =>
          withActor(editor.connection.create({ graphID: graphId, connection })).pipe(
            Effect.map((event) => ({ connection: event.connection })),
          ),
      });

      return mcpLayer(
        toolkit,
        handlers,
        { name: "MacroGraph Server", version: "1.0.0", path: `${basePath}/mcp` },
        (effect) =>
          Effect.serviceOption(CurrentSession).pipe(
            Effect.flatMap((session) =>
              Option.match(session, {
                onNone: () => Effect.die("MCP tool request is missing its authenticated session"),
                onSome: (current) => Effect.provideService(effect, CurrentSession, current),
              }),
            ),
          ),
      );
    }),
  );

export const authenticated = <E, R>(
  app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  authenticate: Effect.Effect<
    | { readonly status: "authorized"; readonly session: ClientSessions.Session }
    | { readonly status: "unauthorized" | "forbidden" },
    never,
    HttpServerRequest.HttpServerRequest
  >,
) =>
  authenticate.pipe(
    Effect.flatMap((result) =>
      result.status === "authorized"
        ? Effect.provideService(app, CurrentSession, result.session)
        : Effect.succeed(
            HttpServerResponse.empty({ status: result.status === "unauthorized" ? 401 : 403 }),
          ),
    ),
  );

export * as ServerMcp from "./ServerMcp.ts";
