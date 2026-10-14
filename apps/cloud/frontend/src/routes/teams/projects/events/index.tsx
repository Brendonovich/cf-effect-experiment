import type { RouteSectionProps } from "@solidjs/router";

import { useWorkspace } from "../../../../App";
import { useProject } from "../layout";
import { Events } from "./Events";

export const EventsRoute = (props: RouteSectionProps) => {
  const workspace = useWorkspace();
  const route = useProject();
  const selectedEventId = () => {
    const eventId = props.params.eventId;
    if (eventId === undefined) return undefined;
    try {
      return decodeURIComponent(eventId);
    } catch {
      return eventId;
    }
  };

  return (
    <Events
      projectId={route.projectId}
      api={workspace.api.events}
      credentialsApi={workspace.api.credentials}
      selectedEventId={selectedEventId()}
      canViewTraces={workspace.currentUserId() === "mkcpxx5dnzi5w6m"}
      canEdit={
        workspace.selectedTeam()?.role === "owner" || workspace.selectedTeam()?.role === "member"
      }
      currentDeploymentId={route.project()?.currentDeploymentId}
      onSelectionChange={route.openEvents}
    />
  );
};
