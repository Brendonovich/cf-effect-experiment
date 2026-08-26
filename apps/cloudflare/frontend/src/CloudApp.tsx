import { createRouter } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { Loading } from "solid-js";

import { App } from "./App";
import { WorkspaceHomeRoute } from "./routes";
import { NotFoundRoute } from "./routes/not-found";
import { TeamHomeRoute } from "./routes/teams";
import { EventsRoute } from "./routes/teams/projects/events";
import { ProjectLayout } from "./routes/teams/projects/layout";
import { DeploymentsRoute } from "./routes/teams/projects/deployments";
import { ProjectSettingsRoute } from "./routes/teams/projects/settings";

const queryClient = new QueryClient();
const Router = createRouter({
  base: import.meta.env.BASE_URL,
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
            { path: "/editor", info: { workspaceView: "editor" } },
            {
              path: "/deployments/:deploymentId?/:graphId?",
              info: { workspaceView: "deployments" },
              component: DeploymentsRoute,
            },
            {
              path: "/events/:eventId?",
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

export function CloudApp() {
  return (
    <Loading fallback={null}>
      <QueryClientProvider client={queryClient}>
        <Router>{(props) => <App {...props} />}</Router>
      </QueryClientProvider>
    </Loading>
  );
}
