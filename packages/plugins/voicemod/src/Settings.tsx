import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { Show, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState, initialStorage } from "./Definition.ts";
import plugin from "./Plugin.ts";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 12 },
  form: {
    backgroundColor: colors.gray3,
    borderRadius: 6,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 12,
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
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    color: colors.gray11,
    fontSize: 12,
  },
  button: {
    backgroundColor: { default: colors.gray12, ":hover": colors.gray11, ":disabled": colors.gray6 },
    border: 0,
    borderRadius: 2,
    color: colors.gray1,
    fontSize: 12,
    fontWeight: 600,
    height: 32,
    paddingInline: 12,
  },
  muted: { color: colors.gray11, fontSize: 12, margin: 0 },
  status: { color: colors.gray12, fontSize: 12 },
  error: { color: colors.red10, fontSize: 12 },
});
export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly VoicemodConfigure: (payload: {
      url: string;
      connectOnStartup: boolean;
      clientKey?: string;
    }) => Effect.Effect<void, unknown>;
    readonly VoicemodConnect: () => Effect.Effect<void, unknown>;
    readonly VoicemodDisconnect: () => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}
const Settings: Component<SettingsProps> = (props) => {
  const [url, setUrl] = createSignal<string>();
  const [startup, setStartup] = createSignal<boolean>();
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const run = async (effect: Effect.Effect<void, unknown>) => {
    setBusy(true);
    setError("");
    await Effect.runPromise(effect)
      .then(() => props.onChanged())
      .catch(() =>
        setError(
          "Operation failed. Check the local URL, your Voicemod registration key, and that Voicemod is running.",
        ),
      );
    setBusy(false);
  };
  return (
    <div sx={styles.stack}>
      <p sx={styles.muted}>
        Connect to Voicemod on this server's machine. Supply your own Control API client
        registration key from Voicemod. No shared key is bundled. The key is omitted from settings
        state, but administrative project exports can include engine secrets.
      </p>
      <form
        sx={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void run(
            props.rpc
              .VoicemodConfigure({
                url: url() ?? props.state().url,
                connectOnStartup: startup() ?? props.state().connectOnStartup,
                ...(key() === "" ? {} : { clientKey: key() }),
              })
              .pipe(Effect.tap(() => Effect.sync(() => setKey("")))),
          );
        }}
      >
        <label sx={styles.label}>
          Local WebSocket URL
          <input
            sx={[styles.focus, styles.input]}
            required
            value={url() ?? props.state().url}
            onInput={(event) => setUrl(event.currentTarget.value)}
          />
        </label>
        <label sx={styles.label}>
          Client Registration Key
          <input
            type="password"
            autocomplete="new-password"
            sx={[styles.focus, styles.input]}
            required={!props.state().hasClientKey}
            placeholder={
              props.state().hasClientKey
                ? "Configured; leave blank to keep"
                : "Your Voicemod client key"
            }
            value={key()}
            onInput={(event) => setKey(event.currentTarget.value)}
          />
        </label>
        <label sx={styles.row}>
          <input
            type="checkbox"
            checked={startup() ?? props.state().connectOnStartup}
            onChange={(event) => setStartup(event.currentTarget.checked)}
          />
          Connect on server startup
        </label>
        <button sx={[styles.focus, styles.button]} disabled={busy()} type="submit">
          Save Configuration
        </button>
      </form>
      <div sx={styles.row}>
        <span sx={styles.status} role="status">
          {props.state().state}
        </span>
        <button
          sx={[styles.focus, styles.button]}
          type="button"
          disabled={
            busy() ||
            !props.state().hasClientKey ||
            props.state().state === "connecting" ||
            props.state().state === "connected"
          }
          onClick={() => void run(props.rpc.VoicemodConnect())}
        >
          Connect
        </button>
        <button
          sx={[styles.focus, styles.button]}
          type="button"
          disabled={props.state().state === "disconnected"}
          onClick={() => void run(props.rpc.VoicemodDisconnect())}
        >
          Disconnect
        </button>
      </div>
      <Show when={error() || props.state().error}>
        {(message) => (
          <p role="alert" sx={styles.error}>
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
};
export default Settings;
export const settings = ClientSettings.make({
  plugin,
  state: ClientState,
  initial: {
    url: initialStorage.url,
    connectOnStartup: false,
    hasClientKey: false,
    state: "disconnected",
  },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.error}>Plugin settings state is unavailable.</p>,
});
