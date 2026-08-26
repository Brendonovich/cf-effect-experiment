import { Schema } from "effect";

export const DeploymentObjectKey = Schema.String.pipe(Schema.brand("DeploymentObjectKey"));
export type DeploymentObjectKey = typeof DeploymentObjectKey.Type;

export const deploymentObjectKey = (projectId: string, deploymentId: string): DeploymentObjectKey =>
  DeploymentObjectKey.make(`projects/${projectId}/revisions/${deploymentId}.json`);
