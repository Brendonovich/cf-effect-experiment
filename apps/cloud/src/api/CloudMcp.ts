import { CreateProjectRequest, CurrentUser, ProjectRecord } from "@macrograph/cloud-api";
import { ProjectMcp } from "@macrograph/project-api";
import { Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

const createProject = Tool.make("createProject", {
  description: "Create a project in the authenticated user's personal team or a specified team.",
  parameters: CreateProjectRequest,
  success: Schema.Struct({ project: ProjectRecord }),
  failure: Schema.Unknown,
}).addDependency(CurrentUser);

export const toolkit = Toolkit.make(
  ProjectMcp.listProjects,
  ProjectMcp.getProject,
  createProject,
  ...ProjectMcp.editorTools,
);

export const layer = (handlers: Toolkit.HandlersFrom<typeof toolkit.tools>) =>
  ProjectMcp.layer({ name: "MacroGraph Cloud", path: "/api/mcp", toolkit, handlers });

export const authenticated = ProjectMcp.authenticated;
