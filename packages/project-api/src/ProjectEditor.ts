import type { CreateGraphRequest } from "@macrograph/cloud-api";

import {
  Connection,
  Graph,
  GraphId,
  Node,
  Package,
  PackageId,
  Project,
  ResourceConstant,
} from "@macrograph/core";
import { Editor, EditorAccess, EditorEvents, Packages, Presence } from "@macrograph/editor";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { Duration, Effect } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";

/** How long a REST or MCP caller stays in presence after its latest request. */
export const presenceTtl = Duration.seconds(90);

/**
 * The project operations behind the REST API and MCP tools, run against an in-process editor.
 * Edits go through the editor's event stream, so connected editors receive them attributed to
 * the calling actor. Every operation also marks its caller as present, so collaborators can see
 * which agents and API clients are working on the project and where.
 */
export const make = Effect.gen(function* () {
  const editor = yield* Editor.Service;
  const editorEvents = yield* EditorEvents.Service;
  const packages = yield* Packages.Service;
  const persistence = yield* Persistence.Service;
  const presence = yield* Presence.Registry;

  const touch = (
    identity: EditorAccess.ConnectionIdentity,
    activity: Omit<Presence.Activity, "ttl"> = {},
  ) =>
    presence.touch(identity, { ...activity, ttl: presenceTtl }).pipe(
      // A location the registry rejects should not hide the caller altogether.
      Effect.catchTag("InvalidPresenceUpdate", () =>
        presence.touch(identity, { ...activity, cursor: null, ttl: presenceTtl }),
      ),
      Effect.ignore,
    );

  const touched =
    <A>(
      identity: EditorAccess.ConnectionIdentity,
      activity: (value: A) => Omit<Presence.Activity, "ttl"> = () => ({}),
    ) =>
    <E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.tap(effect, (value) => touch(identity, activity(value)));

  const listGraphs = (
    identity: EditorAccess.ConnectionIdentity,
  ): Effect.Effect<
    Array<{ id: GraphId; name: string }>,
    Project.NotFoundError | PersistenceError
  > =>
    editor.project.get().pipe(
      Effect.map((project) =>
        Object.values(project.graphs).map(({ canvas }) => ({
          id: canvas.id,
          name: canvas.name,
        })),
      ),
      touched(identity),
    );

  const createGraph = (input: CreateGraphRequest, identity: EditorAccess.ConnectionIdentity) =>
    editorEvents.withActor(
      Effect.gen(function* () {
        const nodes = input.nodes ?? {};
        const connections = input.connections ?? [];

        for (const connection of connections) {
          if (
            !Object.hasOwn(nodes, connection.outNodeId) ||
            !Object.hasOwn(nodes, connection.inNodeId)
          ) {
            return yield* new Connection.InvalidError({
              reason: "Connection references a node that is not being created",
            });
          }
        }

        const created = yield* editor.graph.create(
          input.name === undefined ? {} : { name: input.name },
        );

        return yield* Effect.gen(function* () {
          const nodeIds = new Map<string, string>();

          for (const [reference, node] of Object.entries(nodes)) {
            const event = yield* editor.node
              .create({ graphID: created.graph.id, node })
              .pipe(
                Effect.catchTag("FunctionEventNodeNotAllowedError", () =>
                  Effect.die("A newly-created graph was unexpectedly treated as a function"),
                ),
              );
            nodeIds.set(reference, event.node.id);
          }

          for (const connection of connections) {
            const outNodeId = nodeIds.get(connection.outNodeId);
            const inNodeId = nodeIds.get(connection.inNodeId);
            if (outNodeId === undefined || inNodeId === undefined) {
              return yield* new Connection.InvalidError({
                reason: "Connection references a node that is not being created",
              });
            }

            yield* editor.connection.create({
              graphID: created.graph.id,
              connection: { ...connection, outNodeId, inNodeId },
            });
          }

          return yield* persistence.loadGraph(created.graph.id);
        }).pipe(
          Effect.tap(() => touch(identity, { activeGraph: created.graph.id, cursor: null })),
          Effect.catchCause((cause) =>
            editor.graph
              .delete({ graphID: created.graph.id })
              .pipe(Effect.orDie, Effect.andThen(Effect.failCause(cause))),
          ),
        );
      }),
      identity.actor,
    );

  const getGraph = Effect.fnUntraced(function* (
    graphId: string,
    identity: EditorAccess.ConnectionIdentity,
  ) {
    const snapshot = yield* editor.project.snapshot();
    const graph = snapshot.project.graphs[graphId];
    if (graph === undefined) return yield* new Graph.NotFoundError({ id: graphId });
    yield* touch(identity, { activeGraph: graphId });
    return { graph, nodeIO: snapshot.nodeIO[graphId] ?? {} };
  });

  const deleteGraph = Effect.fnUntraced(function* (
    graphId: string,
    identity: EditorAccess.ConnectionIdentity,
  ) {
    yield* persistence.loadGraph(graphId);
    yield* editorEvents.withActor(
      editor.graph
        .delete({ graphID: graphId })
        .pipe(Effect.tap(() => presence.graphDeleted(identity.projectId, graphId))),
      identity.actor,
    );
    // Clients on the deleted graph were moved off it above; others keep their graph.
    yield* touch(identity);
  });

  const getPackages = () => packages.getPackages();

  const listResources = (identity: EditorAccess.ConnectionIdentity) =>
    editor.project.get().pipe(
      Effect.map((project) => Object.values(project.constants)),
      touched(identity),
    );

  const searchSchemasFor = (search: SchemaSearch, identity: EditorAccess.ConnectionIdentity) =>
    Effect.gen(function* () {
      const [available, resources] = yield* Effect.all([
        packages.getPackages(),
        editor.project.get().pipe(Effect.map((project) => Object.values(project.constants))),
      ]);
      return searchSchemas(available, resources, search);
    }).pipe(touched(identity));

  const createNode: (
    graphId: string,
    node: Node.CreateInput,
    identity: EditorAccess.ConnectionIdentity,
  ) => ReturnType<Editor.Interface["node"]["create"]> = (graphId, node, identity) =>
    editorEvents
      .withActor(editor.node.create({ graphID: graphId, node }), identity.actor)
      .pipe(touched(identity, (event) => ({ activeGraph: graphId, cursor: event.node.position })));

  const createConnection = (
    graphId: string,
    connection: Connection.CreateInput,
    identity: EditorAccess.ConnectionIdentity,
  ) =>
    editorEvents
      .withActor(editor.connection.create({ graphID: graphId, connection }), identity.actor)
      .pipe(touched(identity, () => ({ activeGraph: graphId })));

  return {
    listGraphs,
    createGraph,
    getGraph,
    deleteGraph,
    getPackages,
    listResources,
    searchSchemas: searchSchemasFor,
    createNode,
    createConnection,
  };
});

