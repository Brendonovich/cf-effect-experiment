import {
  AccountMenu,
  Button,
  createEditorController,
  createStateMachine,
  CredentialSettings,
  RealtimeWorkspace,
  macrographLogo,
} from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { createSignal, For, onSettled, Show } from "solid-js";
import discoveredPluginSettings from "virtual:macrograph-plugin-settings";

import { editorConnection } from "./editorConnection";

const baseUrl = () => new URL(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/`, location.origin);
const sessionKey = "macrograph:self-hosted:session";

type AuthUser = {
  readonly userId: string;
  readonly email: string;
};

type AuthContext =
  | { readonly session: null; readonly user: null }
  | { readonly session: string; readonly user: AuthUser | null };

type AuthMode =
  | { readonly status: "idle" }
  | { readonly status: "checking"; readonly session: string }
  | { readonly status: "signing-in" };

type AuthState = {
  context: AuthContext;
  mode: AuthMode;
};

const localUserId = () => {
  const stored = localStorage.getItem("macrograph:self-hosted:user");
  if (stored !== null) return stored;
  const created = crypto.randomUUID();
  localStorage.setItem("macrograph:self-hosted:user", created);
  return created;
};

const styles = stylex.create({
  root: {
    backgroundColor: colors.gray1,
    color: colors.gray12,
    colorScheme: "dark",
    display: "flex",
    flexDirection: "column",
    fontSize: 14,
    height: "100vh",
    overflow: "hidden",
    width: "100vw",
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "grid",
    gridTemplateColumns: { default: "1fr auto", "@media (min-width: 600px)": "1fr auto 1fr" },
    flexShrink: 0,
    columnGap: 8,
    minHeight: 44,
    paddingInline: 12,
  },
  brand: { display: "flex", alignItems: "center", gap: 8, minHeight: 44 },
  logo: { borderRadius: 6, height: 28, width: 28 },
  title: { fontWeight: 600, letterSpacing: "-0.025em" },
  nav: {
    display: "flex",
    alignSelf: "stretch",
    justifySelf: "center",
    gridColumn: { default: "1 / -1", "@media (min-width: 600px)": "2" },
    gridRowStart: { default: 2, "@media (min-width: 600px)": 1 },
  },
  navItem: {
    borderBottomStyle: "solid",
    borderBottomWidth: 2,
    paddingBlock: 8,
    paddingInline: 16,
    fontSize: 12,
    fontWeight: 500,
    textTransform: "capitalize",
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    cursor: "pointer",
  },
  navActive: { borderBottomColor: colors.focus, color: colors.gray12 },
  navIdle: {
    borderBottomColor: "transparent",
    color: { default: colors.gray10, ":hover": colors.gray12 },
  },
  account: { justifySelf: "end", gridRowStart: 1, gridColumnStart: -2 },
  main: { flex: 1, minHeight: 0 },
});

export function App() {
  const [view, setView] = createSignal<"editor" | "events">("editor");
  const storedSession = localStorage.getItem(sessionKey);
  const initialAuth: AuthState = {
    context:
      storedSession === null
        ? { session: null, user: null }
        : { session: storedSession, user: null },
    mode:
      storedSession === null ? { status: "idle" } : { status: "checking", session: storedSession },
  };
  const [auth, authActions] = createStateMachine(initialAuth, {
    startSignIn(state) {
      state.mode = { status: "signing-in" };
    },
    finishSignIn(state) {
      if (state.mode.status === "signing-in") state.mode = { status: "idle" };
    },
    startSessionCheck(state, session: string) {
      state.mode = { status: "checking", session };
    },
    confirmSession(state, session: string, user: AuthUser) {
      if (state.mode.status !== "checking" || state.mode.session !== session) return;
      state.context = { session, user };
      state.mode = { status: "idle" };
    },
    invalidateSession(state, session: string) {
      if (state.mode.status !== "checking" || state.mode.session !== session) return;
      state.context = { session: null, user: null };
      state.mode = { status: "idle" };
    },
    signOut(state) {
      state.context = { session: null, user: null };
      state.mode = { status: "idle" };
    },
  });
  const rpcUrl = () => {
    const url = new URL("rpc-ws", baseUrl());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const token = auth.context.session;
    if (token !== null) url.searchParams.set("session", token);
    return url.href;
  };
  const refreshSession = async (token = auth.context.session) => {
    if (token === null) {
      authActions.signOut();
      return;
    }
    const response = await fetch(new URL("auth/session", baseUrl()), {
      headers: { authorization: `Bearer ${token}` },
    });
    const state = (await response.json()) as {
      readonly user: AuthUser | null;
    };
    if (auth.mode.status !== "checking" || auth.mode.session !== token) return;
    if (state.user === null) {
      if (localStorage.getItem(sessionKey) === token) localStorage.removeItem(sessionKey);
      authActions.invalidateSession(token);
      return;
    }
    authActions.confirmSession(token, state.user);
  };
  onSettled(() => void refreshSession());

  const signIn = async () => {
    const authorizationWindow = window.open("about:blank", "macrograph-client-sign-in");
    authActions.startSignIn();
    try {
      const started = await fetch(new URL("auth/start", baseUrl()), { method: "POST" });
      const authorization = (await started.json()) as {
        readonly deviceCode?: string;
        readonly verificationUrl?: string;
        readonly error?: string;
      };
      if (
        !started.ok ||
        authorization.deviceCode === undefined ||
        authorization.verificationUrl === undefined
      )
        throw new Error(authorization.error ?? "Could not start MacroGraph sign in");
      if (authorizationWindow !== null) {
        authorizationWindow.opener = null;
        authorizationWindow.location.replace(authorization.verificationUrl);
      }
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        if (auth.mode.status !== "signing-in") return;
        const response = await fetch(new URL("auth/poll", baseUrl()), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceCode: authorization.deviceCode }),
        });
        const result = (await response.json()) as {
          readonly state?: "pending" | "connected";
          readonly token?: string;
          readonly error?: string;
        };
        if (auth.mode.status !== "signing-in") return;
        if (!response.ok) throw new Error(result.error ?? "MacroGraph sign in failed");
        if (result.state === "pending") continue;
        if (result.state !== "connected" || result.token === undefined)
          throw new Error("MacroGraph returned an invalid sign in response");
        localStorage.setItem(sessionKey, result.token);
        authActions.startSessionCheck(result.token);
        await refreshSession(result.token);
        return;
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "MacroGraph sign in failed");
    } finally {
      authorizationWindow?.close();
      authActions.finishSignIn();
    }
  };

  const signOut = async () => {
    const token = auth.context.session;
    localStorage.removeItem(sessionKey);
    authActions.signOut();
    if (token !== null)
      await fetch(new URL("auth/session", baseUrl()), {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
  };

  const rootAttrs = stylex.attrs(styles.root);

  return (
    <div {...rootAttrs}>
      <header sx={styles.header}>
        <div sx={styles.brand}>
          <img src={macrographLogo} alt="MacroGraph" sx={styles.logo} />
          <span sx={styles.title}>MacroGraph</span>
        </div>
        <nav sx={styles.nav} aria-label="Workspace">
          <For each={["editor", "events"] as const}>
            {(tab) => (
              <button
                type="button"
                sx={[styles.navItem, view() === tab ? styles.navActive : styles.navIdle]}
                aria-current={view() === tab ? "page" : undefined}
                onClick={() => setView(tab)}
              >
                {tab}
              </button>
            )}
          </For>
        </nav>
        <div sx={styles.account}>
          <Show
            when={auth.context.user}
            fallback={
              <Button
                type="button"
                size="sm"
                disabled={auth.mode.status === "signing-in"}
                onClick={() => void signIn()}
              >
                {auth.mode.status === "signing-in" ? "Signing in..." : "Sign in"}
              </Button>
            }
          >
            {(activeUser) => (
              <AccountMenu email={activeUser().email} onSignOut={() => void signOut()} />
            )}
          </Show>
        </div>
      </header>
      <main sx={styles.main}>
        <Show when={rpcUrl()} keyed>
          {(url) => {
            const controller = createEditorController({
              connection: editorConnection(url, discoveredPluginSettings),
              workspaceId: new URL(url).pathname,
              settingsDescriptors: discoveredPluginSettings,
              userId: localUserId(),
              reconnect: true,
            });
            return (
              <RealtimeWorkspace
                controller={controller}
                runtimeLabel="Server"
                view={view()}
                renderProjectSettings={(context) => (
                  <CredentialSettings
                    client={context.client}
                    description={
                      <>
                        Authorize this server to use credentials managed by macrograph.app. Provider
                        tokens remain on the server and are not stored in project data.
                      </>
                    }
                    loadingLabel="Loading server authorization..."
                    onChanged={context.refreshPluginData}
                  />
                )}
              />
            );
          }}
        </Show>
      </main>
    </div>
  );
}
