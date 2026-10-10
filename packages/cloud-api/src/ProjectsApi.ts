import {
  Canvas,
  Connection,
  GraphId,
  Node,
  NodeId,
  NodeIO,
  Package,
  PackageId,
  ResourceConstant,
} from "@macrograph/core";
import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { ProjectNotFound, TeamNotFound } from "./Errors.ts";
import { ProjectRecord } from "./Models.ts";

export const CreateProjectRequest = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  teamId: Schema.optional(Schema.String),
  access: Schema.optional(Schema.Literals(["team", "restricted"])),
  userIds: Schema.optional(Schema.Array(Schema.String)),
});

export const CreateGraphRequest = Schema.Struct({
  name: Schema.optional(Schema.String.annotate({ description: "Display name for the new graph." })),
  nodes: Schema.optional(
    Schema.Record(Schema.String, Node.CreateInput).annotate({
      description:
        "Node definitions keyed by temporary client-defined IDs. Connections in this request reference those IDs.",
    }),
  ),
  connections: Schema.optional(
    Schema.Array(Connection.CreateInput).annotate({
      description:
        "Connections between nodes in this request, using their temporary node IDs and schema port IDs.",
    }),
  ),
});
export type CreateGraphRequest = typeof CreateGraphRequest.Type;

export const CreateGraphResponse = Schema.Struct({
  graph: Canvas.Model,
  nodeIds: Schema.Record(Schema.String, NodeId).annotate({
    description: "Created node IDs keyed by the temporary IDs used in the request.",
  }),
  nodeIO: Schema.Record(Schema.String, NodeIO).annotate({
    description:
      "Inputs and outputs of each created node, keyed by created node ID. Includes ports that depend on node properties, such as Format String placeholders, and wildcard types inferred from the created connections.",
  }),
});
export type CreateGraphResponse = typeof CreateGraphResponse.Type;

export const CreateConnectionResponse = Schema.Struct({
  connection: Connection.Model,
  nodeIO: Schema.Record(Schema.String, NodeIO).annotate({
    description:
      "Inputs and outputs of the connected nodes and of every other node whose inferred wildcard types changed, keyed by node ID.",
  }),
});
export type CreateConnectionResponse = typeof CreateConnectionResponse.Type;

const list = HttpApiEndpoint.get("list", "/api/projects", {
  success: Schema.Struct({ projects: Schema.Array(ProjectRecord) }),
})
  .annotate(OpenApi.Description, "List all projects accessible to the authenticated user.")
  .middleware(Authentication);

const create = HttpApiEndpoint.post("create", "/api/projects", {
  payload: CreateProjectRequest,
  success: Schema.Struct({ project: ProjectRecord }).pipe(HttpApiSchema.status("Created")),
  error: [TeamNotFound, HttpApiError.BadRequest, HttpApiError.Forbidden],
})
  .annotate(OpenApi.Description, "Create a project, optionally assigning it to a team.")
  .middleware(Authentication);

const get = HttpApiEndpoint.get("get", "/api/projects/:projectId", {
  params: { projectId: Schema.String },
  success: Schema.Struct({ project: ProjectRecord }),
  error: ProjectNotFound,
})
  .annotate(OpenApi.Description, "Get an accessible project's metadata.")
  .middleware(Authentication);

const listGraphs = HttpApiEndpoint.get("listGraphs", "/api/projects/:projectId/graphs", {
  params: { projectId: Schema.String },
  success: Schema.Struct({
    graphs: Schema.Array(Schema.Struct({ id: GraphId, name: Schema.String })),
  }),
  error: ProjectNotFound,
})
  .annotate(OpenApi.Description, "List the IDs and names of all graphs in a project.")
  .middleware(Authentication);

const createGraph = HttpApiEndpoint.post("createGraph", "/api/projects/:projectId/graphs", {
  params: { projectId: Schema.String },
  payload: CreateGraphRequest,
  success: CreateGraphResponse.pipe(HttpApiSchema.status("Created")),
  error: [ProjectNotFound, HttpApiError.BadRequest, HttpApiError.Forbidden],
})
  .annotate(
    OpenApi.Description,
    "Create an empty graph or a complete connected graph in one request. The nodes object maps temporary client-defined node IDs to node definitions. Connections reference those temporary IDs through outNodeId and inNodeId. outIo is a structured output reference: { _tag: 'Port', id }, { _tag: 'ScopeExec', scope }, or { _tag: 'ScopeField', scope, field }; inIoId identifies the input. Node schemas use { package, schema }; resource properties use IDs returned by listResources. The response maps each temporary node ID to its created node ID in nodeIds, and includes each created node's inputs and outputs in nodeIO.",
  )
  .middleware(Authentication);

const getGraph = HttpApiEndpoint.get("getGraph", "/api/projects/:projectId/graphs/:graphId", {
  params: { projectId: Schema.String, graphId: Schema.String },
  success: Schema.Struct({
    graph: Canvas.Model,
    nodeIO: Schema.Record(Schema.String, NodeIO),
  }),
  error: [ProjectNotFound, HttpApiError.NotFound],
})
  .annotate(
    OpenApi.Description,
    "Get a graph, its nodes and connections, and node ports with wildcard types inferred from the graph's connections.",
  )
  .middleware(Authentication);

