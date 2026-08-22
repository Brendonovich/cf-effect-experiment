import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

const SessionHeaders = { authorization: Schema.String };
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

export class SessionApiGroup extends HttpApiGroup.make("session").add(
  HttpApiEndpoint.get("get", "/api/cloud-auth", {
    headers: SessionHeaders,
    success: SessionStatus,
  }),
  HttpApiEndpoint.post("start", "/api/cloud-auth/start", {
    headers: SessionHeaders,
    success: SessionStatus,
  }),
  HttpApiEndpoint.post("poll", "/api/cloud-auth/poll", {
    headers: SessionHeaders,
    success: SessionStatus,
  }),
  HttpApiEndpoint.delete("disconnect", "/api/cloud-auth", {
    headers: SessionHeaders,
    success: Schema.Void,
  }),
) {}
