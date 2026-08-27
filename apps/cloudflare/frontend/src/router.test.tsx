// @vitest-environment jsdom

import { createRouter, memoryHistory, type RouteSectionProps } from "@solidjs/router";
import { render } from "@solidjs/web";
import { flush, onCleanup } from "solid-js";
import { expect, it } from "vitest";

it("keeps shared layouts mounted across sibling routes and parameter changes", () => {
  const parent = { mounts: 0, disposals: 0 };
  const project = { mounts: 0, disposals: 0 };
  const history = memoryHistory("/teams/team-1/projects/project-1/editor");
  const Router = createRouter({
    history,
    routes: [
      { path: "/sign-in", component: () => <p>Sign in</p> },
      {
        path: "/",
        component: (props: RouteSectionProps) => {
          parent.mounts++;
          onCleanup(() => parent.disposals++);
          return <main>{props.children}</main>;
        },
        children: [
          {
            path: "/teams/:teamId/projects/:projectId",
            component: (props: RouteSectionProps) => {
              project.mounts++;
              onCleanup(() => project.disposals++);
              return (
                <section data-team={props.params.teamId} data-project={props.params.projectId}>
                  {props.children}
                </section>
              );
            },
            children: [
              { path: "/editor", component: () => <p>Editor</p> },
              {
                path: "/deployments/:deploymentId",
                component: (props: RouteSectionProps) => (
                  <p>Deployment {props.params.deploymentId}</p>
                ),
              },
              {
                path: "/events/:eventId",
                component: (props: RouteSectionProps) => <p>Event {props.params.eventId}</p>,
              },
              { path: "/settings", component: () => <p>Settings</p> },
            ],
          },
        ],
      },
    ],
  });
  const container = document.createElement("div");
  document.body.append(container);
  const dispose = render(() => <Router />, container);

  try {
    flush();
    expect(container.textContent).toBe("Editor");
    expect({ parent, project }).toEqual({
      parent: { mounts: 1, disposals: 0 },
      project: { mounts: 1, disposals: 0 },
    });

    for (const [path, text] of [
      ["deployments/deployment-1", "Deployment deployment-1"],
      ["deployments/deployment-2", "Deployment deployment-2"],
      ["events/event-1", "Event event-1"],
      ["events/event-2", "Event event-2"],
      ["settings", "Settings"],
      ["editor", "Editor"],
    ]) {
      history.set({ value: `/teams/team-1/projects/project-1/${path}` });
      flush();
      expect(container.textContent).toBe(text);
      expect.soft({ parent, project }, path).toEqual({
        parent: { mounts: 1, disposals: 0 },
        project: { mounts: 1, disposals: 0 },
      });
    }

    history.set({ value: "/teams/team-2/projects/project-2/editor" });
    flush();
    expect(container.textContent).toBe("Editor");
    expect(container.querySelector("section")?.dataset).toMatchObject({
      team: "team-2",
      project: "project-2",
    });
    expect.soft({ parent, project }, "same leaf with new parent params").toEqual({
      parent: { mounts: 1, disposals: 0 },
      project: { mounts: 1, disposals: 0 },
    });

    history.set({ value: "/sign-in" });
    flush();
    expect(container.textContent).toBe("Sign in");
    expect.soft({ parent, project }, "leaving the shared layout").toEqual({
      parent: { mounts: 1, disposals: 1 },
      project: { mounts: 1, disposals: 1 },
    });

    history.set({ value: "/teams/team-2/projects/project-2/editor" });
    flush();
    expect(container.textContent).toBe("Editor");
    expect.soft({ parent, project }, "returning mounts fresh layouts").toEqual({
      parent: { mounts: 2, disposals: 1 },
      project: { mounts: 2, disposals: 1 },
    });
  } finally {
    dispose();
    flush();
    container.remove();
  }

  expect({ parent, project }, "render root cleanup disposes the active layouts").toEqual({
    parent: { mounts: 2, disposals: 2 },
    project: { mounts: 2, disposals: 2 },
  });
});
