// @vitest-environment jsdom
import type { TeamMember } from "@macrograph/cloud-api";

import { createRouter, memoryHistory, type RouteSectionProps } from "@solidjs/router";
import { render } from "@solidjs/web";
import { Effect } from "effect";
import { createMemo, flush, Loading, onCleanup } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

import { App, useWorkspace } from "./App";

const mocks = vi.hoisted(() => ({
  teams: vi.fn(),
  projects: vi.fn(),
  members: vi.fn(),
  editor: vi.fn(),
  disposeEditor: vi.fn(),
}));

vi.mock("./Auth", () => ({
  useAuth: () => ({
    api: {
      teams: { list: mocks.teams, listMembers: mocks.members },
      projects: { list: mocks.projects },
    },
  }),
}));
vi.mock("./editorConnection", () => ({ makeEditorConnection: () => Effect.never }));
vi.mock("virtual:macrograph-plugin-settings", () => ({ default: [] }));
vi.mock("@macrograph/editor-ui", async () => ({
  ...(await import("../../../../packages/editor-ui/src/ui/createStateMachine")),
  AccountMenu: () => null,
  Editor: () => <div data-editor />,
  LoadingState: (props: { label: string }) => <div role="status">{props.label}</div>,
  macrographLogo: "",
  createEditorController: () => {
    mocks.editor();
    onCleanup(mocks.disposeEditor);
    return {};
  },
}));

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it.each(["editor", "deployments"])(
  "retains the workspace when starting on %s and navigating between tabs",
  async (initialView) => {
    mocks.teams.mockReturnValue(
      Effect.succeed({ teams: [{ id: "team", name: "My team", role: "owner" }] }),
    );
    mocks.projects.mockReturnValue(
      Effect.succeed({
        projects: [
          { id: "project", teamId: "team", name: "My project", currentDeploymentId: null },
          { id: "other", teamId: "team", name: "Other project", currentDeploymentId: null },
        ],
      }),
    );
    const members = Promise.withResolvers<{ members: TeamMember[] }>();
    mocks.members.mockReturnValue(Effect.promise(() => members.promise));
    let deployments = Promise.withResolvers<string>();
    const loadDeployments = vi.fn(() => deployments.promise);
    const path = "/teams/team/projects/project";
    const history = memoryHistory(`${path}/${initialView}`);
    const navigate = (value: string) => history.set({ value });
    const Router = createRouter({
      history,
      routes: [
        {
          path: "/",
          component: (props: RouteSectionProps) => (
            <App
              {...props}
              user={{ state: "connected", userId: "user", email: "user@example.com" }}
            />
          ),
          children: [
            {
              path: "/teams/:teamId/projects/:projectId",
              children: [
                { path: "/editor", info: { workspaceView: "editor" } },
                {
                  path: "/deployments",
                  info: { workspaceView: "deployments" },
                  component: () => {
                    const data = createMemo(loadDeployments);
                    return <div>{data()}</div>;
                  },
                },
                {
                  path: "/settings",
                  info: { workspaceView: "settings" },
                  component: () => {
                    const workspace = useWorkspace();
                    return <div>Members: {workspace.teamMembers().length}</div>;
                  },
                },
                {
                  path: "/events",
                  info: { workspaceView: "events" },
                  component: () => <div>Events</div>,
                },
              ],
            },
          ],
        },
      ],
    });
    dispose = render(
      () => (
        <Loading fallback={<div>Session fallback</div>}>
          <Router />
        </Loading>
      ),
      document.body,
    );

    const header = () => document.querySelector("header");
    await vi.waitFor(() => {
      flush();
      expect(header()?.textContent).toContain("My project");
    });
    const initialHeader = header();
    if (initialView === "deployments") {
      expect(document.querySelector("main")?.textContent).toContain("Loading project");
      expect(document.body.textContent).not.toContain("Session fallback");
      deployments.resolve("Initial deployments");
      await vi.waitFor(() => expect(document.body.textContent).toContain("Initial deployments"));
      navigate(`${path}/editor`);
      deployments = Promise.withResolvers<string>();
    }
    await vi.waitFor(() => {
      flush();
      expect(mocks.editor).toHaveBeenCalledTimes(1);
    });
    const initialEditor = document.querySelector("[data-editor]");
    expect(initialEditor).not.toBeNull();
    const assertRetained = () => {
      expect(header()).toBe(initialHeader);
      expect(header()?.textContent).toContain("My team");
      expect(header()?.textContent).toContain("My project");
      expect(document.querySelector("[data-editor]")).toBe(initialEditor);
      expect(document.body.textContent).not.toContain("Session fallback");
      expect(mocks.teams).toHaveBeenCalledTimes(1);
      expect(mocks.projects).toHaveBeenCalledTimes(1);
      expect(mocks.editor).toHaveBeenCalledTimes(1);
      expect(mocks.disposeEditor).not.toHaveBeenCalled();
    };

    const previousLoads = loadDeployments.mock.calls.length;
    navigate(`${path}/deployments`);
    await vi.waitFor(() => {
      flush();
      expect(loadDeployments).toHaveBeenCalledTimes(previousLoads + 1);
    });
    assertRetained();
    deployments.resolve("Deployments ready");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Deployments ready"));

    navigate(`${path}/settings`);
    await vi.waitFor(() => {
      flush();
      expect(mocks.members).toHaveBeenCalledTimes(1);
    });
    assertRetained();
    members.resolve({
      members: [
        { userId: "user", email: "user@example.com", role: "owner", createdAt: "2026-08-27" },
      ],
    });
    await vi.waitFor(() =>
      expect(document.querySelector("main")?.textContent).toContain("Members: 1"),
    );

    for (const view of ["events", "editor", "settings", "editor"]) {
      navigate(`${path}/${view}`);
      await vi.waitFor(() => {
        flush();
        expect(document.querySelector("main")?.textContent).toBe(
          view === "events" ? "Events" : view === "settings" ? "Members: 1" : "",
        );
        assertRetained();
      });
    }
    expect(mocks.members).toHaveBeenCalledTimes(1);

    navigate("/teams/team/projects/other/editor");
    await vi.waitFor(() => {
      flush();
      expect(header()?.textContent).toContain("Other project");
      expect(mocks.editor).toHaveBeenCalledTimes(2);
      expect(mocks.disposeEditor).toHaveBeenCalledTimes(1);
    });
  },
);
