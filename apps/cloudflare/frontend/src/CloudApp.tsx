import { LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { createRouter, useLocation, type RouteSectionProps } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createMemo, Loading, Show } from "solid-js";

import { App } from "./App";
import { AuthProvider, useAuth } from "./Auth";
import { signInUrl } from "./authRedirect";
import { Redirect } from "./Redirect";
import { WorkspaceHomeRoute } from "./routes";
import { NotFoundRoute } from "./routes/not-found";
import { SignInRoute } from "./routes/sign-in";
import { TeamHomeRoute } from "./routes/teams";
import { DeploymentsRoute } from "./routes/teams/projects/deployments";
import { EventsRoute } from "./routes/teams/projects/events";
import { ProjectLayout } from "./routes/teams/projects/layout";
import { ProjectSettingsRoute } from "./routes/teams/projects/settings";

function AuthenticatedApp(props: RouteSectionProps) {
  const auth = useAuth();
  const location = useLocation();
  const user = createMemo(() => {
    const status = auth.status();
    return status.state === "connected" ? status : undefined;
  });
  return (
    <Loading fallback={<LoadingState label="Checking your session" style={styles.loading} />}>
      <Show
        when={user()}
        keyed
        fallback={
          <Redirect
            href={signInUrl(
              `${location.pathname}${location.search}${location.hash}`,
              import.meta.env.BASE_URL,
            )}
            replace
            resolve={false}
          />
        }
      >
        {(user) => <App {...props} user={user} />}
      </Show>
    </Loading>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { mutations: { networkMode: "always" } },
});
const Router = createRouter({
  base: import.meta.env.BASE_URL,
  routes: [
    { path: "/sign-in", component: SignInRoute },
    {
      path: "/",
      component: AuthenticatedApp,
      children: [
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
    },
  ],
});

export function CloudApp() {
  return (
    <Loading fallback={null}>
      <QueryClientProvider client={queryClient}>
        <Router>{(props) => <AuthProvider>{props.children}</AuthProvider>}</Router>
      </QueryClientProvider>
    </Loading>
  );
}

const styles = stylex.create({
  loading: { minHeight: "100dvh", backgroundColor: colors.gray1 },
});
