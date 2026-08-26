import type { RouteSectionProps } from "@solidjs/router";

import { useWorkspace } from "../../../../App";
import { useProject } from "../layout";
import { Events } from "./Events";

export const EventsRoute = (props: RouteSectionProps) => {
  const workspace = useWorkspace();
  const route = useProject();

  return (
    <Events
      projectId={route.projectId}
      api={workspace.api.events}
      credentialsApi={workspace.api.credentials}
      selectedEventId={props.params.eventId}
      canViewTraces={workspace.currentUserId() === "mkcpxx5dnzi5w6m"}
      onSelectionChange={route.openEvents}
    />
  );
};
