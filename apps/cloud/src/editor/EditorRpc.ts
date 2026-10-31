import type { ProjectNotFound } from "@macrograph/cloud-api";

import { CurrentUser } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { Presence } from "@macrograph/editor";
import { ModuleId } from "@macrograph/module/ModuleId";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http";

import type { TeamRole } from "../database/DatabaseSchema.ts";

import { hasTrustedOrigin } from "../api/HttpOrigin.ts";
import * as Authentication from "../auth/Authentication.ts";
import * as Credential from "../auth/Credential.ts";
import * as Database from "../database/Database.ts";
import { projects, teamMemberships, users } from "../database/DatabaseSchema.ts";
import * as Deployment from "../deployment/Deployment.ts";
import * as EditorRpcPolicy from "./EditorRpcPolicy.ts";
import ProjectEditorDO from "./ProjectEditorDO.ts";

/** A user's membership of the team that owns a project. */
export interface ProjectMember {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly createdBy: string;
  };
  readonly role: TeamRole;
  readonly email: string | null;
}

/** What forwarding editor requests needs, kept small so it can be tested without Cloudflare. */
export interface Dependencies {
  /** The signed-in user's id, from the website session the request carries. */
  readonly sessionUser: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<string | undefined>;
  readonly member: (projectId: string, userId: string) => Effect.Effect<ProjectMember | undefined>;
  readonly canView: (projectId: string) => Policy.Policy<ProjectNotFound, CurrentUser>;
  readonly publicOrigin: (request: HttpServerRequest.HttpServerRequest) => string;
  /** Gives the project's editor its owner's credentials. */
  readonly syncCredentials: (projectId: string, ownerId: string) => Effect.Effect<void>;
  /** The project's `ProjectEditorDO`. */
  readonly editor: (projectId: string) => {
    readonly fetch: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown>;
  };
}

/**
 * Authenticates editor requests and forwards them to the project's `ProjectEditorDO` with identity
 * headers: the editor WebSocket at `/rpc?projectId=`, and each module's RPCs at
 * `/rpc/projects/:projectId/module/:namespace/:publisher/:name/rpc`, forwarded as
 * `/module/:namespace/:publisher/:name/rpc`.
 */
export const makeHandlers = (dependencies: Dependencies) => {
  const forward = (
    request: HttpServerRequest.HttpServerRequest,
    projectId: string | null,
    /** The URL the Durable Object receives; defaults to the request's own. */
    url?: (projectId: string) => string,
  ) =>
    Effect.gen(function* () {
      if (!hasTrustedOrigin(request)) return HttpServerResponse.empty({ status: 403 });
      const userId = yield* dependencies.sessionUser(request);
      if (userId === undefined) return HttpServerResponse.empty({ status: 401 });
      if (projectId === null) return HttpServerResponse.empty({ status: 400 });
      return yield* Effect.gen(function* () {
        const row = yield* dependencies.member(projectId, userId);
        if (row === undefined) return HttpServerResponse.empty({ status: 404 });
        const { project, role, email } = row;
        const emailName = email === null ? "" : Presence.nameFromEmail(email);
        const displayName =
          emailName.length > 0 ? emailName : Presence.fallbackName(`${project.id}\0${userId}`);
        // The editor's engines run with the owner's credentials, whoever is connected.
        yield* dependencies.syncCredentials(project.id, project.createdBy);
        if (!(request.source instanceof Request))
          return yield* Effect.die("Cloudflare request source is not a native Request");
        const headers = Headers.setAll(request.headers, {
          "x-macrograph-project-created-by": project.createdBy,
          "x-macrograph-project-name": project.name,
          "x-macrograph-user-id": userId,
          "x-macrograph-display-name": displayName,
          // Always set so a client cannot supply its own address.
          "x-macrograph-email": email ?? "",
          "x-macrograph-project-id": project.id,
          "x-macrograph-role": role,
          "x-macrograph-public-origin": dependencies.publicOrigin(request),
        });
        const source =
          url === undefined ? request.source : new Request(url(project.id), request.source);
        return yield* dependencies
          .editor(project.id)
          .fetch(HttpServerRequest.fromWeb(new Request(source, { headers })))
          .pipe(Effect.orDie);
      }).pipe(
        Policy.withPolicy(dependencies.canView(projectId)),
        Effect.provideService(CurrentUser, { id: userId }),
        Effect.catchTag("ProjectNotFound", () =>
          Effect.succeed(HttpServerResponse.empty({ status: 404 })),
        ),
      );
    });

  return {
    handle: (request: HttpServerRequest.HttpServerRequest) =>
      forward(request, new URL(request.url, "http://main.local").searchParams.get("projectId")),
    handleModuleRpc: (
      request: HttpServerRequest.HttpServerRequest,
      params: {
        readonly projectId: string;
        readonly namespace: string;
        readonly publisher: string;
        readonly name: string;
      },
    ) =>
      Option.match(ModuleId.parse(`${params.namespace}/${params.publisher}/${params.name}`), {
        onNone: () => Effect.succeed(HttpServerResponse.empty({ status: 404 })),
        onSome: (moduleId) =>
          forward(request, params.projectId, (projectId) => {
            const url = new URL(
              `${ModuleId.routePrefix(moduleId)}/rpc`,
              new URL(request.url, "http://main.local"),
            );
            url.search = new URLSearchParams({ projectId }).toString();
            return url.href;
          }),
      }),
  };
};

export const make = Effect.gen(function* () {
  const authentication = yield* Authentication.Service;
  const credential = yield* Credential.Service;
  const database = yield* Database.Service;
  const editorRpcPolicy = yield* EditorRpcPolicy.Service;
  const deployment = yield* Deployment.Service;
  const projectEditors = yield* ProjectEditorDO;

  return makeHandlers({
    sessionUser: (request) =>
      Effect.gen(function* () {
        const user = yield* authentication.sessionUser(request);
        if (user === undefined) return undefined;
        yield* authentication.ensureUser(user);
        return user.id;
      }),
    member: (projectId, userId) =>
      database
        .select({ project: projects, role: teamMemberships.role, email: users.email })
        .from(projects)
        .innerJoin(
          teamMemberships,
          and(eq(teamMemberships.teamId, projects.teamId), eq(teamMemberships.userId, userId)),
        )
        .innerJoin(users, eq(users.id, userId))
        .where(eq(projects.id, projectId))
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows[0]),
        ),
    canView: editorRpcPolicy.canView,
    publicOrigin: deployment.publicOrigin,
    syncCredentials: credential.syncEditor,
    editor: (projectId) => projectEditors.getByName(projectId),
  });
});

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "macrograph/cloudflare/EditorRpc",
) {}

export const layer = Layer.effect(Service)(make);
