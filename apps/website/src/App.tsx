import { createRouter, useLocation, type RouterHistory } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { Loading, Show, untrack } from "solid-js";

import { loginPath } from "./api";
import { DesktopListener } from "./DesktopListener";
import { AccountLayout } from "./routes/Account";
import { AuthRoute } from "./routes/Auth";
import { CredentialsRoute } from "./routes/Credentials";
import { DeviceAuthorizationRoute } from "./routes/DeviceAuthorization";
import { LandingRoute } from "./routes/Landing";
import { NotFoundRoute } from "./routes/NotFound";
import { ServersRoute } from "./routes/Servers";
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
  { path: "/login/device", component: () => <DeviceAuthorizationRoute flow="device" /> },
  {
    path: "/server-registration",
    component: () => <DeviceAuthorizationRoute flow="server-registration" />,
  },
  {
    path: "/account",
    component: AccountLayout,
    children: [
      { path: "/", component: () => <Redirect href="/account/credentials" /> },
      { path: "/credentials", component: CredentialsRoute },
      { path: "/servers", component: ServersRoute },
    ],
  },
  { path: "/credentials", component: () => <Redirect href="/account/credentials" /> },
  { path: "*404", component: NotFoundRoute },
];

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
