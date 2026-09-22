import {
  Canvas,
  CanvasId,
  Connection,
  Node,
  NodeIO,
  Package,
  PackageId,
  ResourceConstant,
} from "@macrograph/core";
import { Context, Schema } from "effect";
import { Tool } from "effect/unstable/ai";

export const make = <const ProjectParameters extends Schema.Struct.Fields, Dependency, Service>(
  projectParameters: ProjectParameters,
  dependency: Context.Key<Dependency, Service>,
) => {
  const graphParameters = {
    ...projectParameters,
    graphId: Schema.String.annotate({
      description: "Graph ID returned by listGraphs or createGraph.",
    }),
  };

  return [
    Tool.make("listGraphs", {
      description: "List graph IDs and names in a project.",
      parameters: Schema.Struct(projectParameters),
      success: Schema.Struct({
        graphs: Schema.Array(Schema.Struct({ id: CanvasId, name: Schema.String })),
      }),
      failure: Schema.Unknown,
    })
      .addDependency(dependency)
      .annotate(Tool.Readonly, true),
    Tool.make("getGraph", {
      description:
        "Inspect a graph, including all nodes, connections, and resolved node inputs and outputs.",
      parameters: Schema.Struct(graphParameters),
      success: Schema.Struct({ graph: Canvas.Model, nodeIO: Schema.Record(Schema.String, NodeIO) }),
      failure: Schema.Unknown,
    })
      .addDependency(dependency)
      .annotate(Tool.Readonly, true),
    Tool.make("createGraph", {
      description:
        "PREFERRED: Create an entire graph in one request, including its name, nodes, and connections. Nodes are keyed by temporary local IDs, and connections reference those IDs. Node schemas use { package, schema }; resource properties use matching resource IDs returned by searchSchemas. Use searchSchemas only if schema IDs, ports, or resources are unknown. Prefer this compound tool over separate createNode/createConnection calls.",
      parameters: Schema.Struct({ ...projectParameters, ...Canvas.CreateRequest.fields }),
      success: Schema.Struct({ graph: Canvas.Model }),
      failure: Schema.Unknown,
    }).addDependency(dependency),
    Tool.make("deleteGraph", {
      description: "Permanently delete a graph and all of its nodes and connections.",
      parameters: Schema.Struct(graphParameters),
      success: Schema.Struct({ deleted: Schema.Boolean }),
      failure: Schema.Unknown,
    })
      .addDependency(dependency)
      .annotate(Tool.Destructive, true),
    Tool.make("searchSchemas", {
      description:
        "Find ranked node schemas by package, name, ID, or description. Use queries to find multiple unrelated node types in one call. Results include ports, properties, and matching configured resource IDs for resource-backed properties. Returns at most 20 schemas by default.",
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
      .addDependency(dependency)
      .annotate(Tool.Readonly, true),
    Tool.make("listResources", {
      description:
        "List configured resource constants and their IDs. Use these IDs for matching resource-typed node properties when creating graphs or nodes.",
      parameters: Schema.Struct(projectParameters),
      success: Schema.Struct({ resources: Schema.Array(ResourceConstant.Model) }),
      failure: Schema.Unknown,
    })
      .addDependency(dependency)
      .annotate(Tool.Readonly, true),
    Tool.make("createNode", {
      description:
        "Add one node to an existing graph. Prefer createGraph when building a complete graph.",
      parameters: Schema.Struct({ ...graphParameters, ...Node.CreateInput.fields }),
      success: Schema.Struct({ node: Node.Model, io: NodeIO }),
      failure: Schema.Unknown,
    }).addDependency(dependency),
    Tool.make("createConnection", {
      description:
        "Connect an output pin to an input pin in an existing graph. Prefer createGraph for complete graphs.",
      parameters: Schema.Struct({ ...graphParameters, ...Connection.CreateInput.fields }),
      success: Schema.Struct({ connection: Connection.Model }),
      failure: Schema.Unknown,
    }).addDependency(dependency),
  ] as const;
};

export * as ProjectToolkit from "./ProjectToolkit.ts";
