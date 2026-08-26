import { Credential } from "@macrograph/plugin";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { ProjectNotFound } from "./Errors.ts";

export class CredentialsApiGroup extends HttpApiGroup.make("credentials").add(
  HttpApiEndpoint.get("list", "/api/projects/:projectId/credentials", {
    params: { projectId: Schema.String },
    success: Credential.Catalog,
    error: ProjectNotFound,
  }).middleware(Authentication),
  HttpApiEndpoint.post("refetch", "/api/projects/:projectId/credentials/refetch", {
    params: { projectId: Schema.String },
    success: Credential.Catalog,
    error: [ProjectNotFound, HttpApiError.Forbidden],
  }).middleware(Authentication),
) {}
