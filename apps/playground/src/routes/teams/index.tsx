import { useNavigate, type RouteSectionProps } from "@solidjs/router";
import { createEffect } from "solid-js";

import { useWorkspace } from "../../App";

export const TeamHomeRoute = (props: RouteSectionProps) => {
  const workspace = useWorkspace();
  const navigate = useNavigate();

  createEffect(workspace.projects, (projects) => {
    const project = projects.find((candidate) => candidate.teamId === props.params.teamId);
    navigate(
      project === undefined
        ? "/"
        : `/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}/editor/graphs`,
      { replace: true },
    );
  });

  return null;
};
