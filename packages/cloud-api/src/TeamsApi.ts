import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { TeamNotFound, UserNotFound } from "./Errors.ts";
import { TeamMember, TeamRecord } from "./Models.ts";

export class TeamsApiGroup extends HttpApiGroup.make("teams").add(
  HttpApiEndpoint.get("list", "/api/teams", {
    success: Schema.Struct({ teams: Schema.Array(TeamRecord) }),
  }).middleware(Authentication),
  HttpApiEndpoint.post("create", "/api/teams", {
    payload: Schema.Struct({
      name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
    }),
    success: Schema.Struct({ team: TeamRecord }).pipe(HttpApiSchema.status("Created")),
  }).middleware(Authentication),
  HttpApiEndpoint.get("listMembers", "/api/teams/:teamId/members", {
    params: { teamId: Schema.String },
    success: Schema.Struct({ members: Schema.Array(TeamMember) }),
    error: TeamNotFound,
  }).middleware(Authentication),
  HttpApiEndpoint.post("addMember", "/api/teams/:teamId/members", {
    params: { teamId: Schema.String },
    payload: Schema.Struct({
      email: Schema.Trim.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
      role: Schema.Literals(["member", "viewer"]),
    }),
    success: Schema.Struct({ member: TeamMember }),
    error: [TeamNotFound, UserNotFound, HttpApiError.Forbidden],
  }).middleware(Authentication),
  HttpApiEndpoint.put("setMember", "/api/teams/:teamId/members/:userId", {
    params: { teamId: Schema.String, userId: Schema.String },
    payload: Schema.Struct({ role: Schema.Literals(["member", "viewer"]) }),
    success: Schema.Struct({ member: TeamMember }),
    error: [TeamNotFound, UserNotFound, HttpApiError.Forbidden],
  }).middleware(Authentication),
  HttpApiEndpoint.delete("removeMember", "/api/teams/:teamId/members/:userId", {
    params: { teamId: Schema.String, userId: Schema.String },
    success: Schema.Void,
    error: [TeamNotFound, HttpApiError.Forbidden],
  }).middleware(Authentication),
) {}
