import { CurrentUser, sessionCookieName } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { Presence } from "@macrograph/editor";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { hasTrustedOrigin } from "../api/HttpOrigin.ts";
import * as Authentication from "../auth/Authentication.ts";
import * as Database from "../database/Database.ts";
import { projects, teamMemberships } from "../database/DatabaseSchema.ts";
import * as Deployment from "../deployment/Deployment.ts";
import * as EditorRpcPolicy from "./EditorRpcPolicy.ts";
import ProjectEditorDO from "./ProjectEditorDO.ts";

export const make = Effect.gen(function* () {
  const authentication = yield* Authentication.Service;
  const database = yield* Database.Service;
  const editorRpcPolicy = yield* EditorRpcPolicy.Service;
  const deployment = yield* Deployment.Service;
  const projectEditors = yield* ProjectEditorDO;

  return {
    handle: (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        if (!hasTrustedOrigin(request)) return HttpServerResponse.empty({ status: 403 });
        const url = new URL(request.url, "http://main.local");
        const sessionId = request.cookies[sessionCookieName];
        const projectId = url.searchParams.get("projectId");
        if (!sessionId) return HttpServerResponse.empty({ status: 401 });
        const userId = yield* authentication.cloudAuth(sessionId).userId();
        if (userId === undefined) return HttpServerResponse.empty({ status: 401 });
        if (projectId === null) return HttpServerResponse.empty({ status: 400 });
        return yield* Effect.gen(function* () {
          const rows = yield* database
            .select({ project: projects, role: teamMemberships.role })
            .from(projects)
            .innerJoin(
              teamMemberships,
              and(eq(teamMemberships.teamId, projects.teamId), eq(teamMemberships.userId, userId)),
            )
            .where(eq(projects.id, projectId))
            .limit(1)
            .pipe(Effect.orDie);
          const row = rows[0];
          if (row === undefined) return HttpServerResponse.empty({ status: 404 });
          const { project, role } = row;
          const displayName = Presence.fallbackName(`${project.id}\0${userId}`);
          const editor = projectEditors.getByName(project.id);
          if (!(request.source instanceof Request))
            return yield* Effect.die("Cloudflare request source is not a native Request");
          const headers = Headers.setAll(request.headers, {
            "x-macrograph-project-created-by": project.createdBy,
            "x-macrograph-project-name": project.name,
            "x-macrograph-user-id": userId,
            "x-macrograph-display-name": displayName,
            "x-macrograph-project-id": project.id,
            "x-macrograph-role": role,
            "x-macrograph-session-id": sessionId,
            "x-macrograph-public-origin": deployment.publicOrigin(request),
          });
          return yield* editor
            .fetch(HttpServerRequest.fromWeb(new Request(request.source, { headers })))
            .pipe(Effect.orDie);
        }).pipe(
          Policy.withPolicy(editorRpcPolicy.canView(projectId)),
          Effect.provideService(CurrentUser, { id: userId, sessionId }),
          Effect.catchTag("ProjectNotFound", () =>
            Effect.succeed(HttpServerResponse.empty({ status: 404 })),
          ),
        );
      }),
  };
});

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "macrograph/cloudflare/EditorRpc",
) {}

export const layer = Layer.effect(Service)(make);
