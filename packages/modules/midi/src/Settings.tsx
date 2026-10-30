import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, createSignal } from "solid-js";

import { ClientRpcs, ClientState, type InputId } from "./Definition.ts";
import module from "./Module.ts";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 12 },
  heading: { color: colors.gray12, fontSize: 13, fontWeight: 600, margin: 0 },
  row: {
    alignItems: "center",
    borderBottom: `1px solid ${colors.gray6}`,
    display: "flex",
    gap: 8,
    justifyContent: "space-between",
    paddingBlock: 8,
  },
  name: { color: colors.gray12, fontSize: 12, overflowWrap: "anywhere" },
  checkbox: { alignItems: "center", color: colors.gray11, display: "flex", fontSize: 12, gap: 6 },
  detail: { color: colors.gray11, fontSize: 12, whiteSpace: "nowrap" },
  error: { color: colors.red11, fontSize: 12, overflowWrap: "anywhere" },
  hint: { color: colors.gray11, fontSize: 12, margin: 0 },
  status: { color: colors.gray12, fontSize: 12 },
});

interface SettingsProps {
  readonly state: () => ClientState;
  readonly onChanged: () => Promise<void>;
  readonly rpc: {
    readonly MidiSetInputEnabled: (payload: {
      id: InputId;
      enabled: boolean;
    }) => Effect.Effect<void, unknown>;
    readonly MidiRescan: () => Effect.Effect<void, unknown>;
  };
}

function Settings(props: SettingsProps) {
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal("");

  const run = async (effect: Effect.Effect<void, unknown>, done: string) => {
    if (busy()) return;
    setBusy(true);
    setStatus("");
    try {
      await Effect.runPromise(effect);
      await props.onChanged();
      setStatus(done);
    } catch (error) {
      setStatus(
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

  return (
    <div sx={styles.stack}>
      <p sx={styles.hint}>
        Devices connected to the server are detected automatically. Outputs are opened when a send
        node first runs. Inputs are only opened once you enable listening below.
      </p>
      <Show when={props.state().error}>{(error) => <p sx={styles.error}>{error()}</p>}</Show>
      <div>
        <Button
          type="button"
          disabled={busy()}
          onClick={() => void run(props.rpc.MidiRescan(), "Rescanned MIDI ports.")}
        >
          Rescan
        </Button>
      </div>
      <p role="status" aria-live="polite" sx={styles.status}>
        {status()}
      </p>

      <h3 sx={styles.heading}>Inputs</h3>
      <div>
        <For
          each={props.state().inputs}
          fallback={<p sx={styles.hint}>No MIDI inputs detected.</p>}
        >
          {(input) => (
            <div sx={styles.row}>
              <div>
                <div sx={styles.name}>{input.id}</div>
                <Show when={input.error}>{(error) => <div sx={styles.error}>{error()}</div>}</Show>
              </div>
              <span sx={styles.detail}>
                {!input.connected ? "Disconnected" : input.listening ? "Listening" : ""}
              </span>
              <label sx={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={input.enabled}
                  disabled={busy()}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    void run(
                      props.rpc.MidiSetInputEnabled({ id: input.id, enabled }),
                      enabled ? `Listening to ${input.id}.` : `Stopped listening to ${input.id}.`,
                    );
                  }}
                />
                Listen
              </label>
            </div>
          )}
        </For>
      </div>

      <h3 sx={styles.heading}>Outputs</h3>
      <div>
        <For
          each={props.state().outputs}
          fallback={<p sx={styles.hint}>No MIDI outputs detected.</p>}
        >
          {(output) => (
            <div sx={styles.row}>
              <span sx={styles.name}>{output.id}</span>
              <span sx={styles.detail}>{output.open ? "Open" : ""}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export const settings = ClientSettings.make({
  module,
  state: ClientState,
  initial: { available: false, inputs: [], outputs: [] },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p>MIDI settings state is unavailable.</p>,
});
