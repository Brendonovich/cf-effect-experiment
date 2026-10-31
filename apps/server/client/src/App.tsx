import type { ApiKeyClient, ApiKeySummary, CreatedApiKey } from "@macrograph/editor-ui";

import { randomUUID } from "@macrograph/editor";
import {
  AccountMenu,
  ApiKeySettings,
  Button,
  createEditorController,
  CredentialSettings,
  RealtimeWorkspace,
  ModulesAdminView,
  ServerHeader,
  ServerSetupApproval,
  ServerSetupCard,
  ServerSetupConnecting,
  ServerSetupForm,
  PresenceList,
} from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { createMemo, createSignal, onCleanup, onSettled, Show, untrack } from "solid-js";

import { editorConnection, editorModules, type ModuleAdminConnection } from "./editorConnection";

const baseUrl = () => new URL(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/`, location.origin);
const sessionKey = "macrograph:self-hosted:session";

type AuthUser = {
  readonly userId: string;
  readonly email: string;
};

type AuthContext =
  | { readonly session: null; readonly user: null }
  | { readonly session: string; readonly user: AuthUser | null };

const apiKeyClient = (session: string): ApiKeyClient => {
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(new URL(path, baseUrl()), {
      ...init,
      headers: {
        authorization: `Bearer ${session}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
      throw new Error(body.error ?? "The API key request failed");
    }
    return response;
  };
  return {
    list: async () => {
      const body = (await (await request("auth/api-keys")).json()) as {
        readonly keys: ReadonlyArray<ApiKeySummary>;
      };
      return body.keys;
    },
    create: async (name) =>
      (await (
        await request("auth/api-keys", { method: "POST", body: JSON.stringify({ name }) })
      ).json()) as CreatedApiKey,
    revoke: async (id) => {
      await request(`auth/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
  };
};

const localUserId = () => {
  const stored = localStorage.getItem("macrograph:self-hosted:user");
  if (stored !== null) return stored;
  const created = randomUUID();
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
  main: { flex: 1, minHeight: 0 },
  setupPage: { display: "flex", flex: 1, minHeight: 0, overflowY: "auto", padding: 24 },
  description: { color: colors.gray11, lineHeight: 1.6, margin: 0, overflowWrap: "anywhere" },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 },
  error: { color: colors.red11, lineHeight: 1.5, margin: 0, overflowWrap: "anywhere" },
  link: { color: colors.gray12, textDecoration: "underline", textUnderlineOffset: 3 },
  authNotice: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: 12 },
});

export function App() {
  const [view, setView] = createSignal<"editor" | "events">("editor");
  const [auth, setAuth] = createSignal<AuthContext>({ session: null, user: null });
  const [setupRequired, setSetupRequired] = createSignal<boolean | null>(null);
  const [canEdit, setCanEdit] = createSignal(false);
  const [sessionError, setSessionError] = createSignal<string | null>(null);
  // Setup links printed in the server logs carry the key in the URL fragment.
  const linkedSetupKey = new URLSearchParams(location.hash.slice(1)).get("setup-key")?.trim() ?? "";
  if (linkedSetupKey !== "") history.replaceState(null, "", location.pathname + location.search);
  const [setupKey, setSetupKey] = createSignal(linkedSetupKey);
  const [signingIn, setSigningIn] = createSignal(false);
  const [verificationUrl, setVerificationUrl] = createSignal<string | null>(null);
  const [userCode, setUserCode] = createSignal<string | null>(null);
  const [approvalError, setApprovalError] = createSignal<string | null>(null);
  let operation: AbortController | undefined;
  const startOperation = () => {
    operation?.abort();
    operation = new AbortController();
    return operation;
  };
  onCleanup(() => operation?.abort());
  const rpcUrl = () => {
    const url = new URL("rpc-ws", baseUrl());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const token = auth().session;
    if (token !== null) url.searchParams.set("session", token);
    return url.href;
  };
  const refreshSession = async (
    token = localStorage.getItem(sessionKey),
    signal = startOperation().signal,
  ) => {
    setSetupRequired(null);
    setSessionError(null);
    try {
      const response = await fetch(new URL("auth/session", baseUrl()), {
        headers: token === null ? {} : { authorization: `Bearer ${token}` },
        signal,
      });
      const state = (await response.json()) as {
        readonly user: AuthUser | null;
        readonly canEdit: boolean;
        readonly setupRequired: boolean;
        readonly hasOwner: boolean;
        readonly error?: string;
      };
      if (signal.aborted) return;
      if (!response.ok) throw new Error(state.error ?? "Could not check server status");
      if (
        typeof state.setupRequired !== "boolean" ||
        typeof state.hasOwner !== "boolean" ||
        typeof state.canEdit !== "boolean" ||
        (state.user !== null &&
          (typeof state.user?.userId !== "string" || typeof state.user?.email !== "string"))
      )
        throw new Error("MacroGraph returned an invalid server status");
      if (state.user === null || token === null) {
        if (token !== null && localStorage.getItem(sessionKey) === token)
          localStorage.removeItem(sessionKey);
        setAuth({ session: null, user: null });
      } else {
        setAuth({ session: token, user: state.user });
      }
      setCanEdit(state.canEdit);
      setSetupRequired(state.setupRequired);
    } catch (error) {
      if (!signal.aborted)
        setSessionError(error instanceof Error ? error.message : "Could not check server status");
    }
  };
  onSettled(() => void refreshSession());

  // Switch to the setup guide if the server lost its MacroGraph connection while this page was open.
  const recheckSetup = async () => {
    if (setupRequired() !== false || signingIn()) return;
    try {
      const response = await fetch(new URL("auth/session", baseUrl()));
      const state = (await response.json()) as { readonly setupRequired?: unknown };
      if (response.ok && state.setupRequired === true && !signingIn()) void refreshSession();
    } catch {
      // Keep the current view; the next check or sign in attempt will update it.
    }
  };
  const recheckWhenVisible = () => {
    if (document.visibilityState === "visible") void recheckSetup();
  };
  window.addEventListener("focus", recheckWhenVisible);
  document.addEventListener("visibilitychange", recheckWhenVisible);
  onCleanup(() => {
    window.removeEventListener("focus", recheckWhenVisible);
    document.removeEventListener("visibilitychange", recheckWhenVisible);
  });

  const cancelSignIn = () => {
    operation?.abort();
    setSigningIn(false);
    setVerificationUrl(null);
    setUserCode(null);
  };
  const signIn = async (key?: string) => {
    const { signal } = startOperation();
    const setup = key !== undefined;
    const endpoint = setup ? "auth/setup" : "auth";
    const authorizationWindow = window.open("about:blank", "macrograph-client-sign-in");
    const closeWindow = () => {
      clearTimeout(timeout);
      authorizationWindow?.close();
    };
    signal.addEventListener("abort", closeWindow, { once: true });
    setSigningIn(true);
    setApprovalError(null);
    setVerificationUrl(null);
    setUserCode(null);
    const timeout = setTimeout(() => {
      if (signal.aborted) return;
      cancelSignIn();
      setApprovalError("Approval timed out. Please try again.");
    }, 10 * 60_000);
    try {
      const started = await fetch(new URL(`${endpoint}/start`, baseUrl()), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: setup ? JSON.stringify({ key }) : null,
        signal,
      });
      const authorization = (await started.json()) as {
        readonly state?: "pending";
        readonly deviceCode?: string;
        readonly userCode?: string;
        readonly verificationUrl?: string;
        readonly error?: string;
      };
      if (signal.aborted) return;
      if (
        !started.ok ||
        (setup ? authorization.state !== "pending" : !authorization.deviceCode) ||
        !authorization.verificationUrl
      )
        throw new Error(authorization.error ?? "Could not start MacroGraph approval");
      setVerificationUrl(authorization.verificationUrl);
      setUserCode(authorization.userCode ?? null);
      if (authorizationWindow !== null) {
        authorizationWindow.opener = null;
        authorizationWindow.location.replace(authorization.verificationUrl);
      }
      while (!signal.aborted) {
        await new Promise<void>((resolve) => {
          const cancel = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", cancel);
            resolve();
          }, 3_000);
          signal.addEventListener("abort", cancel, { once: true });
        });
        if (signal.aborted) return;
        const response = await fetch(new URL(`${endpoint}/poll`, baseUrl()), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(setup ? { key } : { deviceCode: authorization.deviceCode }),
          signal,
        });
        const result = (await response.json()) as {
          readonly state?: "pending" | "connected";
          readonly verificationUrl?: string;
          readonly token?: string;
          readonly error?: string;
        };
        if (signal.aborted) return;
        if (!response.ok) throw new Error(result.error ?? "MacroGraph approval failed");
        if (result.state === "pending") {
          if (result.verificationUrl) setVerificationUrl(result.verificationUrl);
          continue;
        }
        if (result.state !== "connected" || !result.token)
          throw new Error("MacroGraph returned an invalid sign in response");
        clearTimeout(timeout);
        localStorage.setItem(sessionKey, result.token);
        setSetupKey("");
        await refreshSession(result.token, signal);
        return;
      }
    } catch (error) {
      if (!signal.aborted)
        setApprovalError(error instanceof Error ? error.message : "MacroGraph approval failed");
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", closeWindow);
      closeWindow();
      if (!signal.aborted) {
        setSigningIn(false);
        setVerificationUrl(null);
        setUserCode(null);
      }
    }
  };

  const signOut = async () => {
    const token = auth().session;
    const { signal } = startOperation();
    localStorage.removeItem(sessionKey);
    setAuth({ session: null, user: null });
    setApprovalError(null);
    try {
      if (token !== null) {
        const response = await fetch(new URL("auth/session", baseUrl()), {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}` },
          signal,
        });
        if (!response.ok) throw new Error("Could not revoke the server session");
      }
    } catch {
      if (!signal.aborted)
        setApprovalError("Signed out locally, but the server session could not be revoked.");
    }
  };

  // Only the owner and admins may manage API keys; the server enforces this too.
  const keyClient = createMemo(() => {
    const session = auth().session;
    return session !== null && canEdit() ? apiKeyClient(session) : null;
  });

  const rootAttrs = stylex.attrs(styles.root);
  const ApprovalError = () => (
    <Show when={approvalError()}>
      <p sx={styles.error} role="alert">
        {approvalError()}
      </p>
    </Show>
  );
  const ApprovalStatus = () => (
    <>
      <ApprovalError />
      <Show when={signingIn()}>
        <div sx={styles.actions}>
          <span sx={styles.description} role="status">
            Waiting for approval on macrograph.app
            <Show when={userCode()}>{(code) => <> · {code()}</>}</Show>
          </span>
          <Show when={verificationUrl()}>
            {(url) => (
              <a href={url()} target="_blank" rel="noopener noreferrer" sx={styles.link}>
                Open
              </a>
            )}
          </Show>
          <Button type="button" variant="text" onClick={cancelSignIn}>
            Cancel
          </Button>
        </div>
      </Show>
    </>
  );

  return (
    <div {...rootAttrs}>
      <Show
        when={setupRequired() === false}
        fallback={
          <main sx={styles.setupPage}>
            <ServerSetupCard>
              <Show
                when={setupRequired() === true}
                fallback={
                  <ServerSetupConnecting
                    error={sessionError()}
                    onRetry={() => void refreshSession()}
                  />
                }
              >
                <Show
                  when={signingIn()}
                  fallback={
                    <ServerSetupForm
                      setupKey={setupKey()}
                      onSetupKeyInput={setSetupKey}
                      showKeyInput={linkedSetupKey === "" || approvalError() !== null}
                      error={approvalError()}
                      onSubmit={(key) => void signIn(key)}
                    />
                  }
                >
                  <ServerSetupApproval
                    userCode={userCode()}
                    verificationUrl={verificationUrl()}
                    onCancel={cancelSignIn}
                  />
                </Show>
              </Show>
            </ServerSetupCard>
          </main>
        }
      >
        <Show when={rpcUrl()} keyed>
          {(url) => {
            const [moduleAdmin, setModuleAdmin] = createSignal<ModuleAdminConnection | null>(null);
            const controller = createEditorController({
              connection: editorConnection(url, {
                baseUrl: baseUrl(),
                token: () => untrack(auth).session,
              }).pipe(
                Effect.tap((connection) =>
                  Effect.sync(() => setModuleAdmin(() => connection.moduleAdmin)),
                ),
              ),
              workspaceId: new URL(url).pathname,
              modules: editorModules(),
              userId: localUserId(),
              reconnect: true,
              projectSettings: true,
            });
            return (
              <>
                <ServerHeader view={view()} onViewChange={setView}>
                  <PresenceList controller={controller} onFollow={() => setView("editor")} />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setView("editor");
                      controller.openProjectSettings();
                    }}
                  >
                    Settings
                  </Button>
                  <Show
                    when={auth().user}
                    fallback={
                      <Button
                        type="button"
                        size="sm"
                        disabled={signingIn()}
                        onClick={() => void signIn()}
                      >
                        {signingIn() ? "Signing in..." : "Sign in"}
                      </Button>
                    }
                  >
                    {(activeUser) => (
                      <AccountMenu email={activeUser().email} onSignOut={() => void signOut()} />
                    )}
                  </Show>
                </ServerHeader>
                <Show when={signingIn() || approvalError()}>
                  <div sx={styles.authNotice}>
                    <ApprovalStatus />
                  </div>
                </Show>
                <main sx={styles.main}>
                  <RealtimeWorkspace
                    controller={controller}
                    runtimeLabel="Server"
                    view={view()}
                    renderProjectSettings={(context) => (
                      <>
                        <CredentialSettings
                          client={context.client}
                          description={
                            <>
                              Authorize this server to use credentials managed by macrograph.app.
                              Provider tokens remain on the server and are not stored in project
                              data.
                            </>
                          }
                          loadingLabel="Loading server authorization..."
                          onChanged={context.refreshModuleData}
                        />
                        <ApiKeySettings
                          client={keyClient()}
                          mcpUrl={new URL("api/mcp", baseUrl()).href}
                          restUrl={new URL("api", baseUrl()).href}
                        />
                        {/* Only admins manage modules; the server enforces this too. */}
                        <Show when={canEdit() ? moduleAdmin() : null}>
                          {(client) => (
                            <ModulesAdminView
                              client={client()}
                              subscribeModulesChanged={(listener) =>
                                controller.connection.moduleCatalog.onChange(() =>
                                  listener({ _tag: "ModulesChanged" }),
                                )
                              }
                            />
                          )}
                        </Show>
                      </>
                    )}
                  />
                </main>
              </>
            );
          }}
        </Show>
      </Show>
    </div>
  );
}
