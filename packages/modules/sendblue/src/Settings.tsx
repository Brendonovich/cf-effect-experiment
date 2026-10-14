import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { Show, action, createMemo, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState, type DeliveryMode } from "./Definition.ts";
import SendblueModule from "./Module.ts";

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
  endpoint: { color: colors.gray12, fontFamily: "monospace", overflowWrap: "anywhere" },
});

interface SettingsEndpoint {
  readonly url: string;
  readonly schema: { readonly id: string };
}

interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly endpoints: ReadonlyArray<SettingsEndpoint>;
  readonly rpc: {
    readonly SendblueUpdateSettings: (payload: {
      readonly apiKey: string;
      readonly apiSecret: string;
      readonly webhookSecret: string;
      readonly mode: DeliveryMode;
    }) => Effect.Effect<void, unknown>;
    readonly SendblueClearSettings: () => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [apiKey, setApiKey] = createSignal("");
  const [apiSecret, setApiSecret] = createSignal("");
  const [webhookSecret, setWebhookSecret] = createSignal("");
  const [selectedMode, setSelectedMode] = createSignal<DeliveryMode>();
  const [pending, setPending] = createSignal(false);
  const [status, setStatus] = createSignal("");
  const endpoint = createMemo(() =>
    props.endpoints.find((candidate) => candidate.schema.id === "sendblue:receive"),
  );
  const mode = () => selectedMode() ?? props.state().mode;

  const save = action(async function* (clear: boolean) {
    if (pending()) return;
    const payload = {
      apiKey: apiKey().trim(),
      apiSecret: apiSecret().trim(),
      webhookSecret: webhookSecret().trim(),
      mode: mode(),
    };
    if (
      !clear &&
      (payload.apiKey.length === 0 ||
        payload.apiSecret.length === 0 ||
        (payload.mode === "webhook" && payload.webhookSecret.length === 0))
    )
      return;
    setPending(true);
    setStatus("");
    yield;
    const success = await Effect.runPromise(
      clear ? props.rpc.SendblueClearSettings() : props.rpc.SendblueUpdateSettings(payload),
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
    if (success) {
      setApiKey("");
      setApiSecret("");
      setWebhookSecret("");
      setSelectedMode(undefined);
    }
    setStatus(
      !success
        ? "Could not update Sendblue settings."
        : !refreshed
          ? "Settings saved; could not refresh settings."
          : clear
            ? "Sendblue settings cleared."
            : "Sendblue settings saved.",
    );
  });

  return (
    <section sx={styles.root}>
      <p sx={styles.note}>
        {props.state().apiConfigured
          ? "API credentials configured."
          : "No API credentials configured."}{" "}
        Receiving via {props.state().mode}.
      </p>
      <div sx={styles.row}>
        <input
          type="password"
          aria-label="Sendblue API key ID"
          autocomplete="off"
          spellcheck={false}
          sx={[styles.input, styles.focus]}
          value={apiKey()}
          disabled={pending()}
          placeholder="API key ID"
          onInput={(event) => setApiKey(event.currentTarget.value)}
        />
        <input
          type="password"
          aria-label="Sendblue API secret"
          autocomplete="off"
          spellcheck={false}
          sx={[styles.input, styles.focus]}
          value={apiSecret()}
          disabled={pending()}
          placeholder="API secret"
          onInput={(event) => setApiSecret(event.currentTarget.value)}
        />
        <select
          aria-label="Sendblue receive mode"
          sx={[styles.input, styles.focus]}
          value={mode()}
          disabled={pending()}
          onChange={(event) => setSelectedMode(event.currentTarget.value as DeliveryMode)}
        >
          <option value="polling">Polling</option>
          <option value="webhook">Webhook</option>
        </select>
        <Show when={mode() === "webhook"}>
          <input
            type="password"
            aria-label="Sendblue webhook signing secret"
            autocomplete="off"
            spellcheck={false}
            sx={[styles.input, styles.focus]}
            value={webhookSecret()}
            disabled={pending()}
            placeholder="Webhook signing secret"
            onInput={(event) => setWebhookSecret(event.currentTarget.value)}
          />
        </Show>
      </div>
      <div sx={styles.row}>
        <button
          type="button"
          sx={[styles.button, styles.focus]}
          disabled={
            pending() ||
            apiKey().trim().length === 0 ||
            apiSecret().trim().length === 0 ||
            (mode() === "webhook" && webhookSecret().trim().length === 0)
          }
          onClick={() => void save(false)}
        >
          Save
        </button>
        <button
          type="button"
          sx={[styles.button, styles.focus]}
          disabled={pending() || (!props.state().apiConfigured && !props.state().webhookConfigured)}
          onClick={() => void save(true)}
        >
          Clear
        </button>
      </div>
      <Show when={mode() === "webhook" ? endpoint() : undefined}>
        {(resolved) => (
          <p sx={styles.note}>
            Receive webhook URL: <span sx={styles.endpoint}>{resolved().url}</span>
          </p>
        )}
      </Show>
      <p sx={styles.note}>
        Polling works on free accounts. Webhook mode requires a paid Sendblue plan and the
        configured signing secret. Secrets are stored on the server and never returned to the
        browser.
      </p>
      <p role="status" sx={styles.note}>
        {status()}
      </p>
    </section>
  );
};

export default Settings;

export const settings = ClientSettings.make({
  module: SendblueModule,
  state: ClientState,
  initial: { apiConfigured: false, webhookConfigured: false, mode: "polling" },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings
      state={state}
      endpoints={context.endpoints}
      rpc={context.rpc}
      onChanged={context.onChanged}
    />
  ),
  renderInvalid: () => <p sx={styles.note}>Module settings state is unavailable.</p>,
});
