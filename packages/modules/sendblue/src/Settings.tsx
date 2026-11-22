import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, action, createSignal, type Component } from "solid-js";

import { type AccountId, ClientRpcs, ClientState, type DeliveryMode } from "./Definition.ts";

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
  readonly instanceKey: string;
}

interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly endpoints: ReadonlyArray<SettingsEndpoint>;
  readonly rpc: {
    readonly SendblueCreateAccount: (payload: {
      readonly name: string;
      readonly apiKey: string;
      readonly apiSecret: string;
      readonly webhookSecret: string;
      readonly mode: DeliveryMode;
    }) => Effect.Effect<AccountId, unknown>;
    readonly SendblueRemoveAccount: (payload: {
      readonly accountId: AccountId;
    }) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [name, setName] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [apiSecret, setApiSecret] = createSignal("");
  const [webhookSecret, setWebhookSecret] = createSignal("");
  const [selectedMode, setSelectedMode] = createSignal<DeliveryMode>();
  const [pending, setPending] = createSignal(false);
  const [status, setStatus] = createSignal("");
  const mode = () => selectedMode() ?? "polling";
  const endpointFor = (accountId: AccountId) =>
    props.endpoints.find(
      (candidate) =>
        candidate.schema.id === "sendblue:receive" && candidate.instanceKey === accountId,
    );

  const createAccount = action(async function* () {
    if (pending()) return;
    const payload = {
      name: name().trim(),
      apiKey: apiKey().trim(),
      apiSecret: apiSecret().trim(),
      webhookSecret: webhookSecret().trim(),
      mode: mode(),
    };
    if (
      payload.name.length === 0 ||
      payload.apiKey.length === 0 ||
      payload.apiSecret.length === 0 ||
      (payload.mode === "webhook" && payload.webhookSecret.length === 0)
    )
      return;
    setPending(true);
    setStatus("");
    yield;
    const success = await Effect.runPromise(props.rpc.SendblueCreateAccount(payload)).then(
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
      setName("");
      setSelectedMode(undefined);
    }
    setStatus(
      !success
        ? "Could not update Sendblue settings."
        : !refreshed
          ? "Settings saved; could not refresh settings."
          : "Sendblue account added.",
    );
  });

  const removeAccount = action(async function* (accountId: AccountId) {
    if (pending()) return;
    setPending(true);
    setStatus("");
    yield;
    const success = await Effect.runPromise(props.rpc.SendblueRemoveAccount({ accountId })).then(
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
        ? "Could not remove Sendblue account."
        : !refreshed
          ? "Account removed; could not refresh settings."
          : "Sendblue account removed.",
    );
  });

  return (
    <section sx={styles.root}>
      <p sx={styles.note}>
        {props.state().accounts.length === 0
          ? "No Sendblue accounts configured."
          : `${props.state().accounts.length} Sendblue account${props.state().accounts.length === 1 ? "" : "s"} configured.`}
      </p>
      <div sx={styles.row}>
        <input
          type="text"
          aria-label="Sendblue account name"
          autocomplete="off"
          sx={[styles.input, styles.focus]}
          value={name()}
          disabled={pending()}
          placeholder="Account name"
          onInput={(event) => setName(event.currentTarget.value)}
        />
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
            name().trim().length === 0 ||
            apiKey().trim().length === 0 ||
            apiSecret().trim().length === 0 ||
            (mode() === "webhook" && webhookSecret().trim().length === 0)
          }
          onClick={() => void createAccount()}
        >
          Add account
        </button>
      </div>
      <For each={props.state().accounts}>
        {(account) => (
          <div sx={styles.row}>
            <span>{account.name}</span>
            <span sx={styles.note}>{account.mode}</span>
            <Show when={endpointFor(account.id)}>
              {(endpoint) => <span sx={styles.endpoint}>{endpoint().url}</span>}
            </Show>
            <button
              type="button"
              sx={[styles.button, styles.focus]}
              disabled={pending()}
              onClick={() => void removeAccount(account.id)}
            >
              Remove
            </button>
          </div>
        )}
      </For>
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
  state: ClientState,
  initial: { accounts: [] },
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
