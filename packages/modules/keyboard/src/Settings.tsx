import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { Show, createSignal } from "solid-js";

import { ClientRpcs, ClientState } from "./Definition.ts";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 12 },
  checkbox: { alignItems: "center", color: colors.gray12, display: "flex", fontSize: 12, gap: 6 },
  error: { color: colors.red11, fontSize: 12, margin: 0, overflowWrap: "anywhere" },
  hint: { color: colors.gray11, fontSize: 12, margin: 0 },
  status: { color: colors.gray12, fontSize: 12, margin: 0 },
});

interface SettingsProps {
  readonly state: () => ClientState;
  readonly onChanged: () => Promise<void>;
  readonly rpc: {
    readonly KeyboardSetListening: (payload: { enabled: boolean }) => Effect.Effect<void, unknown>;
  };
}

function Settings(props: SettingsProps) {
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal("");

  const setListening = async (enabled: boolean) => {
    if (busy()) return;
    setBusy(true);
    setFailure("");
    try {
      await Effect.runPromise(props.rpc.KeyboardSetListening({ enabled }));
      await props.onChanged();
    } catch (error) {
      setFailure(
        typeof error === "object" && error !== null && "reason" in error
          ? String(error.reason)
          : error instanceof Error
            ? error.message
            : String(error),
      );
    } finally {
      setBusy(false);
    }
  };

  const status = () => {
    const state = props.state();
    if (state.listening) return "Listening";
    if (state.enabled && state.error === undefined) return "Starting…";
    return state.enabled ? "Not listening" : "Off";
  };

  return (
    <div sx={styles.stack}>
      <Show
        when={props.state().source === "global"}
        fallback={
          <p sx={styles.hint}>
            Responds to keys pressed while this tab is focused, except while typing in a text field.
          </p>
        }
      >
        <p sx={styles.hint}>
          Responds to keys pressed anywhere on the machine running the server, even when MacroGraph
          isn't focused. Graph editors can observe every key typed on that machine while this is on.
          On macOS, grant the server's process Accessibility permission in System Settings.
        </p>
      </Show>
      <label sx={styles.checkbox}>
        <input
          type="checkbox"
          checked={props.state().enabled}
          disabled={busy()}
          onChange={(event) => void setListening(event.currentTarget.checked)}
        />
        Listen to the keyboard
      </label>
      <p role="status" aria-live="polite" sx={styles.status}>
        {status()}
      </p>
      <Show when={failure() || props.state().error}>
        {(error) => <p sx={styles.error}>{error()}</p>}
      </Show>
    </div>
  );
}

export const settings = ClientSettings.make({
  state: ClientState,
  initial: { source: "browser", enabled: false, listening: false },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p>Keyboard settings state is unavailable.</p>,
});
