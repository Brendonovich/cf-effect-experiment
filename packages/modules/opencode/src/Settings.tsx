import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, createSignal, type Component } from "solid-js";

import {
  ClientRpcs,
  ClientState,
  OAuthAttempt,
  type Target,
  initialClientState,
} from "./Definition.ts";
import module from "./Module.ts";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 12 },
  form: {
    backgroundColor: colors.gray3,
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 10,
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
    minHeight: 32,
    padding: "6px 8px",
    resize: "vertical",
  },
  focus: {
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
    outline: "none",
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 8 },
  hint: { color: colors.gray11, fontSize: 12, margin: 0 },
  connection: {
    alignItems: "center",
    display: "flex",
    gap: 8,
    justifyContent: "space-between",
  },
  link: { color: colors.execution },
  error: { color: colors.red10, fontSize: 12, margin: 0 },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly OpenCodeSetTarget: (target: Target) => Effect.Effect<void, unknown>;
    readonly OpenCodeConnectKey: (input: {
      readonly integrationID: string;
      readonly key: string;
    }) => Effect.Effect<void, unknown>;
    readonly OpenCodeRemoveCredential: (input: {
      readonly credentialID: string;
    }) => Effect.Effect<void, unknown>;
    readonly OpenCodeStartOAuth: (input: {
      readonly integrationID: string;
      readonly methodID: string;
    }) => Effect.Effect<typeof OAuthAttempt.Type, unknown>;
    readonly OpenCodeOAuthStatus: (input: {
      readonly integrationID: string;
      readonly attemptID: string;
    }) => Effect.Effect<
      | { readonly status: "pending" }
      | { readonly status: "complete" }
      | { readonly status: "failed"; readonly message: string }
      | { readonly status: "expired" },
      unknown
    >;
    readonly OpenCodeCompleteOAuth: (input: {
      readonly integrationID: string;
      readonly attemptID: string;
      readonly code: string;
    }) => Effect.Effect<void, unknown>;
    readonly OpenCodeCancelOAuth: (input: {
      readonly integrationID: string;
      readonly attemptID: string;
    }) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const targetLabel = (target: (typeof ClientState.Type)["target"]) =>
  target.type === "remote" ? `remote (${target.url})` : target.type;

