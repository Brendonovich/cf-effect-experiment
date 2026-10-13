import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState, OAuthAttempt, initialClientState } from "./Definition.ts";
import module from "./Module.ts";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 12 },
  form: {
    backgroundColor: colors.gray3,
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 12,
  },
  label: { color: colors.gray11, display: "flex", flexDirection: "column", fontSize: 12, gap: 4 },
  input: {
    backgroundColor: colors.gray2,
    border: 0,
    borderRadius: 2,
    boxShadow: `0 0 0 1px ${colors.gray6}`,
    color: colors.gray12,
    fontSize: 14,
    height: 32,
    paddingInline: 8,
    minWidth: 0,
  },
  focus: {
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
    outline: "none",
  },
  hint: { color: colors.gray11, fontSize: 12, margin: 0 },
  credential: {
    alignItems: "center",
    display: "flex",
    gap: 8,
    justifyContent: "space-between",
  },
  oauth: {
    backgroundColor: colors.gray3,
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 8 },
  link: { color: colors.execution },
  error: { color: colors.red10, fontSize: 12 },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly OpenCodeConnectKey: (payload: {
      readonly integrationID: string;
      readonly key: string;
    }) => Effect.Effect<void, unknown>;
    readonly OpenCodeRemoveCredential: (payload: {
      readonly credentialID: string;
    }) => Effect.Effect<void, unknown>;
    readonly OpenCodeStartOAuth: (payload: {
      readonly integrationID: string;
      readonly methodID: string;
    }) => Effect.Effect<typeof OAuthAttempt.Type, unknown>;
    readonly OpenCodeOAuthStatus: (payload: {
      readonly integrationID: string;
      readonly attemptID: string;
    }) => Effect.Effect<
      | { readonly status: "pending" }
      | { readonly status: "complete" }
      | { readonly status: "failed"; readonly message: string }
      | { readonly status: "expired" },
      unknown
    >;
    readonly OpenCodeCompleteOAuth: (payload: {
      readonly integrationID: string;
      readonly attemptID: string;
      readonly code: string;
    }) => Effect.Effect<void, unknown>;
    readonly OpenCodeCancelOAuth: (payload: {
      readonly integrationID: string;
      readonly attemptID: string;
    }) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [integrationID, setIntegrationID] = createSignal("opencode");
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [attempt, setAttempt] = createSignal<typeof OAuthAttempt.Type>();
  const [code, setCode] = createSignal("");
  const run = async (effect: Effect.Effect<void, unknown>, clearKey = false) => {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      await Effect.runPromise(effect);
      if (clearKey) setKey("");
      await props.onChanged();
      return true;
    } catch {
      setError("Unable to update the OpenCode connection.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const startOAuth = async (integrationID: string, methodID: string) => {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      const started = await Effect.runPromise(
        props.rpc.OpenCodeStartOAuth({ integrationID, methodID }),
      );
      setAttempt(started);
      setCode("");
    } catch {
      setError("Unable to start OpenCode authorization.");
    } finally {
      setBusy(false);
    }
  };
  const checkOAuth = async () => {
    const current = attempt();
    if (current === undefined || busy()) return;
    setBusy(true);
    setError("");
    try {
      const status = await Effect.runPromise(
        props.rpc.OpenCodeOAuthStatus({
          integrationID: current.integrationID,
          attemptID: current.attemptID,
        }),
      );
      if (status.status === "complete") {
        setAttempt(undefined);
        await props.onChanged();
      } else if (status.status === "failed") setError(status.message);
      else if (status.status === "expired") setError("Authorization expired. Start again.");
    } catch {
      setError("Unable to check OpenCode authorization.");
    } finally {
      setBusy(false);
    }
  };
  const completeOAuth = async () => {
    const current = attempt();
    if (current === undefined || busy()) return;
    const completed = await run(
      props.rpc.OpenCodeCompleteOAuth({
        integrationID: current.integrationID,
        attemptID: current.attemptID,
        code: code(),
      }),
    );
    if (completed) setAttempt(undefined);
  };
  const cancelOAuth = async () => {
    const current = attempt();
    if (current === undefined || busy()) return;
    const cancelled = await run(
      props.rpc.OpenCodeCancelOAuth({
        integrationID: current.integrationID,
        attemptID: current.attemptID,
      }),
    );
    if (cancelled) setAttempt(undefined);
  };

  return (
    <div sx={styles.stack}>
      <Show
        when={props.state().mode === "cloudflare"}
        fallback={
          <p sx={styles.hint}>
            This deployment uses the OpenCode service running under the server's user account.
            Manage models and credentials from OpenCode.
          </p>
        }
      >
        <Show when={props.state().oauthMethods.length > 0}>
          <section sx={styles.oauth}>
            <strong>Connect with OAuth</strong>
            <p sx={styles.hint}>
              Authorize OpenCode Console or another provider without sharing its token with
              MacroGraph.
            </p>
            <Show
              when={attempt()}
              fallback={
                <div sx={styles.actions}>
                  <For each={props.state().oauthMethods}>
                    {(method) => (
                      <Button
                        disabled={busy()}
                        onClick={() => void startOAuth(method.integrationID, method.methodID)}
                      >
                        {method.integrationName}: {method.label}
                      </Button>
                    )}
                  </For>
                </div>
              }
            >
              {(current) => (
                <div sx={styles.stack}>
                  <a
                    sx={styles.link}
                    href={current().url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Continue authorization
                  </a>
                  <Show when={current().instructions.length > 0}>
                    <p sx={styles.hint}>{current().instructions}</p>
                  </Show>
                  <Show when={current().mode === "code"}>
                    <input
                      sx={[styles.input, styles.focus]}
                      value={code()}
                      placeholder="Authorization code"
                      disabled={busy()}
                      onInput={(event) => setCode(event.currentTarget.value)}
                    />
                  </Show>
                  <div sx={styles.actions}>
                    <Show when={current().mode === "code"}>
                      <Button
                        disabled={busy() || !code().trim()}
                        onClick={() => void completeOAuth()}
                      >
                        Submit Code
                      </Button>
                    </Show>
                    <Button disabled={busy()} onClick={() => void checkOAuth()}>
                      Check Connection
                    </Button>
                    <Button disabled={busy()} onClick={() => void cancelOAuth()}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </Show>
          </section>
        </Show>
        <form
          sx={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              props.rpc.OpenCodeConnectKey({ integrationID: integrationID().trim(), key: key() }),
              true,
            );
          }}
        >
          <label sx={styles.label}>
            Provider ID
            <input
              sx={[styles.input, styles.focus]}
              value={integrationID()}
              placeholder="opencode, anthropic, openai…"
              required
              disabled={busy()}
              onInput={(event) => setIntegrationID(event.currentTarget.value)}
            />
          </label>
          <label sx={styles.label}>
            API key
            <input
              sx={[styles.input, styles.focus]}
              type="password"
              autocomplete="new-password"
              value={key()}
              maxlength={4096}
              required
              disabled={busy()}
              onInput={(event) => setKey(event.currentTarget.value)}
            />
          </label>
          <p sx={styles.hint}>
            Use provider ID <code>opencode</code> with an OpenCode Console service-account key. Keys
            are stored in this project's Durable Object and are never returned here.
          </p>
          <Button type="submit" disabled={busy() || !integrationID().trim() || !key()}>
            Connect
          </Button>
        </form>
        <For each={props.state().credentials}>
          {(credential) => (
            <div sx={styles.credential}>
              <span>
                {credential.integrationID}: {credential.label}
                {credential.active ? " (active)" : ""}
              </span>
              <Button
                disabled={busy()}
                onClick={() =>
                  void run(props.rpc.OpenCodeRemoveCredential({ credentialID: credential.id }))
                }
              >
                Remove
              </Button>
            </div>
          )}
        </For>
      </Show>
      <Show when={error()}>
        <p sx={styles.error} role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
};

export default Settings;
export const settings = ClientSettings.make({
  module,
  state: ClientState,
  initial: initialClientState,
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.error}>Module settings state is unavailable.</p>,
});
