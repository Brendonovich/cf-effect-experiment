import type { ProjectRecord } from "@macrograph/cloud-api";

import { useNavigate, type RouteSectionProps } from "@solidjs/router";
import { createContext, createMemo, Show, useContext } from "solid-js";

import { useWorkspace } from "../../../App";
import { NotFoundRoute } from "../../not-found";

declare module "@solidjs/router" {
  interface RouteInfo {
    workspaceView?: "editor" | "deployments" | "events" | "settings";
  }
}

interface ProjectContextValue {
  readonly projectId: string;
  readonly project: () => ProjectRecord | undefined;
  readonly deploymentPath: (deploymentId?: string, graphId?: string) => string;
  readonly openEditor: (replace?: boolean) => void;
  readonly openDeployments: (deploymentId?: string, graphId?: string, replace?: boolean) => void;
  readonly openEvents: (eventId?: string) => void;
  readonly openSettings: () => void;
}

const ProjectContext = createContext<ProjectContextValue>();

export const useProject = () => useContext(ProjectContext);

const ProjectLayoutContent = (props: {
  readonly projectId: string;
  readonly teamId: string;
  readonly children: RouteSectionProps["children"];
}) => {
  const workspace = useWorkspace();
  const navigate = useNavigate();

  const project = () =>
    workspace
      .projects()
      .find((candidate) => candidate.id === props.projectId && candidate.teamId === props.teamId);
  const projectPath = `/teams/${encodeURIComponent(props.teamId)}/projects/${encodeURIComponent(props.projectId)}`;
  const deploymentPath = (deploymentId?: string, graphId?: string) =>
    `${projectPath}/deployments${deploymentId === undefined ? "" : `/${encodeURIComponent(deploymentId)}`}${graphId === undefined ? "" : `/${encodeURIComponent(graphId)}`}`;
  const context: ProjectContextValue = {
    projectId: props.projectId,
    project,
    deploymentPath,
    openEditor: (replace) =>
      navigate(`${projectPath}/editor`, replace === undefined ? undefined : { replace }),
    openDeployments: (deploymentId, graphId, replace) =>
      navigate(deploymentPath(deploymentId, graphId), replace === undefined ? undefined : { replace }),
    openEvents: (eventId) =>
      navigate(
        `${projectPath}/events${eventId === undefined ? "" : `/${encodeURIComponent(eventId)}`}`,
      ),
    openSettings: () => navigate(`${projectPath}/settings`),
  };

  return (
    <ProjectContext value={context}>
      <div style={{ height: "100%", "min-height": "0" }}>{props.children}</div>
    </ProjectContext>
  );
};

export const ProjectLayout = (props: RouteSectionProps) => {
  const route = createMemo(() => {
    const projectId = props.params.projectId;
    const teamId = props.params.teamId;
    return projectId === undefined || teamId === undefined ? undefined : { projectId, teamId };
  });

  return (
    <Show when={route()} keyed fallback={<NotFoundRoute />}>
      {(params) => (
        <ProjectLayoutContent projectId={params.projectId} teamId={params.teamId}>
          {props.children}
        </ProjectLayoutContent>
      )}
    </Show>
  );
};
