import { Credential } from "@macrograph/module";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";

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
  HttpApiEndpoint.get("list", "/api/credentials", {
    success: Credential.Catalog,
  }).middleware(Authentication),
  HttpApiEndpoint.post("refetch", "/api/credentials/refetch", {
    success: Credential.Catalog,
  }).middleware(Authentication),
  HttpApiEndpoint.post("connect", "/api/credentials/:provider/connect", {
    params: { provider: Schema.String },
    success: CredentialConnection,
    error: HttpApiError.BadRequest,
  }).middleware(Authentication),
  HttpApiEndpoint.delete("remove", "/api/credentials/:provider/:credentialId", {
    params: { provider: Schema.String, credentialId: Schema.String },
    success: Schema.Void,
  }).middleware(Authentication),
  HttpApiEndpoint.post("complete", "/api/credentials/oauth/complete", {
    payload: Schema.Struct({ provider: Schema.String, code: Schema.String, state: Schema.String }),
    success: Schema.Struct({ credential: Credential.Summary }),
    error: [HttpApiError.BadRequest, HttpApiError.Forbidden],
  }).middleware(Authentication),
) {}
