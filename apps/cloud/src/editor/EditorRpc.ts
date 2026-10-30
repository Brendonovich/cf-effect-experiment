import { CurrentUser } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { Presence } from "@macrograph/editor";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Headers, HttpServerRequest, HttpServerResponse } from "effect/http";

import { hasTrustedOrigin } from "../api/HttpOrigin.ts";
import * as Authentication from "../auth/Authentication.ts";
import * as Credential from "../auth/Credential.ts";
import * as Database from "../database/Database.ts";
import { projects, teamMemberships, users } from "../database/DatabaseSchema.ts";
import * as Deployment from "../deployment/Deployment.ts";
import * as EditorRpcPolicy from "./EditorRpcPolicy.ts";
import ProjectEditorDO from "./ProjectEditorDO.ts";

export const make = Effect.gen(function* () {
  const authentication = yield* Authentication.Service;
  const credential = yield* Credential.Service;
  const database = yield* Database.Service;
  const editorRpcPolicy = yield* EditorRpcPolicy.Service;
  const deployment = yield* Deployment.Service;
  const projectEditors = yield* ProjectEditorDO;

  return {
    handle: (request: HttpServerRequest.HttpServerRequest) =>
      Effect.gen(function* () {
        if (!hasTrustedOrigin(request)) return HttpServerResponse.empty({ status: 403 });
        const url = new URL(request.url, "http://main.local");
        const projectId = url.searchParams.get("projectId");
        const user = yield* authentication.sessionUser(request);
        if (user === undefined) return HttpServerResponse.empty({ status: 401 });
        yield* authentication.ensureUser(user);
        const userId = user.id;
        if (projectId === null) return HttpServerResponse.empty({ status: 400 });
        return yield* Effect.gen(function* () {
          const rows = yield* database
            .select({ project: projects, role: teamMemberships.role, email: users.email })
            .from(projects)
            .innerJoin(
              teamMemberships,
              and(eq(teamMemberships.teamId, projects.teamId), eq(teamMemberships.userId, userId)),
            )
            .innerJoin(users, eq(users.id, userId))
            .where(eq(projects.id, projectId))
            .limit(1)
            .pipe(Effect.orDie);
          const row = rows[0];
          if (row === undefined) return HttpServerResponse.empty({ status: 404 });
          const { project, role, email } = row;
          const emailName = email === null ? "" : Presence.nameFromEmail(email);
          const displayName =
            emailName.length > 0 ? emailName : Presence.fallbackName(`${project.id}\0${userId}`);
          const editor = projectEditors.getByName(project.id);
          // The editor's engines run with the owner's credentials, whoever is connected.
          yield* credential.syncEditor(project.id, project.createdBy);
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
            "x-macrograph-public-origin": deployment.publicOrigin(request),
          });
          return yield* editor
            .fetch(HttpServerRequest.fromWeb(new Request(request.source, { headers })))
            .pipe(Effect.orDie);
        }).pipe(
          Policy.withPolicy(editorRpcPolicy.canView(projectId)),
          Effect.provideService(CurrentUser, { id: userId }),
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
