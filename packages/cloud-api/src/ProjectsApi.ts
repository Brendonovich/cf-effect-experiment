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

export class ProjectsApiGroup extends HttpApiGroup.make("projects").add(
  HttpApiEndpoint.get("list", "/api/projects", {
    success: Schema.Struct({ projects: Schema.Array(ProjectRecord) }),
  })
    .annotate(OpenApi.Description, "List all projects accessible to the authenticated user.")
    .middleware(Authentication),
  HttpApiEndpoint.post("create", "/api/projects", {
    payload: CreateProjectRequest,
    success: Schema.Struct({ project: ProjectRecord }).pipe(HttpApiSchema.status("Created")),
    error: [TeamNotFound, HttpApiError.BadRequest, HttpApiError.Forbidden],
  })
    .annotate(OpenApi.Description, "Create a project, optionally assigning it to a team.")
    .middleware(Authentication),
  HttpApiEndpoint.get("get", "/api/projects/:projectId", {
    params: { projectId: Schema.String },
    success: Schema.Struct({ project: ProjectRecord }),
    error: ProjectNotFound,
  })
    .annotate(OpenApi.Description, "Get an accessible project's metadata.")
    .middleware(Authentication),
  HttpApiEndpoint.get("listGraphs", "/api/projects/:projectId/graphs", {
    params: { projectId: Schema.String },
    success: Schema.Struct({
      graphs: Schema.Array(Schema.Struct({ id: GraphId, name: Schema.String })),
    }),
    error: ProjectNotFound,
  })
    .annotate(OpenApi.Description, "List the IDs and names of all graphs in a project.")
    .middleware(Authentication),
  HttpApiEndpoint.post("createGraph", "/api/projects/:projectId/graphs", {
    params: { projectId: Schema.String },
    payload: CreateGraphRequest,
    success: Schema.Struct({ graph: Graph.Model }).pipe(HttpApiSchema.status("Created")),
    error: [ProjectNotFound, HttpApiError.BadRequest],
  })
    .annotate(
      OpenApi.Description,
      "Create an empty graph or a complete connected graph in one request. The nodes object maps temporary client-defined node IDs to node definitions. Connections reference those temporary IDs through outNodeId and inNodeId, and use outIoId and inIoId for port IDs. Node schemas use { package, schema }; resource properties use IDs returned by listResources.",
    )
    .middleware(Authentication),
  HttpApiEndpoint.get("getGraph", "/api/projects/:projectId/graphs/:graphId", {
    params: { projectId: Schema.String, graphId: Schema.String },
    success: Schema.Struct({
      graph: Graph.Model,
      nodeIO: Schema.Record(Schema.String, NodeIO),
    }),
    error: [ProjectNotFound, HttpApiError.NotFound],
  })
    .annotate(OpenApi.Description, "Get a graph, its nodes and connections, and resolved node ports.")
    .middleware(Authentication),
  HttpApiEndpoint.delete("deleteGraph", "/api/projects/:projectId/graphs/:graphId", {
    params: { projectId: Schema.String, graphId: Schema.String },
    success: Schema.Void,
    error: [ProjectNotFound, HttpApiError.NotFound],
  })
    .annotate(OpenApi.Description, "Delete a graph and all of its nodes and connections.")
    .middleware(Authentication),
  HttpApiEndpoint.get("listSchemas", "/api/projects/:projectId/schemas", {
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
      "List ranked node schemas, including their properties, input/output ports, and configured resources matching resource-backed properties. Optionally filter by a case-insensitive search across package and schema names, IDs, and descriptions. Returns at most 20 schemas by default.",
    )
    .middleware(Authentication),
  HttpApiEndpoint.get("listResources", "/api/projects/:projectId/resources", {
    params: { projectId: Schema.String },
    success: Schema.Struct({ resources: Schema.Array(ResourceConstant.Model) }),
    error: ProjectNotFound,
  })
    .annotate(
      OpenApi.Description,
      "List a project's configured resource constants, including their IDs, names, resource types, and selected values. Use a resource's id as the value of a matching resource-typed node property when creating nodes or graphs. Resource values never include credential secrets.",
    )
    .middleware(Authentication),
  HttpApiEndpoint.post("createNode", "/api/projects/:projectId/graphs/:graphId/nodes", {
    params: { projectId: Schema.String, graphId: Schema.String },
    payload: Node.CreateInput,
    success: Schema.Struct({ node: Node.Model, io: NodeIO }).pipe(HttpApiSchema.status("Created")),
    error: [
      ProjectNotFound,
      HttpApiError.NotFound,
      HttpApiError.Forbidden,
      HttpApiError.BadRequest,
    ],
  })
    .annotate(
      OpenApi.Description,
      "Add a node to an existing graph. Node schemas use { package, schema }; resource properties use IDs returned by listResources.",
    )
    .middleware(Authentication),
  HttpApiEndpoint.post("createConnection", "/api/projects/:projectId/graphs/:graphId/connections", {
    params: { projectId: Schema.String, graphId: Schema.String },
    payload: Connection.CreateInput,
    success: Schema.Struct({ connection: Connection.Model }).pipe(HttpApiSchema.status("Created")),
    error: [
      ProjectNotFound,
      HttpApiError.NotFound,
      HttpApiError.Forbidden,
      HttpApiError.BadRequest,
    ],
  })
    .annotate(
      OpenApi.Description,
      "Connect an existing output port to an existing input port using node IDs and port IDs.",
    )
    .middleware(Authentication),
  HttpApiEndpoint.delete("remove", "/api/projects/:projectId", {
    params: { projectId: Schema.String },
    success: Schema.Void,
    error: [ProjectNotFound, HttpApiError.Forbidden],
  })
    .annotate(OpenApi.Description, "Delete a project and its associated data.")
    .middleware(Authentication),
  HttpApiEndpoint.get("getAccess", "/api/projects/:projectId/access", {
    params: { projectId: Schema.String },
    success: Schema.Struct({
      access: Schema.Literals(["team", "restricted"]),
      userIds: Schema.Array(Schema.String),
    }),
    error: ProjectNotFound,
  })
    .annotate(OpenApi.Description, "Get a project's access mode and explicitly authorized users.")
    .middleware(Authentication),
  HttpApiEndpoint.put("setAccess", "/api/projects/:projectId/access", {
    params: { projectId: Schema.String },
    payload: Schema.Struct({
      access: Schema.Literals(["team", "restricted"]),
      userIds: Schema.Array(Schema.String),
    }),
    success: Schema.Struct({ project: ProjectRecord, userIds: Schema.Array(Schema.String) }),
    error: [ProjectNotFound, HttpApiError.Forbidden, HttpApiError.BadRequest],
  })
    .annotate(OpenApi.Description, "Update a project's access mode and explicitly authorized users.")
    .middleware(Authentication),
) {}
