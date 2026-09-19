import { Schema } from "effect";

export const DeploymentObjectKey = Schema.String.pipe(Schema.brand("DeploymentObjectKey"));
export type DeploymentObjectKey = typeof DeploymentObjectKey.Type;

export const deploymentProjectObjectKey = (
  projectId: string,
  deploymentId: string,
): DeploymentObjectKey =>
  DeploymentObjectKey.make(`projects/${projectId}/revisions/${deploymentId}.project.json`);

export const deploymentSnapshotObjectKey = (
  projectId: string,
  deploymentId: string,
): DeploymentObjectKey =>
  DeploymentObjectKey.make(`projects/${projectId}/revisions/${deploymentId}.snapshot.json`);
