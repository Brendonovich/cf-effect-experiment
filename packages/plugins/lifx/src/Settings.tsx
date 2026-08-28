import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin";
import * as stylex from "@stylexjs/stylex";
import { Effect, Schema } from "effect";
import { action, createSignal, createUniqueId, type Component } from "solid-js";

import { ClientRpcs, ClientState, initialStorage, RuntimeStorage } from "./Definition.ts";
import plugin from "./Plugin.ts";
import { failure, validateStorage } from "./Validation.ts";

const styles = stylex.create({
  root: { color: colors.gray12, display: "flex", flexDirection: "column", gap: 8, fontSize: 12 },
  row: { display: "flex", flexWrap: "wrap", gap: 8 },
  input: {
    backgroundColor: colors.gray2,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 4,
    color: colors.gray12,
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    padding: "6px 8px",
    fontFamily: "monospace",
    resize: "vertical",
  },
  button: {
    backgroundColor: { default: colors.gray4, ":hover": colors.gray5 },
    border: 0,
    borderRadius: 4,
    color: colors.gray12,
    padding: "6px 10px",
    opacity: { default: 1, ":disabled": 0.5 },
  },
  focus: { outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` } },
  note: { color: colors.gray11, margin: 0, overflowWrap: "anywhere" },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly LIFXConfigure: (payload: typeof RuntimeStorage.Type) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const fieldId = createUniqueId();
  const [draft, setDraft] = createSignal<string | undefined>(undefined);
  const [pending, setPending] = createSignal(false);
  const [status, setStatus] = createSignal("");
  const save = action(async function* () {
    if (pending()) return;
    const json = draft() ?? JSON.stringify(props.state());
    setPending(true);
    setStatus("");
    yield;
    const result = await Effect.runPromise(
      Schema.decodeUnknownEffect(Schema.fromJsonString(RuntimeStorage))(json, {
        onExcessProperty: "error",
      }).pipe(
        Effect.mapError(failure),
        Effect.flatMap(validateStorage),
        Effect.flatMap(props.rpc.LIFXConfigure),
      ),
    ).then(
      () => true,
      () => false,
    );
    const refreshed =
      result &&
      (await props.onChanged().then(
        () => true,
        () => false,
      ));
    yield;
    setPending(false);
    if (refreshed) setDraft(undefined);
    setStatus(
      !result
        ? "Could not save. Check device IDs, IPv4 addresses, ports and timeout."
        : !refreshed
          ? "Saved; settings refresh failed."
          : "Devices saved. No network requests were sent.",
    );
  });
  return (
    <section sx={styles.root}>
      <p sx={styles.note}>
        Configure LIFX LAN devices reachable from the server. No cloud key, automatic discovery or
        background polling is used.
      </p>
      <label for={fieldId}>Devices and request timeout (JSON)</label>
      <p sx={styles.note}>
        Each device needs id (colon-separated MAC), name, address (IPv4) and port (normally 56700).
        Timeout is 100-30000 ms.
      </p>
      <textarea
        id={fieldId}
        rows={12}
        spellcheck={false}
        sx={[styles.input, styles.focus]}
        disabled={pending()}
        value={draft() ?? JSON.stringify(props.state(), null, 2)}
        onInput={(event) => setDraft(event.currentTarget.value)}
      />
      <p sx={styles.note}>
        Example device:{" "}
        {`{"id":"d0:73:d5:12:34:56","name":"Desk","address":"192.168.1.50","port":56700}`}
      </p>
      <div sx={styles.row}>
        <button
          type="button"
          sx={[styles.button, styles.focus]}
          disabled={pending() || draft() === undefined}
          onClick={() => void save()}
        >
          Save
        </button>
        <button
          type="button"
          sx={[styles.button, styles.focus]}
          disabled={pending() || draft() === undefined}
          onClick={() => setDraft(undefined)}
        >
          Discard Changes
        </button>
      </div>
      <p role="status" sx={styles.note}>
        {status()}
      </p>
    </section>
  );
};
export default Settings;

export const settings = ClientSettings.make({
  plugin,
  state: ClientState,
  initial: initialStorage,
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.note}>LIFX settings state is unavailable.</p>,
});
