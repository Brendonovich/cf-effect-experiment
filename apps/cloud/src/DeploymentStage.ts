import { Context } from "effect";

export class DeploymentStage extends Context.Service<DeploymentStage, string>()(
  "macrograph/cloud/DeploymentStage",
) {}
