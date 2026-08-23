import { createRouter } from "@solidjs/router";
import { render } from "@solidjs/web";
/* @refresh reload */
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { Loading } from "solid-js";

import "./index.css";
import { App } from "./App";
import { WorkspaceHomeRoute } from "./routes";
import { NotFoundRoute } from "./routes/not-found";
import { TeamHomeRoute } from "./routes/teams";
import { EventsRoute } from "./routes/teams/projects/events";
import { ProjectLayout } from "./routes/teams/projects/layout";
import { RevisionsRoute } from "./routes/teams/projects/revisions";
import { ProjectSettingsRoute } from "./routes/teams/projects/settings";

document.documentElement.classList.add("dark", "dark-theme");

const queryClient = new QueryClient();
const Router = createRouter({
  routes: [
    { path: "/", component: WorkspaceHomeRoute },
    {
      path: "/teams/:teamId",
      children: [
        { path: "/", component: TeamHomeRoute },
        {
          path: "/projects/:projectId",
          component: ProjectLayout,
          children: [
            {
              path: "/editor/:editorTab/:graphId?",
              matchFilters: { editorTab: ["rpcs", "graphs", "plugin"] },
              info: { workspaceView: "editor" },
            },
            {
              path: "/revisions/:revisionId?/:graphId?",
              info: { workspaceView: "revisions" },
              component: RevisionsRoute,
            },
            {
              path: "/events/:ingestEventId?",
              info: { workspaceView: "events" },
              component: EventsRoute,
            },
            {
              path: "/settings",
              info: { workspaceView: "settings" },
              component: ProjectSettingsRoute,
            },
          ],
        },
      ],
    },
    { path: "*404", component: NotFoundRoute },
  ],
});

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Loading fallback={null}>
          <Router>{(props) => <App {...props} />}</Router>
        </Loading>
      </QueryClientProvider>
    ),
    root,
  );
}
