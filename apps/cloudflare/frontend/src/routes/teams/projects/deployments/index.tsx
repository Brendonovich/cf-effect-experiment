import type { RouteSectionProps } from "@solidjs/router";

import { useWorkspace } from "../../../../App";
import { useProject } from "../layout";
import { DeploymentBrowser } from "./DeploymentBrowser";

export const DeploymentsRoute = (props: RouteSectionProps) => {
  const workspace = useWorkspace();
  const route = useProject();

  return (
    <DeploymentBrowser
      projectId={route.projectId}
      projectsApi={workspace.api.projects}
      deploymentsApi={workspace.api.deployments}
      executionsApi={workspace.api.executions}
      deploymentId={props.params.deploymentId}
      graphId={props.params.graphId}
      canDeploy={
        workspace.selectedTeam()?.role === "owner" || workspace.selectedTeam()?.role === "admin"
      }
      onDeploy={workspace.reloadProjects}
      selectionHref={route.deploymentPath}
      onSelectionChange={route.openDeployments}
    />
  );
};
