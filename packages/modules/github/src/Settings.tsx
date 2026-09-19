import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module";
import * as stylex from "@stylexjs/stylex";
import { useMutation } from "@tanstack/solid-query";
import { Effect } from "effect";
import { For, Show, createSignal, type Component } from "solid-js";

import {
  ClientRpcs,
  ClientState,
  AccountId,
  type WebhookEventName,
  type WebhookId,
} from "./Definition.ts";
import GitHubModule from "./Module.ts";

const styles = stylex.create({
  root: { color: colors.gray12, display: "flex", flexDirection: "column", fontSize: 12, gap: 12 },
  form: {
    borderBottom: `1px solid ${colors.gray6}`,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingBottom: 12,
  },
  row: { display: "flex", flexWrap: "wrap", gap: 8 },
  input: {
    backgroundColor: colors.gray2,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 4,
    color: colors.gray12,
    flex: "1 1 130px",
    minWidth: 0,
    padding: "6px 8px",
  },
  button: {
    backgroundColor: { default: colors.gray4, ":hover": colors.gray5 },
    border: 0,
    borderRadius: 4,
    color: colors.gray12,
    opacity: { default: 1, ":disabled": 0.5 },
    padding: "6px 10px",
  },
  events: { display: "flex", flexWrap: "wrap", gap: 8 },
  event: { alignItems: "center", display: "flex", gap: 4 },
  webhook: {
    borderBottom: `1px solid ${colors.gray5}`,
    display: "flex",
    flexDirection: "column",
    gap: 5,
    paddingBlock: 8,
  },
  title: { fontSize: 12, fontWeight: 600, margin: 0 },
  note: { color: colors.gray10, margin: 0, overflowWrap: "anywhere" },
  error: { color: colors.red10, margin: 0 },
});

const events: ReadonlyArray<WebhookEventName> = [
  "push",
  "pull_request",
  "issues",
  "issue_comment",
  "workflow_run",
  "release",
];
type Webhook = (typeof ClientState.Type)["webhooks"][number];

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly GitHubCreateWebhook: (input: {
      readonly name: string;
      readonly accountId: AccountId;
      readonly owner: string;
      readonly repository: string;
      readonly events: ReadonlyArray<WebhookEventName>;
    }) => Effect.Effect<WebhookId, unknown>;
    readonly GitHubUpdateWebhook: (input: {
      readonly webhookId: WebhookId;
      readonly name: string;
      readonly events: ReadonlyArray<WebhookEventName>;
    }) => Effect.Effect<void, unknown>;
    readonly GitHubRemoveWebhook: (input: {
      readonly webhookId: WebhookId;
    }) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

type Mutation =
  | {
      readonly type: "create";
      readonly name: string;
      readonly accountId: AccountId;
      readonly owner: string;
      readonly repository: string;
      readonly events: ReadonlyArray<WebhookEventName>;
    }
  | { readonly type: "update"; readonly webhook: Webhook }
  | { readonly type: "remove"; readonly webhookId: WebhookId };

