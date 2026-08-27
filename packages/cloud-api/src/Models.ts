import { Project, RenderedProject } from "@macrograph/core";
import { Schema } from "effect";

export const ProjectRecord = Schema.Struct({
  id: Schema.String,
  teamId: Schema.String,
  createdBy: Schema.String,
  access: Schema.Literals(["team", "restricted"]),
  name: Schema.String,
  currentDeploymentId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ProjectRecord = typeof ProjectRecord.Type;

export const TeamRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["personal", "shared"]),
  personalOwnerUserId: Schema.NullOr(Schema.String),
  role: Schema.Literals(["owner", "member", "viewer"]),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type TeamRecord = typeof TeamRecord.Type;

export const TeamMember = Schema.Struct({
  userId: Schema.String,
  email: Schema.NullOr(Schema.String),
  role: Schema.Literals(["owner", "member", "viewer"]),
  createdAt: Schema.String,
});
export type TeamMember = typeof TeamMember.Type;

export const ProjectDeploymentRecord = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  createdBy: Schema.String,
  createdAt: Schema.String,
});
export type ProjectDeploymentRecord = typeof ProjectDeploymentRecord.Type;

export const ProjectEventSource = Schema.Literals([
  "ingress",
  "engine",
  "timer",
  "internal",
  "replay",
]);
export type ProjectEventSource = typeof ProjectEventSource.Type;

export const ProjectEventRecord = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  source: ProjectEventSource,
  ingressEventId: Schema.NullOr(Schema.String),
  pluginId: Schema.String,
  eventType: Schema.String,
  providerEventId: Schema.NullOr(Schema.String),
  eventPayload: Schema.Unknown,
  receivedAt: Schema.String,
});
export type ProjectEventRecord = typeof ProjectEventRecord.Type;

export const ProjectExecutionRecord = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  projectEventId: Schema.String,
  deploymentId: Schema.String,
  status: Schema.Literals(["queued", "running", "complete", "errored"]),
  receivedAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type ProjectExecutionRecord = typeof ProjectExecutionRecord.Type;

export const ProjectIngressEventRecord = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  endpointId: Schema.String,
  pluginId: Schema.String,
  eventType: Schema.String,
  eventId: Schema.NullOr(Schema.String),
  eventPayload: Schema.Unknown,
  traceId: Schema.NullOr(Schema.String),
  previewOnly: Schema.Boolean,
  previewGeneration: Schema.NullOr(Schema.String),
  receivedAt: Schema.String,
});
export type ProjectIngressEventRecord = typeof ProjectIngressEventRecord.Type;

export const ProjectExecutionNodeRecord = Schema.Struct({
  id: Schema.String,
  executionId: Schema.String,
  stepName: Schema.String,
  graphId: Schema.String,
  eventNodeId: Schema.String,
  nodeId: Schema.String,
  kind: Schema.Literals(["event", "exec"]),
  status: Schema.Literals(["running", "complete", "errored"]),
  startedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type ProjectExecutionNodeRecord = typeof ProjectExecutionNodeRecord.Type;

export const RuntimeEndpoint = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  schema: Schema.Struct({ id: Schema.String, displayName: Schema.String }),
  instanceKey: Schema.String,
  displayName: Schema.optional(Schema.String),
  metadata: Schema.Unknown,
});

export const ProjectIngressEndpoint = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  schema: Schema.Struct({ id: Schema.String, displayName: Schema.String }),
  instanceKey: Schema.String,
  displayName: Schema.optional(Schema.String),
  metadata: Schema.Unknown,
  deployed: Schema.Boolean,
  preview: Schema.Boolean,
});
export type ProjectIngressEndpoint = typeof ProjectIngressEndpoint.Type;

export const ProjectSnapshot = Schema.Union([RenderedProject.Model, Project.Model]);
