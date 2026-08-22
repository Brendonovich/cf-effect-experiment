import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { TeamNotFound } from "./Errors.ts";
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
  HttpApiEndpoint.put("setMember", "/api/teams/:teamId/members/:userId", {
    params: { teamId: Schema.String, userId: Schema.String },
    payload: Schema.Struct({ role: Schema.Literals(["admin", "member"]) }),
    success: Schema.Struct({ member: TeamMember }),
    error: [TeamNotFound, HttpApiError.Forbidden],
  }).middleware(Authentication),
  HttpApiEndpoint.delete("removeMember", "/api/teams/:teamId/members/:userId", {
    params: { teamId: Schema.String, userId: Schema.String },
    success: Schema.Void,
    error: [TeamNotFound, HttpApiError.Forbidden],
  }).middleware(Authentication),
) {}
