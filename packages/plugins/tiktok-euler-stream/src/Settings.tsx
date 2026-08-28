import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { Show, createMemo, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState, initialClientState, type TransportMode } from "./Definition.ts";
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
  error: { color: colors.red10, fontSize: 12 },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly TikTokConfigure: (payload: {
      readonly username: string;
      readonly apiKey?: string;
      readonly mode: TransportMode;
    }) => Effect.Effect<void, unknown>;
    readonly TikTokSetEnabled: (payload: {
      readonly enabled: boolean;
    }) => Effect.Effect<void, unknown>;
    readonly TikTokClear: () => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const errorMessages = {
  "connection-failed":
    "Connection failed. Check that the creator is live, your network, and the selected Euler service's limits. Reconnect to retry.",
  "disconnect-failed":
    "The connection could not be fully closed. Check the runtime network and restart the project if necessary.",
  "invalid-payload":
    "An unsupported or invalid TikTok payload was rejected. The unofficial protocol may have changed.",
  "event-overflow": "Events were dropped because the runtime event queue is full.",
  "not-configured":
    "A valid creator username is required. Managed mode also requires an Euler WebSocket API key.",
  "creator-offline": "The managed provider reports that this creator is not live.",
  "authentication-failed":
    "The Euler WebSocket key is invalid or lacks managed-service permissions.",
  "provider-failed":
    "The managed Euler service could not fetch stream data or reported a server/room error.",
};

const Settings: Component<SettingsProps> = (props) => {
  const [username, setUsername] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [selectedMode, setSelectedMode] = createSignal<TransportMode | undefined>(undefined);
  const mode = createMemo(() => selectedMode() ?? props.state().mode);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const run = async (effect: Effect.Effect<void, unknown>) => {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      await Effect.runPromise(effect);
      setApiKey("");
      setUsername("");
      await props.onChanged();
      setSelectedMode(undefined);
    } catch {
      setError(
        "Unable to update TikTok settings. Check the creator username and service API key, then retry.",
      );
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
            props.rpc.TikTokConfigure({
              username: username() || props.state().username,
              mode: mode(),
              ...(apiKey() ? { apiKey: apiKey() } : {}),
            }),
          );
        }}
      >
        <label sx={styles.label}>
          Transport
          <select
            sx={[styles.input, styles.focus]}
            value={mode()}
            disabled={busy()}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === "connector" || value === "managed") setSelectedMode(value);
            }}
          >
            <option value="connector">Direct Connector (Euler Signing)</option>
            <option value="managed">Managed Euler WebSocket (Electron Service)</option>
          </select>
        </label>
        <label sx={styles.label}>
          Creator Username
          <input
            sx={[styles.input, styles.focus]}
            value={username()}
            placeholder={props.state().username || "@creator"}
            maxlength={25}
            disabled={busy()}
            onInput={(event) => setUsername(event.currentTarget.value)}
          />
        </label>
        <label sx={styles.label}>
          {mode() === "managed"
            ? "Euler WebSocket API Key (Required)"
            : "Euler Signing API Key (Optional)"}
          <input
            sx={[styles.input, styles.focus]}
            type="password"
            autocomplete="new-password"
            value={apiKey()}
            placeholder={
              props.state().apiKeyConfigured
                ? "Leave blank to keep the stored key"
                : mode() === "managed"
                  ? "Managed Euler WebSocket key"
                  : "Optional signing key"
            }
            maxlength={4096}
            disabled={busy()}
            onInput={(event) => setApiKey(event.currentTarget.value)}
          />
        </label>
        <p sx={styles.hint}>
          {mode() === "managed"
            ? "Connects to wss://ws.eulerstream.com using the Electron branch's service. An Euler key with managed WebSocket access is required; signing access alone is not equivalent. This mode exposes the branch's six events plus gift-streak updates."
            : "The direct connector uses Euler community signing limits without a key and exposes all 19 event nodes. It is not the managed WebSocket service."}{" "}
          Keys stay in engine storage, not client state; protect project files and backups. Saving
          reconnects only if already enabled. A blank key keeps the existing key when changing
          modes.
        </p>
        <Button type="submit" disabled={busy() || (!username() && !props.state().configured)}>
          Save Configuration
        </Button>
      </form>
      <p sx={styles.hint} role="status">
        Creator: {props.state().username || "Not configured"} | Connection: {props.state().status}
        {props.state().roomId ? ` | Room: ${props.state().roomId}` : ""}
        {` | Mode: ${props.state().mode}`}
        {props.state().apiKeyConfigured
          ? " | API key configured"
          : props.state().mode === "managed"
            ? " | API key required"
            : " | Community signing"}
      </p>
      <p sx={styles.hint}>
        Unofficial, read-only TikTok LIVE integration running on the server. TikTok can break this
        protocol without notice. No client-side automatic reconnect, offline polling, or
        authenticated chat sending.
      </p>
      <Show when={props.state().error}>
        <p sx={styles.error} role="alert">
          {errorMessages[props.state().error!]}
        </p>
      </Show>
      <div sx={styles.actions}>
        <Button
          disabled={
            busy() ||
            !props.state().configured ||
            (props.state().mode === "managed" && !props.state().apiKeyConfigured)
          }
          onClick={() =>
            void run(
              props.rpc.TikTokSetEnabled({
                enabled:
                  props.state().status !== "connected" && props.state().status !== "connecting",
              }),
            )
          }
        >
          {props.state().status === "connected" || props.state().status === "connecting"
            ? "Disconnect"
            : "Connect"}
        </Button>
        <Button
          disabled={busy() || !props.state().apiKeyConfigured}
          onClick={() =>
            void run(
              props.rpc.TikTokConfigure({
                username: props.state().username,
                mode: props.state().mode,
                apiKey: "",
              }),
            )
          }
        >
          Remove API Key
        </Button>
        <Button
          disabled={busy() || !props.state().configured}
          onClick={() => void run(props.rpc.TikTokClear())}
        >
          Clear Configuration
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
