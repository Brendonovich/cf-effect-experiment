import type { RouteSectionProps } from "@solidjs/router";

import { createMemo, Show } from "solid-js";

import { useWorkspace } from "../../App";
import { Redirect } from "../../Redirect";

export const TeamHomeRoute = (props: RouteSectionProps) => {
  const workspace = useWorkspace();

  const destination = createMemo(() => {
    const project = workspace
      .projects()
      .find((candidate) => candidate.teamId === props.params.teamId);
    return project === undefined
      ? "/"
      : `/teams/${encodeURIComponent(project.teamId)}/projects/${encodeURIComponent(project.id)}/editor`;
  });

  return (
    <Show when={destination()} keyed>
      {(href) => <Redirect href={href} replace />}
    </Show>
  );
};
