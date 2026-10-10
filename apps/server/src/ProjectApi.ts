import type { Persistence } from "@macrograph/persistence";

import {
  Authentication,
  CurrentUser,
  ProjectEditorApiGroup,
  ProjectNotFound,
  type CreateGraphRequest,
  type ProjectRecord,
} from "@macrograph/cloud-api";
import { Connection, Node } from "@macrograph/core";
import { Editor, EditorEvents, Packages, Presence } from "@macrograph/editor";
import { ApiCaller, ApiKey, ProjectEditor, ProjectMcp } from "@macrograph/project-api";
import { Context, Effect, Layer, Redacted, Schema, type FileSystem, type Path } from "effect";
import {
  type Etag,
  type HttpPlatform,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { HttpApi, HttpApiBuilder, HttpApiError, OpenApi } from "effect/unstable/httpapi";

import type { ApiKeys } from "./ApiKeys.ts";
import type { ClientSessions } from "./ClientSessions.ts";

/** The REST API served by self-hosted servers: the cloud's project editing endpoints. */
export class Api extends HttpApi.make("MacroGraphServerApi")
  .add(ProjectEditorApiGroup)
  .annotate(OpenApi.Title, "MacroGraph Server API")
  .annotate(OpenApi.Version, "1.0.0") {}

/** A self-hosted server has a single project. */
export const projectId = "local";

export interface Options {
  readonly basePath: string;
  readonly apiKeys: ApiKeys;
  readonly sessions: ClientSessions;
  readonly ownerId: Effect.Effect<string | undefined>;
  readonly adminIds: ReadonlySet<string>;
  readonly projectTimestamps: Effect.Effect<{
    readonly createdAt: string;
    readonly updatedAt: string;
  }>;
}

const KeyName = Schema.Struct({
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
});

/** Adds routes beneath the server's base path. */
const prefixRouter = (prefix: string) =>
  Layer.effect(HttpRouter.HttpRouter)(
    Effect.gen(function* () {
      return (yield* HttpRouter.HttpRouter).prefixed(prefix);
    }),
  );

/**
 * Serves the REST API under `/api`, MCP at `/api/mcp`, and API key management under
 * `/auth/api-keys`. REST and MCP callers authenticate with `Authorization: Bearer <api key>` and
 * act as the key's creator; only the owner and admins may edit or manage keys.
 */
export const layer = (
  options: Options,
): Layer.Layer<
  never,
  never,
  | HttpRouter.HttpRouter
  | Editor.Service
  | EditorEvents.Service
  | Packages.Service
  | Persistence.Service
  | Presence.Registry
  | Etag.Generator
  | FileSystem.FileSystem
  | HttpPlatform.HttpPlatform
  | Path.Path
  | HttpRouter.Request<"Error", unknown>
> => {
  const access = (userId: string) =>
    options.ownerId.pipe(
      Effect.map((ownerId) => ({ canEdit: userId === ownerId || options.adminIds.has(userId) })),
    );

  const principal = (key: string | undefined) =>
    Effect.gen(function* () {
      const found = key === undefined ? undefined : yield* options.apiKeys.authenticate(key);
      if (found === undefined) return yield* new HttpApiError.Unauthorized();
      return {
        user: { id: found.userId, sessionId: undefined },
        caller: ApiCaller.forApiKey({ id: found.id, name: found.name }, found.email),
      } satisfies ProjectMcp.Principal;
    });

  const AuthenticationLayer = Layer.succeed(Authentication)({
    bearer: (effect, { credential }) =>
      principal(Redacted.value(credential)).pipe(
        Effect.flatMap(({ user, caller }) =>
          effect.pipe(
            Effect.provideService(CurrentUser, user),
            Effect.provideService(ApiCaller.Current, caller),
          ),
        ),
      ),
  });

  return Layer.unwrap(
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const presence = yield* Presence.Registry;
      const operations = yield* ProjectEditor.make;

      const requireProject = (id: string) =>
        id === projectId ? Effect.void : Effect.fail(new ProjectNotFound());
      /** The calling REST or MCP client, as shown in presence and attributed on edits. */
      const callerIdentity = Effect.gen(function* () {
        const user = yield* CurrentUser;
        const { canEdit } = yield* access(user.id);
        return ApiCaller.identityFor(yield* ApiCaller.Current, {
          userId: user.id,
          projectId,
          canEdit,
          canManageCredentials: false,
        });
      });
      const editorIdentity = Effect.gen(function* () {
        const identity = yield* callerIdentity;
        if (!identity.canEdit) return yield* new HttpApiError.Forbidden();
        return identity;
      });

      const projectRecord = Effect.gen(function* () {
        const [project, ownerId, timestamps] = yield* Effect.all([
          editor.project.get().pipe(Effect.orDie),
          options.ownerId,
          options.projectTimestamps,
        ]);
        return {
          id: projectId,
          teamId: projectId,
          createdBy: ownerId ?? "",
          access: "team",
          name: project.name,
          currentDeploymentId: null,
          ...timestamps,
        } satisfies ProjectRecord;
      });

      const project = {
        list: () => projectRecord.pipe(Effect.map((record) => ({ projects: [record] }))),
        get: ({ projectId: id }: { readonly projectId: string }) =>
          requireProject(id).pipe(
            Effect.andThen(projectRecord),
            Effect.map((record) => ({ project: record })),
          ),
        listGraphs: ({ projectId: id }: { readonly projectId: string }) =>
          requireProject(id).pipe(
            Effect.andThen(callerIdentity),
            Effect.flatMap((identity) => operations.listGraphs(identity).pipe(Effect.orDie)),
            Effect.map((graphs) => ({ graphs })),
          ),
        createGraph: ({
          projectId: id,
          ...payload
        }: CreateGraphRequest & { readonly projectId: string }) =>
          Effect.gen(function* () {
            yield* requireProject(id);
            const identity = yield* editorIdentity;
            const { graph, ...created } = yield* operations
              .createGraph(payload, identity)
              .pipe(ProjectEditor.httpErrors.createGraph);
            if (graph === undefined) return yield* Effect.die("Created graph could not be loaded");
            return { graph, ...created };
          }),
        getGraph: ({
          projectId: id,
          graphId,
        }: {
          readonly projectId: string;
          readonly graphId: string;
        }) =>
          requireProject(id).pipe(
            Effect.andThen(callerIdentity),
            Effect.flatMap((identity) =>
              operations.getGraph(graphId, identity).pipe(ProjectEditor.httpErrors.getGraph),
            ),
          ),
        deleteGraph: ({
          projectId: id,
          graphId,
        }: {
          readonly projectId: string;
          readonly graphId: string;
        }) =>
          Effect.gen(function* () {
            yield* requireProject(id);
            const identity = yield* editorIdentity;
            yield* operations
              .deleteGraph(graphId, identity)
              .pipe(ProjectEditor.httpErrors.deleteGraph);
            return { deleted: true };
          }),
        searchSchemas: ({
          projectId: id,
          ...search
        }: ProjectEditor.SchemaSearch & { readonly projectId: string }) =>
          Effect.gen(function* () {
            yield* requireProject(id);
            return yield* operations
              .searchSchemas(search, yield* callerIdentity)
              .pipe(Effect.orDie);
          }),
        listResources: ({ projectId: id }: { readonly projectId: string }) =>
          requireProject(id).pipe(
            Effect.andThen(callerIdentity),
            Effect.flatMap((identity) => operations.listResources(identity).pipe(Effect.orDie)),
            Effect.map((resources) => ({ resources })),
          ),
        createNode: ({
          projectId: id,
          graphId,
          ...payload
        }: Node.CreateInput & { readonly projectId: string; readonly graphId: string }) =>
          Effect.gen(function* () {
            yield* requireProject(id);
            const identity = yield* editorIdentity;
            const event = yield* operations
              .createNode(graphId, payload, identity)
              .pipe(ProjectEditor.httpErrors.createNode);
            return { node: event.node, io: event.io };
          }),
        createConnection: ({
          projectId: id,
          graphId,
          ...payload
        }: Connection.CreateInput & { readonly projectId: string; readonly graphId: string }) =>
          Effect.gen(function* () {
            yield* requireProject(id);
            const identity = yield* editorIdentity;
            return yield* operations
              .createConnection(graphId, payload, identity)
              .pipe(ProjectEditor.httpErrors.createConnection);
          }),
      };

      const RestRoutes = HttpApiBuilder.layer(Api, { openapiPath: "/api/openapi.json" }).pipe(
        Layer.provide(
          HttpApiBuilder.group(Api, "projects", (handlers) =>
            handlers
              .handle("list", () => project.list())
              .handle("get", ({ params }) => project.get(params))
              .handle("listGraphs", ({ params }) => project.listGraphs(params))
              .handle("createGraph", ({ params, payload }) =>
                project.createGraph({ ...params, ...payload }),
              )
              .handle("getGraph", ({ params }) => project.getGraph(params))
              .handle("deleteGraph", ({ params }) =>
                project.deleteGraph(params).pipe(Effect.asVoid),
              )
              .handle("listSchemas", ({ params, query }) =>
                project.searchSchemas({ ...params, query: query.query, limit: query.limit }),
              )
              .handle("listResources", ({ params }) => project.listResources(params))
              .handle("createNode", ({ params, payload }) =>
                project.createNode({ ...params, ...payload }),
              )
              .handle("createConnection", ({ params, payload }) =>
                project.createConnection({ ...params, ...payload }),
              ),
          ),
        ),
        Layer.provide(AuthenticationLayer),
        Layer.provide(prefixRouter(options.basePath)),
      );

      const McpRoute = Layer.effectDiscard(
        Effect.gen(function* () {
          // A private router keeps MCP's own route behind the authentication added below. The
          // outer route strips the base path before the private router sees the request.
          const router = Layer.effect(HttpRouter.HttpRouter)(HttpRouter.make);
          const mcp = yield* ProjectMcp.layer({
            name: "MacroGraph Server",
            path: "/api/mcp",
            toolkit: ProjectMcp.toolkit,
            handlers: {
              listProjects: project.list,
              getProject: project.get,
              listGraphs: project.listGraphs,
              getGraph: project.getGraph,
              createGraph: project.createGraph,
              deleteGraph: project.deleteGraph,
              searchSchemas: project.searchSchemas,
              listResources: project.listResources,
              createNode: project.createNode,
              createConnection: project.createConnection,
            },
          }).pipe(Layer.provideMerge(router), Layer.build);
          const app = Context.get(mcp, HttpRouter.HttpRouter).asHttpEffect();
          const authenticate = HttpServerRequest.HttpServerRequest.pipe(
            Effect.flatMap((request) =>
              principal(ApiKey.fromAuthorization(request.headers.authorization)),
            ),
          );
          yield* (yield* HttpRouter.HttpRouter)
            .prefixed(options.basePath)
            .add("*", "/api/mcp", ProjectMcp.authenticated(app, authenticate));
        }),
      );

      return Layer.mergeAll(RestRoutes, McpRoute, keyRoutes(options, access, presence));
    }),
  );
};

