import type { ProjectRecord } from "@macrograph/cloud-api";

import { useNavigate, type RouteSectionProps } from "@solidjs/router";
import { createContext, createMemo, Show, useContext } from "solid-js";

import { useWorkspace } from "../../../App";
import { NotFoundRoute } from "../../not-found";

declare module "@solidjs/router" {
  interface RouteInfo {
    workspaceView?: "editor" | "revisions" | "events" | "settings";
  }
}

interface ProjectContextValue {
  readonly projectId: string;
  readonly project: () => ProjectRecord | undefined;
  readonly openEditor: (
    tab?: "rpcs" | "graphs" | "plugin",
    graphId?: string,
    replace?: boolean,
  ) => void;
  readonly openRevisions: (revisionId?: string, graphId?: string, replace?: boolean) => void;
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
  const context: ProjectContextValue = {
    projectId: props.projectId,
    project,
    openEditor: (tab = "graphs", graphId, replace) =>
      navigate(
        `${projectPath}/editor/${tab}${graphId === undefined ? "" : `/${encodeURIComponent(graphId)}`}`,
        replace === undefined ? undefined : { replace },
      ),
    openRevisions: (revisionId, graphId, replace) =>
      navigate(
        `${projectPath}/revisions${revisionId === undefined ? "" : `/${encodeURIComponent(revisionId)}`}${graphId === undefined ? "" : `/${encodeURIComponent(graphId)}`}`,
        replace === undefined ? undefined : { replace },
      ),
    openEvents: (eventId) =>
      navigate(
        `${projectPath}/events${eventId === undefined ? "" : `/${encodeURIComponent(eventId)}`}`,
      ),
    openSettings: () => navigate(`${projectPath}/settings`),
  };

  return (
    <ProjectContext value={context}>
      <div class="h-full min-h-0">{props.children}</div>
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
