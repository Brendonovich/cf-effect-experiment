import {
  Connection,
  Graph,
  Node,
  NodeIO,
  Package,
  Project,
  ResourceConstant,
} from "@macrograph/core";
import { PersistenceError } from "@macrograph/persistence";
import { Effect } from "effect";

import type { Interface as Editor } from "./Editor.ts";

export const getGraph = Effect.fn("ProjectOperations.getGraph")(function* (
  editor: Editor,
  graphId: string,
): Effect.fn.Return<
  { readonly graph: Graph.Model; readonly nodeIO: Readonly<Record<string, NodeIO>> },
  Project.NotFoundError | PersistenceError | Graph.NotFoundError
> {
  const snapshot = yield* editor.project.snapshot();
  const graph = snapshot.project.graphs[graphId];
  if (graph === undefined) return yield* new Graph.NotFoundError({ id: graphId });
  return { graph, nodeIO: snapshot.nodeIO[graphId] ?? {} };
});

export const createGraph = Effect.fn("ProjectOperations.createGraph")(function* (
  editor: Editor,
  input: Graph.CreateRequest,
): Effect.fn.Return<
  Graph.Model,
  | PersistenceError
  | Project.NotFoundError
  | Graph.NotFoundError
  | Graph.FunctionError
  | Node.NotFoundError
  | Package.SchemaNotFoundError
  | Package.InvalidPropertyError
  | Package.InvalidInputDefaultError
  | Connection.InvalidError
> {
  const nodes = input.nodes ?? {};
  const connections = input.connections ?? [];

  for (const connection of connections) {
    if (!Object.hasOwn(nodes, connection.outNodeId) || !Object.hasOwn(nodes, connection.inNodeId))
      return yield* new Connection.InvalidError({
        reason: "Connection references a node that is not being created",
      });
  }

  const created = yield* editor.graph.create({
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.signature === undefined ? {} : { signature: input.signature }),
  });

  return yield* Effect.gen(function* () {
    const nodeIds = new Map<string, string>();
    for (const [reference, node] of Object.entries(nodes)) {
      const event = yield* editor.node.create({ graphID: created.graph.id, node });
      nodeIds.set(reference, event.node.id);
    }

    for (const connection of connections) {
      const outNodeId = nodeIds.get(connection.outNodeId);
      const inNodeId = nodeIds.get(connection.inNodeId);
      if (outNodeId === undefined || inNodeId === undefined)
        return yield* new Connection.InvalidError({
          reason: "Connection references a node that is not being created",
        });
      yield* editor.connection.create({
        graphID: created.graph.id,
        connection: { ...connection, outNodeId, inNodeId },
      });
    }

    return (yield* getGraph(editor, created.graph.id)).graph;
  }).pipe(
    Effect.catchCause((cause) =>
      editor.graph
        .delete({ graphID: created.graph.id, force: true })
        .pipe(Effect.orDie, Effect.andThen(Effect.failCause(cause))),
    ),
  );
});

export interface SearchSchemasOptions {
  readonly query?: string;
  readonly queries?: ReadonlyArray<string>;
  readonly limit?: number;
}

export const searchSchemas = (
  packages: ReadonlyArray<Package.Model>,
  resources: ReadonlyArray<ResourceConstant.Model>,
  { query, queries, limit }: SearchSchemasOptions,
) => {
  const searches = [...(query === undefined ? [] : [query]), ...(queries ?? [])]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const schemas = packages.flatMap((pkg) =>
    pkg.schemas
      .map((schema) => {
        const fields = [schema.id, schema.name, pkg.id, pkg.name, schema.description ?? ""].map(
          (value) => value.toLowerCase(),
        );
        const text = fields.join(" ");
        const scores = searches
          .filter((search) => search.split(/\s+/).every((term) => text.includes(term)))
          .map((search) => {
            const exact = fields.findIndex((field) => field === search);
            if (exact !== -1) return exact;
            const prefix = fields.findIndex((field) => field.startsWith(search));
            if (prefix !== -1) return fields.length + prefix;
            const substring = fields.findIndex((field) => field.includes(search));
            return substring === -1 ? fields.length * 3 : fields.length * 2 + substring;
          });
        if (searches.length > 0 && scores.length === 0) return undefined;

        const matchingResources: Record<string, { id: ResourceConstant.Id; name: string }[]> = {};
        for (const property of schema.properties) {
          if (!("resource" in property)) continue;
          matchingResources[property.id] = resources
            .filter(
              (resource) =>
                resource.resource.package === pkg.id &&
                resource.resource.resource === property.resource,
            )
            .map(({ id, name }) => ({ id, name }));
        }

        return {
          package: pkg.id,
          schema,
          resources: matchingResources,
          score: scores.length === 0 ? 0 : Math.min(...scores),
        };
      })
      .filter((schema) => schema !== undefined),
  );
  schemas.sort(
    (left, right) =>
      left.score - right.score ||
      left.package.localeCompare(right.package) ||
      left.schema.id.localeCompare(right.schema.id),
  );
  return schemas.slice(0, limit ?? 20).map(({ score: _, ...schema }) => schema);
};

export * as ProjectOperations from "./ProjectOperations.ts";
