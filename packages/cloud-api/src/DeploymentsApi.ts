import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

import { Authentication } from "./Authentication.ts";
import { ProjectNotFound, DeploymentNotFound } from "./Errors.ts";
import { ProjectDeploymentRecord, ProjectSnapshot, RuntimeEndpoint } from "./Models.ts";

export class DeploymentsApiGroup extends HttpApiGroup.make("deployments").add(
  HttpApiEndpoint.get("list", "/api/projects/:projectId/deployments", {
    params: { projectId: Schema.String },
    success: Schema.Struct({ deployments: Schema.Array(ProjectDeploymentRecord) }),
    error: ProjectNotFound,
  }).middleware(Authentication),
  HttpApiEndpoint.get("get", "/api/projects/:projectId/deployments/:deploymentId", {
    params: { projectId: Schema.String, deploymentId: Schema.String },
    success: Schema.Struct({ deployment: ProjectDeploymentRecord, snapshot: ProjectSnapshot }),
    error: [ProjectNotFound, DeploymentNotFound],
  }).middleware(Authentication),
  HttpApiEndpoint.post("deploy", "/api/projects/:projectId/deploy", {
    params: { projectId: Schema.String },
    success: Schema.Struct({
      projectId: Schema.String,
      deployment: ProjectDeploymentRecord,
      endpoints: Schema.Array(RuntimeEndpoint),
    }),
    error: ProjectNotFound,
  }).middleware(Authentication),
) {}
