import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { Show, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState } from "./Definition.ts";
import UtilitiesPlugin from "./Plugin.ts";

const styles = stylex.create({
  panel: {
    backgroundColor: "var(--gray-3)",
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
  },
  row: { alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12 },
  details: { flex: 1 },
  heading: { color: "var(--gray-12)", fontSize: 14, fontWeight: 500, margin: 0 },
  text: { color: "var(--gray-11)", fontSize: 12, margin: 0 },
  error: { color: "var(--red-10)", fontSize: 12, margin: 0 },
  button: {
    backgroundColor: { default: "var(--gray-4)", ":hover": "var(--gray-5)" },
    border: 0,
    borderRadius: 2,
    color: "var(--gray-12)",
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 600,
    height: 32,
    opacity: { default: 1, ":disabled": 0.5 },
    paddingInline: 12,
  },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly StartTick: () => Effect.Effect<void, unknown>;
    readonly StopTick: () => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");

  const toggle = async () => {
    if (pending()) return;
    setPending(true);
    setError("");
    try {
      await Effect.runPromise(props.state().running ? props.rpc.StopTick() : props.rpc.StartTick());
      await props.onChanged();
    } catch {
      setError("Could not update the Tick engine. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section {...stylex.attrs(styles.panel)}>
      <div {...stylex.attrs(styles.row)}>
        <div {...stylex.attrs(styles.details)}>
          <h3 {...stylex.attrs(styles.heading)}>Tick engine</h3>
          <p {...stylex.attrs(styles.text)} role="status">
            {props.state().running ? "Running" : "Stopped"}
          </p>
        </div>
        <button
          type="button"
          {...stylex.attrs(styles.button)}
          disabled={pending()}
          onClick={() => void toggle()}
        >
          {props.state().running ? "Stop" : "Start"}
        </button>
      </div>
      <p {...stylex.attrs(styles.text)}>
        Emits a tick every second. Stopping pauses all Tick nodes; starting resumes the counter.
      </p>
      <Show when={error()}>
        <p {...stylex.attrs(styles.error)} role="alert">
          {error()}
        </p>
      </Show>
    </section>
  );
};

export default Settings;

export const settings = ClientSettings.make({
  plugin: UtilitiesPlugin,
  state: ClientState,
  initial: { running: false },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p {...stylex.attrs(styles.error)}>Plugin settings state is unavailable.</p>,
});
