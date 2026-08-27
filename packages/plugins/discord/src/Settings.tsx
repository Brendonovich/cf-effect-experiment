import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { Show, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState, initialClientState } from "./Definition.ts";
import plugin from "./Plugin.ts";

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
  actions: { display: "flex", flexWrap: "wrap", gap: 8 },
  hint: { color: colors.gray11, fontSize: 12 },
  check: { color: colors.gray12, display: "flex", alignItems: "center", gap: 8, fontSize: 12 },
  error: { color: colors.red10, fontSize: 12 },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly DiscordConfigure: (payload: {
      readonly token: string;
      readonly gatewayEnabled: boolean;
      readonly messageContent: boolean;
    }) => Effect.Effect<void, unknown>;
    readonly DiscordSetGateway: (payload: {
      readonly enabled: boolean;
      readonly messageContent: boolean;
    }) => Effect.Effect<void, unknown>;
    readonly DiscordClear: () => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [token, setToken] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const run = async (effect: Effect.Effect<void, unknown>, clearInput = false) => {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      await Effect.runPromise(effect);
      if (clearInput) setToken("");
      await props.onChanged();
    } catch {
      setError("Unable to update Discord settings. Check the token and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div sx={styles.stack}>
      <form
        sx={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            props.rpc.DiscordConfigure({
              token: token(),
              gatewayEnabled: true,
              messageContent: props.state().messageContent,
            }),
            true,
          );
        }}
      >
        <label sx={styles.label}>
          Bot Token
          <input
            sx={[styles.input, styles.focus]}
            type="password"
            autocomplete="new-password"
            value={token()}
            placeholder={
              props.state().configured ? "Enter a replacement token" : "Discord bot token"
            }
            maxlength={4096}
            required
            disabled={busy()}
            onInput={(event) => setToken(event.currentTarget.value)}
          />
        </label>
        <p sx={styles.hint}>
          The token is stored privately on the engine and is never returned to this settings page.
          Saving starts the gateway.
        </p>
        <Button type="submit" disabled={busy() || !token()}>
          Save Token And Connect
        </Button>
      </form>
      <label sx={styles.check}>
        <input
          type="checkbox"
          checked={props.state().messageContent}
          disabled={busy()}
          onChange={(event) => {
            void run(
              props.rpc.DiscordSetGateway({
                enabled: props.state().gatewayEnabled,
                messageContent: event.currentTarget.checked,
              }),
            );
          }}
        />{" "}
        Request Message Content Intent
      </label>
      <p sx={styles.hint}>
        Guild and direct-message intents are requested. Enable the privileged MESSAGE_CONTENT intent
        in the Discord developer portal as well to receive guild message text. Without it, Discord
        limits content to exceptions such as DMs and mentions. Changing this option restarts the
        gateway.
      </p>
      <p sx={styles.hint} role="status">
        {props.state().configured ? "Token configured" : "No token configured"} | Gateway:{" "}
        {props.state().status}
      </p>
      <Show when={props.state().error}>
        <p sx={styles.error}>
          Gateway error: {props.state().error}. Check the token, permissions and intents, then
          reconnect.
        </p>
      </Show>
      <div sx={styles.actions}>
        <Button
          disabled={busy() || !props.state().configured}
          onClick={() =>
            void run(
              props.rpc.DiscordSetGateway({
                enabled:
                  props.state().status !== "connected" && props.state().status !== "connecting",
                messageContent: props.state().messageContent,
              }),
            )
          }
        >
          {props.state().status === "connected" || props.state().status === "connecting"
            ? "Disconnect"
            : "Connect"}
        </Button>
        <Button
          disabled={busy() || !props.state().configured}
          onClick={() => void run(props.rpc.DiscordClear(), true)}
        >
          Remove Token
        </Button>
      </div>
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
  plugin,
  state: ClientState,
  initial: initialClientState,
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.error}>Plugin settings state is unavailable.</p>,
});
