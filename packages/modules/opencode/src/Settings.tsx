import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState, initialClientState } from "./Definition.ts";
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
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [integrationID, setIntegrationID] = createSignal("opencode");
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const run = async (effect: Effect.Effect<void, unknown>, clearKey = false) => {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      await Effect.runPromise(effect);
      if (clearKey) setKey("");
      await props.onChanged();
    } catch {
      setError("Unable to update the OpenCode connection.");
    } finally {
      setBusy(false);
    }
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
