import { Project, RenderedProject } from "@macrograph/core";
import { Schema } from "effect";

export const Model = Schema.Struct({
  project: Project.Model,
  snapshot: RenderedProject.Model,
});
export type Model = typeof Model.Type;

export * as DeploymentArtifact from "./DeploymentArtifact.ts";
