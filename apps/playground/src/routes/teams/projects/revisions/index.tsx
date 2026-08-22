import type { RouteSectionProps } from "@solidjs/router";

import { useWorkspace } from "../../../../App";
import { useProject } from "../layout";
import { RevisionBrowser } from "./RevisionBrowser";

export const RevisionsRoute = (props: RouteSectionProps) => {
  const workspace = useWorkspace();
  const route = useProject();

  return (
    <RevisionBrowser
      projectId={route.projectId}
      projectsApi={workspace.api.projects}
      revisionsApi={workspace.api.revisions}
      executionsApi={workspace.api.executions}
      revisionId={props.params.revisionId}
      graphId={props.params.graphId}
      onSelectionChange={route.openRevisions}
    />
  );
};
