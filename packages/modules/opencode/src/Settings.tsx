import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { Show, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState, type Target, initialClientState } from "./Definition.ts";
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
  error: { color: colors.red10, fontSize: 12, margin: 0 },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly OpenCodeSetTarget: (target: Target) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const targetLabel = (target: (typeof ClientState.Type)["target"]) =>
  target.type === "remote" ? `remote (${target.url})` : target.type;

const Settings: Component<SettingsProps> = (props) => {
  const [url, setUrl] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [config, setConfig] = createSignal("{}");
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