const keyRoutes = (
  options: Options,
  access: (userId: string) => Effect.Effect<{ readonly canEdit: boolean }>,
  presence: Presence.Registry["Service"],
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = (yield* HttpRouter.HttpRouter).prefixed(options.basePath);
      const noStore = { "cache-control": "no-store" };
      const error = (status: number, message: string) =>
        HttpServerResponse.jsonUnsafe({ error: message }, { status, headers: noStore });

      /** Only the owner and admins, signed in through the browser, may manage keys. */
      const manager = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* options.sessions.resolve(
          ApiKey.fromAuthorization(request.headers.authorization),
        );
        if (session === undefined)
          return { _tag: "Denied", response: error(401, "Sign in") } as const;
        if (!(yield* access(session.userId)).canEdit)
          return {
            _tag: "Denied",
            response: error(403, "Only the server owner and admins can manage API keys"),
          } as const;
        return { _tag: "Allowed", session } as const;
      });

      yield* router.add(
        "GET",
        "/auth/api-keys",
        Effect.gen(function* () {
          const result = yield* manager;
          if (result._tag === "Denied") return result.response;
          return HttpServerResponse.jsonUnsafe(
            { keys: yield* options.apiKeys.list },
            { headers: noStore },
          );
        }),
      );
      yield* router.add(
        "POST",
        "/auth/api-keys",
        Effect.gen(function* () {
          const result = yield* manager;
          if (result._tag === "Denied") return result.response;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(KeyName)),
            Effect.option,
          );
          if (body._tag === "None") return error(400, "Name the key with 1 to 100 characters");
          const created = yield* options.apiKeys.create(result.session, body.value.name);
          return HttpServerResponse.jsonUnsafe(created, { status: 201, headers: noStore });
        }),
      );
      yield* router.add(
        "DELETE",
        "/auth/api-keys/:apiKeyId",
        Effect.gen(function* () {
          const result = yield* manager;
          if (result._tag === "Denied") return result.response;
          const { apiKeyId } = yield* HttpRouter.params;
          if (apiKeyId === undefined || !(yield* options.apiKeys.revoke(apiKeyId)))
            return error(404, "API key not found");
          yield* presence.apiKeyRevoked(apiKeyId);
          return HttpServerResponse.empty({ status: 204 });
        }),
      );
    }),
  );

export * as ProjectApi from "./ProjectApi.ts";
