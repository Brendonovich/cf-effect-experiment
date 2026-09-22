import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi";

export const PreviewCodeChallenge = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43,128}$/),
);

export const PreviewAuthorizationQuery = Schema.Struct({
  redirectUri: Schema.String,
  codeChallenge: PreviewCodeChallenge,
  state: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
});

export const PreviewTokenRequest = Schema.Struct({
  code: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  codeVerifier: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._~-]{43,128}$/)),
  redirectUri: Schema.String,
});

export const PreviewIdentity = Schema.Struct({
  userId: Schema.String,
  email: Schema.String,
});

export const PreviewExchangeResult = Schema.Struct({
  state: Schema.Literal("connected"),
  userId: Schema.String,
  email: Schema.String,
  teamId: Schema.String,
  projectId: Schema.String,
});

const errors = [
  HttpApiError.BadRequest,
  HttpApiError.Forbidden,
  HttpApiError.Unauthorized,
] as const;

export class PreviewAuthApiGroup extends HttpApiGroup.make("previewAuth").add(
  HttpApiEndpoint.get("authorize", "/api/preview-auth/authorize", {
    query: PreviewAuthorizationQuery,
    success: Schema.Void,
    error: errors,
  }),
  HttpApiEndpoint.post("token", "/api/preview-auth/token", {
    payload: PreviewTokenRequest,
    success: PreviewIdentity,
    error: errors,
  }),
  HttpApiEndpoint.post("exchange", "/api/preview-auth/exchange", {
    payload: PreviewTokenRequest,
    success: PreviewExchangeResult,
    error: errors,
  }),
) {}
