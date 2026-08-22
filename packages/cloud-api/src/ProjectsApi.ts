import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
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

export class ProjectsApiGroup extends HttpApiGroup.make("projects").add(
  HttpApiEndpoint.get("list", "/api/projects", {
    success: Schema.Struct({ projects: Schema.Array(ProjectRecord) }),
  }).middleware(Authentication),
  HttpApiEndpoint.post("create", "/api/projects", {
    payload: CreateProjectRequest,
    success: Schema.Struct({ project: ProjectRecord }).pipe(HttpApiSchema.status("Created")),
    error: [TeamNotFound, HttpApiError.BadRequest],
  }).middleware(Authentication),
  HttpApiEndpoint.get("get", "/api/projects/:projectId", {
    params: { projectId: Schema.String },
    success: Schema.Struct({ project: ProjectRecord }),
    error: ProjectNotFound,
  }).middleware(Authentication),
  HttpApiEndpoint.get("getAccess", "/api/projects/:projectId/access", {
    params: { projectId: Schema.String },
    success: Schema.Struct({
      access: Schema.Literals(["team", "restricted"]),
      userIds: Schema.Array(Schema.String),
    }),
    error: ProjectNotFound,
  }).middleware(Authentication),
  HttpApiEndpoint.put("setAccess", "/api/projects/:projectId/access", {
    params: { projectId: Schema.String },
    payload: Schema.Struct({
      access: Schema.Literals(["team", "restricted"]),
      userIds: Schema.Array(Schema.String),
    }),
    success: Schema.Struct({ project: ProjectRecord, userIds: Schema.Array(Schema.String) }),
    error: [ProjectNotFound, HttpApiError.Forbidden, HttpApiError.BadRequest],
  }).middleware(Authentication),
) {}