const Settings: Component<SettingsProps> = (props) => {
  const [name, setName] = createSignal("");
  const [owner, setOwner] = createSignal("");
  const [repository, setRepository] = createSignal("");
  const [accountId, setAccountId] = createSignal<AccountId>();
  const [selectedEvents, setSelectedEvents] = createSignal<ReadonlyArray<WebhookEventName>>([
    "push",
    "pull_request",
  ]);
  const mutation = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: async (input: Mutation) => {
      if (input.type === "create") await Effect.runPromise(props.rpc.GitHubCreateWebhook(input));
      else if (input.type === "update")
        await Effect.runPromise(
          props.rpc.GitHubUpdateWebhook({
            webhookId: input.webhook.id,
            name: input.webhook.name,
            events: input.webhook.events,
          }),
        );
      else await Effect.runPromise(props.rpc.GitHubRemoveWebhook({ webhookId: input.webhookId }));
      await props.onChanged();
    },
    onSuccess: (_value, input) => {
      if (input.type !== "create") return;
      setName("");
      setOwner("");
      setRepository("");
    },
  }));
  const toggle = (event: WebhookEventName) =>
    setSelectedEvents((current) =>
      current.includes(event) ? current.filter((value) => value !== event) : [...current, event],
    );
  const create = () => {
    const account = accountId() ?? props.state().accounts[0]?.id;
    if (
      account === undefined ||
      owner().trim() === "" ||
      repository().trim() === "" ||
      selectedEvents().length === 0
    )
      return;
    mutation.mutate({
      type: "create",
      name: name().trim(),
      accountId: account,
      owner: owner().trim(),
      repository: repository().trim(),
      events: selectedEvents(),
    });
  };

  return (
    <section sx={styles.root}>
      <Show when={!props.state().provisioningAvailable}>
        <p sx={styles.note}>Repository webhook provisioning is available on MacroGraph Cloud.</p>
      </Show>
      <Show when={props.state().provisioningAvailable}>
        <div sx={styles.form}>
          <h3 sx={styles.title}>Add repository webhook</h3>
          <Show
            when={props.state().accounts.length > 0}
            fallback={<p sx={styles.note}>Connect a GitHub account before adding a webhook.</p>}
          >
            <div sx={styles.row}>
              <select
                sx={styles.input}
                aria-label="GitHub account"
                value={accountId() ?? props.state().accounts[0]?.id}
                onChange={(event) => setAccountId(AccountId.make(event.currentTarget.value))}
              >
                <For each={props.state().accounts}>
                  {(account) => <option value={account.id}>{account.displayName}</option>}
                </For>
              </select>
              <input
                sx={styles.input}
                aria-label="Webhook name"
                placeholder="Name (optional)"
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </div>
            <div sx={styles.row}>
              <input
                sx={styles.input}
                aria-label="Repository owner"
                placeholder="Owner"
                value={owner()}
                onInput={(event) => setOwner(event.currentTarget.value)}
              />
              <input
                sx={styles.input}
                aria-label="Repository name"
                placeholder="Repository"
                value={repository()}
                onInput={(event) => setRepository(event.currentTarget.value)}
              />
            </div>
            <div sx={styles.events}>
              <For each={events}>
                {(event) => (
                  <label sx={styles.event}>
                    <input
                      type="checkbox"
                      checked={selectedEvents().includes(event)}
                      onChange={() => toggle(event)}
                    />
                    {event}
                  </label>
                )}
              </For>
            </div>
            <button
              type="button"
              sx={styles.button}
              disabled={
                mutation.isPending ||
                owner().trim() === "" ||
                repository().trim() === "" ||
                selectedEvents().length === 0
              }
              onClick={create}
            >
              Provision webhook
            </button>
          </Show>
        </div>
      </Show>
      <Show when={mutation.error}>
        <p role="alert" sx={styles.error}>
          {mutation.error instanceof Error
            ? mutation.error.message
            : "GitHub webhook action failed."}
        </p>
      </Show>
      <For
        each={props.state().webhooks}
        fallback={<p sx={styles.note}>No GitHub repository webhooks configured.</p>}
      >
        {(webhook) => (
          <article sx={styles.webhook}>
            <h3 sx={styles.title}>{webhook.name}</h3>
            <p sx={styles.note}>
              {webhook.owner}/{webhook.repository} · {webhook.events.join(", ")}
            </p>
            <Show when={webhook.endpointUrl}>
              <p sx={styles.note}>{webhook.endpointUrl}</p>
            </Show>
            <div sx={styles.row}>
              <button
                type="button"
                sx={styles.button}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ type: "update", webhook })}
              >
                Reprovision
              </button>
              <button
                type="button"
                sx={styles.button}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ type: "remove", webhookId: webhook.id })}
              >
                Remove webhook
              </button>
            </div>
          </article>
        )}
      </For>
    </section>
  );
};

export default Settings;

export const settings = ClientSettings.make({
  module: GitHubModule,
  state: ClientState,
  initial: { accounts: [], webhooks: [], provisioningAvailable: false },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.error}>GitHub module settings are unavailable.</p>,
});
