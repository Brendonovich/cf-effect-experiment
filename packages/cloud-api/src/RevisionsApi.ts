import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { ProjectNotFound, RevisionNotFound } from "./Errors.ts";
import { ProjectRevisionRecord, ProjectSnapshot, RuntimeEndpoint } from "./Models.ts";

export class RevisionsApiGroup extends HttpApiGroup.make("revisions").add(
  HttpApiEndpoint.get("list", "/api/projects/:projectId/revisions", {
    params: { projectId: Schema.String },
    success: Schema.Struct({ revisions: Schema.Array(ProjectRevisionRecord) }),
    error: ProjectNotFound,
  }).middleware(Authentication),
  HttpApiEndpoint.get("get", "/api/projects/:projectId/revisions/:revisionId", {
    params: { projectId: Schema.String, revisionId: Schema.String },
    success: Schema.Struct({ revision: ProjectRevisionRecord, snapshot: ProjectSnapshot }),
    error: [ProjectNotFound, RevisionNotFound],
  }).middleware(Authentication),
  HttpApiEndpoint.post("deploy", "/api/projects/:projectId/deploy", {
    params: { projectId: Schema.String },
    success: Schema.Struct({
      projectId: Schema.String,
      revision: ProjectRevisionRecord,
      endpoints: Schema.Array(RuntimeEndpoint),
    }),
    error: ProjectNotFound,
  }).middleware(Authentication),
) {}
