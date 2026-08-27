import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { action, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState } from "./Definition.ts";
import OpenAIPlugin from "./Plugin.ts";

const styles = stylex.create({
  root: { color: colors.gray12, display: "flex", flexDirection: "column", gap: 8, fontSize: 12 },
  row: { display: "flex", flexWrap: "wrap", gap: 8 },
  input: {
    backgroundColor: colors.gray2,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 4,
    color: colors.gray12,
    flex: "1 1 180px",
    minWidth: 0,
    padding: "6px 8px",
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
  note: { color: colors.gray11, margin: 0 },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly OpenAIUpdateKey: (payload: {
      readonly apiKey: string;
    }) => Effect.Effect<void, unknown>;
    readonly OpenAIClearKey: () => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [key, setKey] = createSignal("");
  const [pending, setPending] = createSignal(false);
  const [status, setStatus] = createSignal("");

  const save = action(async function* (clear: boolean) {
    if (pending()) return;
    const apiKey = key().trim();
    if (!clear && apiKey.length === 0) return;
    setPending(true);
    setStatus("");
    setKey("");
    yield;
    const success = await Effect.runPromise(
      clear ? props.rpc.OpenAIClearKey() : props.rpc.OpenAIUpdateKey({ apiKey }),
    ).then(
      () => true,
      () => false,
    );
    const refreshed =
      success &&
      (await props.onChanged().then(
        () => true,
        () => false,
      ));
    yield;
    setPending(false);
    setStatus(
      !success
        ? "Could not update API key."
        : !refreshed
          ? "Key saved; could not refresh settings."
          : clear
            ? "API key cleared."
            : "API key saved.",
    );
  });

  return (
    <section sx={styles.root}>
      <label for="openai-api-key">OpenAI API key</label>
      <p sx={styles.note}>
        {props.state().configured ? "API key configured." : "No API key configured."} Stored on the
        server and not returned by plugin settings. Protect project storage and backups.
      </p>
      <div sx={styles.row}>
        <input
          id="openai-api-key"
          type="password"
          autocomplete="off"
          spellcheck={false}
          sx={[styles.input, styles.focus]}
          value={key()}
          disabled={pending()}
          placeholder="Enter a new API key"
          onInput={(event) => setKey(event.currentTarget.value)}
        />
        <button
          type="button"
          sx={[styles.button, styles.focus]}
          disabled={pending() || key().trim().length === 0}
          onClick={() => void save(false)}
        >
          Update
        </button>
        <button
          type="button"
          sx={[styles.button, styles.focus]}
          disabled={pending() || !props.state().configured}
          onClick={() => void save(true)}
        >
          Clear
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
  plugin: OpenAIPlugin,
  state: ClientState,
  initial: { configured: false },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.note}>Plugin settings state is unavailable.</p>,
});
