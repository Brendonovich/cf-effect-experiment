import type { RouteSectionProps } from "@solidjs/router";

import { useWorkspace } from "../../../../App";
import { useProject } from "../layout";
import { IngestEvents } from "./IngestEvents";

export const EventsRoute = (props: RouteSectionProps) => {
  const workspace = useWorkspace();
  const route = useProject();

  return (
    <IngestEvents
      projectId={route.projectId}
      api={workspace.api.ingressEvents}
      selectedEventId={props.params.ingestEventId}
      onSelectionChange={route.openEvents}
    />
  );
};
