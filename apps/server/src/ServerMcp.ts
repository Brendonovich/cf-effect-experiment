import { Editor, EditorEvents, Packages, ProjectOperations } from "@macrograph/editor";
import { layer as mcpLayer, ProjectToolkit } from "@macrograph/mcp";
import { Context, Effect, Layer, Option } from "effect";
import { Toolkit } from "effect/unstable/ai";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ClientSessions } from "./ClientSessions.ts";

export class CurrentSession extends Context.Service<CurrentSession, ClientSessions.Session>()(
  "macrograph/server/McpCurrentSession",
) {}

export const toolkit = Toolkit.make(...ProjectToolkit.make({}, CurrentSession));

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
              graphs: Object.values(project.graphs).map(({ canvas }) => ({
                id: canvas.id,
                name: canvas.name,
              })),
            })),
          ),
        getGraph: ({ graphId }) => ProjectOperations.getGraph(editor, graphId),
        createGraph: (input) =>
          withActor(ProjectOperations.createGraph(editor, input)).pipe(
            Effect.map((graph) => ({ graph })),
          ),
        deleteGraph: ({ graphId }) =>
          withActor(editor.graph.delete({ graphID: graphId })).pipe(Effect.as({ deleted: true })),
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