const deleteGraph = HttpApiEndpoint.delete(
  "deleteGraph",
  "/api/projects/:projectId/graphs/:graphId",
  {
    params: { projectId: Schema.String, graphId: Schema.String },
    success: Schema.Void,
    error: [ProjectNotFound, HttpApiError.NotFound, HttpApiError.Forbidden],
  },
)
  .annotate(OpenApi.Description, "Delete a graph and all of its nodes and connections.")
  .middleware(Authentication);

const listSchemas = HttpApiEndpoint.get("listSchemas", "/api/projects/:projectId/schemas", {
  params: { projectId: Schema.String },
  query: {
    query: Schema.optional(Schema.String),
    limit: Schema.optional(
      Schema.NumberFromString.check(Schema.isInt()).check(
        Schema.isBetween({ minimum: 1, maximum: 100 }),
      ),
    ),
  },
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
  error: ProjectNotFound,
})
  .annotate(
    OpenApi.Description,
    "List ranked node schemas, including their properties, input/output ports, and configured resources matching resource-backed properties. Optionally filter by a case-insensitive search across package and schema names, IDs, and descriptions. Returns at most 20 schemas by default and up to 100 with limit.",
  )
  .middleware(Authentication);

const listResources = HttpApiEndpoint.get("listResources", "/api/projects/:projectId/resources", {
  params: { projectId: Schema.String },
  success: Schema.Struct({ resources: Schema.Array(ResourceConstant.Model) }),
  error: ProjectNotFound,
})
  .annotate(
    OpenApi.Description,
    "List a project's configured resource constants, including their IDs, names, resource types, and selected values. Use a resource's id as the value of a matching resource-typed node property when creating nodes or graphs. Resource values never include credential secrets.",
  )
  .middleware(Authentication);

const createNode = HttpApiEndpoint.post(
  "createNode",
  "/api/projects/:projectId/graphs/:graphId/nodes",
  {
    params: { projectId: Schema.String, graphId: Schema.String },
    payload: Node.CreateInput,
    success: Schema.Struct({ node: Node.Model, io: NodeIO }).pipe(HttpApiSchema.status("Created")),
    error: [
      ProjectNotFound,
      HttpApiError.NotFound,
      HttpApiError.Forbidden,
      HttpApiError.BadRequest,
    ],
  },
)
  .annotate(
    OpenApi.Description,
    "Add a node to an existing graph. Node schemas use { package, schema }; resource properties use IDs returned by listResources.",
  )
  .middleware(Authentication);

const createConnection = HttpApiEndpoint.post(
  "createConnection",
  "/api/projects/:projectId/graphs/:graphId/connections",
  {
    params: { projectId: Schema.String, graphId: Schema.String },
    payload: Connection.CreateInput,
    success: CreateConnectionResponse.pipe(HttpApiSchema.status("Created")),
    error: [
      ProjectNotFound,
      HttpApiError.NotFound,
      HttpApiError.Forbidden,
      HttpApiError.BadRequest,
    ],
  },
)
  .annotate(
    OpenApi.Description,
    "Connect an existing output port to an existing input port using node IDs and port IDs. The response includes nodeIO for the connected nodes and every other node whose inferred wildcard types changed.",
  )
  .middleware(Authentication);

const remove = HttpApiEndpoint.delete("remove", "/api/projects/:projectId", {
  params: { projectId: Schema.String },
  success: Schema.Void,
  error: [ProjectNotFound, HttpApiError.Forbidden],
})
  .annotate(OpenApi.Description, "Delete a project and its associated data.")
  .middleware(Authentication);

const getAccess = HttpApiEndpoint.get("getAccess", "/api/projects/:projectId/access", {
  params: { projectId: Schema.String },
  success: Schema.Struct({
    access: Schema.Literals(["team", "restricted"]),
    userIds: Schema.Array(Schema.String),
  }),
  error: ProjectNotFound,
})
  .annotate(OpenApi.Description, "Get a project's access mode and explicitly authorized users.")
  .middleware(Authentication);

const setAccess = HttpApiEndpoint.put("setAccess", "/api/projects/:projectId/access", {
  params: { projectId: Schema.String },
  payload: Schema.Struct({
    access: Schema.Literals(["team", "restricted"]),
    userIds: Schema.Array(Schema.String),
  }),
  success: Schema.Struct({ project: ProjectRecord, userIds: Schema.Array(Schema.String) }),
  error: [ProjectNotFound, HttpApiError.Forbidden, HttpApiError.BadRequest],
})
  .annotate(OpenApi.Description, "Update a project's access mode and explicitly authorized users.")
  .middleware(Authentication);

/**
 * Endpoints every MacroGraph host serves for reading and editing its projects' graphs, whether
 * it is the cloud or a self-hosted server.
 */
export const projectEditorEndpoints = [
  list,
  get,
  listGraphs,
  createGraph,
  getGraph,
  deleteGraph,
  listSchemas,
  listResources,
  createNode,
  createConnection,
] as const;

/** The project endpoints served by hosts with a fixed set of projects, such as self-hosted servers. */
export class ProjectEditorApiGroup extends HttpApiGroup.make("projects").add(
  ...projectEditorEndpoints,
) {}

export class ProjectsApiGroup extends HttpApiGroup.make("projects").add(
  ...projectEditorEndpoints,
  create,
  remove,
  getAccess,
  setAccess,
) {}
