import { Credential } from "@macrograph/module";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { ProjectNotFound } from "./Errors.ts";

export const CredentialProvider = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
});

export const CredentialConnection = Schema.Struct({
  authorizationUrl: Schema.String,
});

export class CredentialsApiGroup extends HttpApiGroup.make("credentials").add(
  HttpApiEndpoint.get("providers", "/api/credential-providers", {
    success: Schema.Array(CredentialProvider),
  }).middleware(Authentication),
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
  HttpApiEndpoint.post("connect", "/api/projects/:projectId/credentials/:provider/connect", {
    params: { projectId: Schema.String, provider: Schema.String },
    success: CredentialConnection,
    error: [ProjectNotFound, HttpApiError.BadRequest, HttpApiError.Forbidden],
  }).middleware(Authentication),
  HttpApiEndpoint.post("complete", "/api/credentials/oauth/complete", {
    payload: Schema.Struct({ provider: Schema.String, code: Schema.String, state: Schema.String }),
    success: Schema.Struct({ projectId: Schema.String, credential: Credential.Summary }),
    error: [ProjectNotFound, HttpApiError.BadRequest, HttpApiError.Forbidden],
  }).middleware(Authentication),
  HttpApiEndpoint.delete("remove", "/api/projects/:projectId/credentials/:provider/:credentialId", {
    params: { projectId: Schema.String, provider: Schema.String, credentialId: Schema.String },
    success: Schema.Void,
    error: [ProjectNotFound, HttpApiError.Forbidden],
  }).middleware(Authentication),
) {}
