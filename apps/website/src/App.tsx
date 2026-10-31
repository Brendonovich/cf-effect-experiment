import { createRouter, useLocation, type RouterHistory } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { Loading, Show, untrack } from "solid-js";

import { loginPath } from "./api";
import { DesktopListener } from "./DesktopListener";
import { registerQueryClient } from "./queryState";
import { AccountLayout } from "./routes/Account";
import { AppsRoute } from "./routes/Apps";
import { AuthRoute } from "./routes/Auth";
import { CredentialsRoute } from "./routes/Credentials";
import { DeviceAuthorizationRoute } from "./routes/DeviceAuthorization";
import { LandingRoute } from "./routes/Landing";
import { NotFoundRoute } from "./routes/NotFound";
import { PlaygroundRoute } from "./routes/Playground";
import { Redirect, useSession } from "./session";
import { Toaster } from "./Toasts";

/** MacroGraph Desktop links to `/?promptLogin=true` to ask signed-out users to log in. */
function HomeRoute() {
  const location = useLocation();
  const session = useSession();
  const promptLogin = () => new URLSearchParams(location.search).has("promptLogin");
  return (
    <Show
      when={promptLogin() && !session.isPending && session.data === null}
      fallback={<LandingRoute />}
    >
      <Redirect href={loginPath("/")} />
    </Show>
  );
}

export const routes = [
  { path: "/", component: HomeRoute },
  { path: "/login", component: () => <AuthRoute mode="login" /> },
  { path: "/signup", component: () => <AuthRoute mode="signup" /> },
  { path: "/device", component: DeviceAuthorizationRoute },
  { path: "/playground", component: PlaygroundRoute },
  {
    path: "/account",
    component: AccountLayout,
    children: [
      { path: "/", component: () => <Redirect href="/account/credentials" /> },
      { path: "/credentials", component: CredentialsRoute },
      { path: "/apps", component: AppsRoute },
    ],
  },
  { path: "/credentials", component: () => <Redirect href="/account/credentials" /> },
  { path: "*404", component: NotFoundRoute },
];

/** The whole site; start mode renders it inside `Document` on the server and hydrates it. */
export function App(props: {
  readonly queryClient?: QueryClient;
  /** Overrides browser history, for tests. */
  readonly history?: RouterHistory;
}) {
  const history = untrack(() => props.history);
  const Router = createRouter(history === undefined ? { routes } : { routes, history });
  const queryClient =
    untrack(() => props.queryClient) ??
    new QueryClient({ defaultOptions: { mutations: { networkMode: "always" } } });
  registerQueryClient(queryClient);
  return (
    <Loading fallback={null}>
      <QueryClientProvider client={queryClient}>
        <Router>
          {(routeProps) => (
            <>
              {routeProps.children}
              <DesktopListener />
              <Toaster />
            </>
          )}
        </Router>
      </QueryClientProvider>
    </Loading>
  );
}

export default App;
