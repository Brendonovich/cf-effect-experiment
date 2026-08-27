import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi";

export const SessionStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("disconnected") }),
  Schema.Struct({ state: Schema.Literal("pending"), verificationUrl: Schema.String }),
  Schema.Struct({
    state: Schema.Literal("connected"),
    userId: Schema.String,
    email: Schema.String,
  }),
]);
export type SessionStatus = typeof SessionStatus.Type;

export const WebsiteSession = Schema.Struct({
  registrationId: Schema.String.check(Schema.isUUID(4)),
  verificationUrl: Schema.String,
});
export type WebsiteSession = typeof WebsiteSession.Type;

export class SessionApiGroup extends HttpApiGroup.make("session").add(
  HttpApiEndpoint.get("get", "/api/cloud-auth", {
    success: SessionStatus,
  }),
  HttpApiEndpoint.post("start", "/api/cloud-auth/start", {
    success: SessionStatus,
  }),
  HttpApiEndpoint.post("startWebsite", "/api/cloud-auth/website", {
    success: WebsiteSession,
    error: HttpApiError.Forbidden,
  }),
  HttpApiEndpoint.post("pollWebsite", "/api/cloud-auth/website/poll", {
    payload: Schema.Struct({ registrationId: WebsiteSession.fields.registrationId }),
    success: SessionStatus,
    error: HttpApiError.Forbidden,
  }),
  HttpApiEndpoint.post("poll", "/api/cloud-auth/poll", {
    success: SessionStatus,
  }),
  HttpApiEndpoint.delete("disconnect", "/api/cloud-auth", {
    success: Schema.Void,
  }),
  HttpApiEndpoint.post("issueApiKey", "/api/cloud-auth/api-keys", {
    payload: Schema.Struct({ name: Schema.String }),
    success: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      key: Schema.String,
      createdAt: Schema.String,
    }),
    error: HttpApiError.Unauthorized,
  }),
  HttpApiEndpoint.delete("revokeApiKey", "/api/cloud-auth/api-keys/:apiKeyId", {
    params: { apiKeyId: Schema.String },
    success: Schema.Void,
    error: HttpApiError.Unauthorized,
  }),
) {}