export type Operations = Effect.Success<typeof make>;

export interface SchemaSearch {
  readonly query?: string | undefined;
  readonly queries?: ReadonlyArray<string> | undefined;
  readonly limit?: number | undefined;
}

export interface SchemaMatch {
  readonly package: PackageId;
  readonly schema: Package.SchemaModel;
  readonly resources: Record<string, Array<{ id: ResourceConstant.Id; name: string }>>;
}

/** Ranks node schemas by how closely they match any of the search phrases. */
export const searchSchemas = (
  packages: ReadonlyArray<Package.Model>,
  resources: ReadonlyArray<ResourceConstant.Model>,
  { query, queries, limit }: SchemaSearch,
): { readonly schemas: Array<SchemaMatch> } => {
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
            if (substring !== -1) return fields.length * 2 + substring;
            return fields.length * 3;
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
  return { schemas: schemas.slice(0, limit ?? 20).map(({ score: _, ...schema }) => schema) };
};

type ErrorOf<K extends keyof Operations> = Operations[K] extends (
  ...args: never
) => Effect.Effect<unknown, infer E, unknown>
  ? E
  : never;

/** Maps editor failures to the REST API's errors; MCP tools reuse the same mapping. */
export const httpErrors = {
  createGraph: <A, R>(effect: Effect.Effect<A, ErrorOf<"createGraph">, R>) =>
    effect.pipe(
      Effect.catchTags({
        SchemaNotFoundError: () => new HttpApiError.BadRequest(),
        InvalidPropertyError: () => new HttpApiError.BadRequest(),
        InvalidInputDefaultError: () => new HttpApiError.BadRequest(),
        InvalidConnectionError: () => new HttpApiError.BadRequest(),
        NodeNotFoundError: () => new HttpApiError.BadRequest(),
        GraphNotFoundError: () => Effect.die("New editor graph was not found"),
        ProjectNotFoundError: () => Effect.die("Editor project was not found"),
        PersistenceError: (error) => Effect.die(error),
      }),
    ),
  getGraph: <A, R>(effect: Effect.Effect<A, ErrorOf<"getGraph">, R>) =>
    effect.pipe(
      Effect.catchTags({
        GraphNotFoundError: () => new HttpApiError.NotFound(),
        ProjectNotFoundError: () => Effect.die("Editor project was not found"),
        PersistenceError: (error) => Effect.die(error),
      }),
    ),
  deleteGraph: <A, R>(effect: Effect.Effect<A, ErrorOf<"deleteGraph">, R>) =>
    effect.pipe(
      Effect.catchTags({
        GraphNotFoundError: () => new HttpApiError.NotFound(),
        PersistenceError: (error) => Effect.die(error),
      }),
    ),
  createNode: <A, R>(effect: Effect.Effect<A, ErrorOf<"createNode">, R>) =>
    effect.pipe(
      Effect.catchTags({
        GraphNotFoundError: () => new HttpApiError.NotFound(),
        SchemaNotFoundError: () => new HttpApiError.BadRequest(),
        InvalidPropertyError: () => new HttpApiError.BadRequest(),
        InvalidInputDefaultError: () => new HttpApiError.BadRequest(),
        FunctionEventNodeNotAllowedError: () => new HttpApiError.BadRequest(),
        ProjectNotFoundError: () => Effect.die("Editor project was not found"),
        PersistenceError: (error) => Effect.die(error),
      }),
    ),
  createConnection: <A, R>(effect: Effect.Effect<A, ErrorOf<"createConnection">, R>) =>
    effect.pipe(
      Effect.catchTags({
        GraphNotFoundError: () => new HttpApiError.NotFound(),
        NodeNotFoundError: () => new HttpApiError.NotFound(),
        SchemaNotFoundError: () => new HttpApiError.BadRequest(),
        InvalidConnectionError: () => new HttpApiError.BadRequest(),
        ProjectNotFoundError: () => Effect.die("Editor project was not found"),
        PersistenceError: (error) => Effect.die(error),
      }),
    ),
};

export * as ProjectEditor from "./ProjectEditor.ts";