const Settings: Component<SettingsProps> = (props) => {
  const [url, setUrl] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [config, setConfig] = createSignal("{}");
  const [integrationID, setIntegrationID] = createSignal("opencode");
  const [key, setKey] = createSignal("");
  const [attempt, setAttempt] = createSignal<typeof OAuthAttempt.Type>();
  const [code, setCode] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  const update = async (target: Target) => {
    if (pending()) return;
    setPending(true);
    setError("");
    try {
      await Effect.runPromise(props.rpc.OpenCodeSetTarget(target));
      setPassword("");
      await props.onChanged();
    } catch {
      setError("Unable to connect to that OpenCode target.");
    } finally {
      setPending(false);
    }
  };
  const mutate = async (effect: Effect.Effect<void, unknown>) => {
    if (pending()) return false;
    setPending(true);
    setError("");
    try {
      await Effect.runPromise(effect);
      await props.onChanged();
      return true;
    } catch {
      setError("Unable to update the OpenCode connection.");
      return false;
    } finally {
      setPending(false);
    }
  };
  const startOAuth = async (integrationID: string, methodID: string) => {
    if (pending()) return;
    setPending(true);
    setError("");
    try {
      setAttempt(
        await Effect.runPromise(props.rpc.OpenCodeStartOAuth({ integrationID, methodID })),
      );
      setCode("");
    } catch {
      setError("Unable to start OpenCode authorization.");
    } finally {
      setPending(false);
    }
  };
  const checkOAuth = async () => {
    const current = attempt();
    if (current === undefined || pending()) return;
    setPending(true);
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
      setPending(false);
    }
  };

  return (
    <div sx={styles.stack}>
      <p sx={styles.hint}>Current target: {targetLabel(props.state().target)}</p>
      <div sx={styles.actions}>
        <Button disabled={pending()} onClick={() => void update({ type: "default" })}>
          {props.state().defaultTarget === "managed" ? "Use Managed Default" : "Use Local OpenCode"}
        </Button>
      </div>
      <Show when={props.state().availableTargets.includes("remote")}>
        <form
          sx={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void update({ type: "remote", url: url().trim(), password: password() });
          }}
        >
          <strong>External OpenCode server</strong>
          <label sx={styles.label}>
            Server URL
            <input
              sx={[styles.input, styles.focus]}
              type="url"
              value={url()}
              placeholder="https://opencode.example.com"
              required
              disabled={pending()}
              onInput={(event) => setUrl(event.currentTarget.value)}
            />
          </label>
          <label sx={styles.label}>
            Server password
            <input
              sx={[styles.input, styles.focus]}
              type="password"
              autocomplete="new-password"
              value={password()}
              disabled={pending()}
              onInput={(event) => setPassword(event.currentTarget.value)}
            />
          </label>
          <Button type="submit" disabled={pending() || !url().trim()}>
            Connect External Server
          </Button>
        </form>
      </Show>
      <Show when={props.state().availableTargets.includes("managed")}>
        <form
          sx={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void update({ type: "managed", config: config() });
          }}
        >
          <strong>Managed OpenCode</strong>
          <label sx={styles.label}>
            OpenCode config JSON
            <textarea
              sx={[styles.input, styles.focus]}
              rows={6}
              value={config()}
              required
              disabled={pending()}
              onInput={(event) => setConfig(event.currentTarget.value)}
            />
          </label>
          <Button type="submit" disabled={pending() || !config().trim()}>
            Create Managed Instance
          </Button>
        </form>
      </Show>
      <Show when={props.state().oauthMethods.length > 0}>
        <section sx={styles.form}>
          <strong>Connect with OAuth</strong>
          <div sx={styles.actions}>
            <For each={props.state().oauthMethods}>
              {(method) => (
                <Button
                  disabled={pending() || attempt() !== undefined}
                  onClick={() => void startOAuth(method.integrationID, method.methodID)}
                >
                  {method.integrationName}: {method.label}
                </Button>
              )}
            </For>
          </div>
          <Show when={attempt()}>
            {(current) => (
              <div sx={styles.stack}>
                <a sx={styles.link} href={current().url} target="_blank" rel="noopener noreferrer">
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
                    disabled={pending()}
                    onInput={(event) => setCode(event.currentTarget.value)}
                  />
                </Show>
                <div sx={styles.actions}>
                  <Show when={current().mode === "code"}>
                    <Button
                      disabled={pending() || !code().trim()}
                      onClick={() =>
                        void mutate(
                          props.rpc.OpenCodeCompleteOAuth({
                            integrationID: current().integrationID,
                            attemptID: current().attemptID,
                            code: code(),
                          }),
                        ).then((completed) => completed && setAttempt(undefined))
                      }
                    >
                      Submit Code
                    </Button>
                  </Show>
                  <Button disabled={pending()} onClick={() => void checkOAuth()}>
                    Check Connection
                  </Button>
                  <Button
                    disabled={pending()}
                    onClick={() =>
                      void mutate(
                        props.rpc.OpenCodeCancelOAuth({
                          integrationID: current().integrationID,
                          attemptID: current().attemptID,
                        }),
                      ).then((cancelled) => cancelled && setAttempt(undefined))
                    }
                  >
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
          void mutate(
            props.rpc.OpenCodeConnectKey({
              integrationID: integrationID().trim(),
              key: key(),
            }),
          ).then((saved) => saved && setKey(""));
        }}
      >
        <strong>Connect with API key</strong>
        <label sx={styles.label}>
          Provider ID
          <input
            sx={[styles.input, styles.focus]}
            value={integrationID()}
            placeholder="opencode, anthropic, openai…"
            required
            disabled={pending()}
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
            required
            disabled={pending()}
            onInput={(event) => setKey(event.currentTarget.value)}
          />
        </label>
        <Button type="submit" disabled={pending() || !integrationID().trim() || !key()}>
          Connect Key
        </Button>
      </form>
      <For each={props.state().credentials}>
        {(credential) => (
          <div sx={styles.connection}>
            <span>
              {credential.integrationID}: {credential.label}
              {credential.active ? " (active)" : ""}
            </span>
            <Button
              disabled={pending()}
              onClick={() =>
                void mutate(props.rpc.OpenCodeRemoveCredential({ credentialID: credential.id }))
              }
            >
              Remove
            </Button>
          </div>
        )}
      </For>
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
