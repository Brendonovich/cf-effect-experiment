import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/module";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { Effect } from "effect";
import { For, Show, createSignal, type Component } from "solid-js";

import {
  ClientRpcs,
  ClientState,
  AccountId,
  InstallationId,
  RepositoryId,
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
      readonly installationId: InstallationId;
      readonly repositoryId: RepositoryId;
      readonly owner: string;
      readonly repository: string;
      readonly events: ReadonlyArray<WebhookEventName>;
    }) => Effect.Effect<WebhookId, unknown>;
    readonly GitHubListInstallations: (input: { readonly accountId: AccountId }) => Effect.Effect<
      ReadonlyArray<{
        readonly id: InstallationId;
        readonly accountId: string;
        readonly accountLogin: string;
        readonly accountType: string;
      }>,
      unknown
    >;
    readonly GitHubListRepositories: (input: {
      readonly accountId: AccountId;
      readonly installationId: InstallationId;
    }) => Effect.Effect<
      ReadonlyArray<{
        readonly id: RepositoryId;
        readonly name: string;
        readonly fullName: string;
        readonly owner: string;
      }>,
      unknown
    >;
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
      readonly installationId: InstallationId;
      readonly repositoryId: RepositoryId;
      readonly owner: string;
      readonly repository: string;
      readonly events: ReadonlyArray<WebhookEventName>;
    }
  | { readonly type: "update"; readonly webhook: Webhook }
  | { readonly type: "remove"; readonly webhookId: WebhookId };

const Settings: Component<SettingsProps> = (props) => {
  const [name, setName] = createSignal("");
  const [accountId, setAccountId] = createSignal<AccountId>();
  const [installationId, setInstallationId] = createSignal<InstallationId>();
  const [repositoryId, setRepositoryId] = createSignal<RepositoryId>();
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
    },
  }));
  const selectedAccount = () => {
    const selected = accountId();
    return (
      props.state().accounts.find((account) => account.id === selected)?.id ??
      props.state().accounts[0]?.id
    );
  };
  const installations = useQuery(() => {
    const account = selectedAccount();
    return {
      queryKey: ["github-installations", account],
      enabled: account !== undefined,
      networkMode: "always" as const,
      queryFn: () =>
        account === undefined
          ? Promise.resolve([])
          : Effect.runPromise(props.rpc.GitHubListInstallations({ accountId: account })),
    };
  });
  const selectedInstallation = () => {
    const selected = installationId();
    return (
      installations.data?.find((installation) => installation.id === selected)?.id ??
      installations.data?.[0]?.id
    );
  };
  const repositories = useQuery(() => {
    const account = selectedAccount();
    const installation = selectedInstallation();
    return {
      queryKey: ["github-repositories", account, installation],
      enabled: account !== undefined && installation !== undefined,
      networkMode: "always" as const,
      queryFn: () =>
        account === undefined || installation === undefined
          ? Promise.resolve([])
          : Effect.runPromise(
              props.rpc.GitHubListRepositories({
                accountId: account,
                installationId: installation,
              }),
            ),
    };
  });
  const selectedRepository = () => {
    const selected = repositoryId();
    return (
      repositories.data?.find((repository) => repository.id === selected) ?? repositories.data?.[0]
    );
  };
  const toggle = (event: WebhookEventName) =>
    setSelectedEvents((current) =>
      current.includes(event) ? current.filter((value) => value !== event) : [...current, event],
    );
  const create = () => {
    const account = selectedAccount();
    const installation = selectedInstallation();
    const repository = selectedRepository();
    if (
      account === undefined ||
      installation === undefined ||
      repository === undefined ||
      selectedEvents().length === 0
    )
      return;
    mutation.mutate({
      type: "create",
      name: name().trim(),
      accountId: account,
      installationId: installation,
      repositoryId: repository.id,
      owner: repository.owner,
      repository: repository.name,
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
                onChange={(event) => {
                  setAccountId(AccountId.make(event.currentTarget.value));
                  setInstallationId(undefined);
                  setRepositoryId(undefined);
                }}
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
              <select
                sx={styles.input}
                aria-label="GitHub App installation"
                value={selectedInstallation()}
                disabled={installations.isPending || (installations.data?.length ?? 0) === 0}
                onChange={(event) => {
                  setInstallationId(InstallationId.make(event.currentTarget.value));
                  setRepositoryId(undefined);
                }}
              >
                <For each={installations.data ?? []}>
                  {(installation) => (
                    <option value={installation.id}>
                      {installation.accountLogin} ({installation.accountType})
                    </option>
                  )}
                </For>
              </select>
              <select
                sx={styles.input}
                aria-label="GitHub repository"
                value={selectedRepository()?.id}
                disabled={repositories.isPending || (repositories.data?.length ?? 0) === 0}
                onChange={(event) => setRepositoryId(RepositoryId.make(event.currentTarget.value))}
              >
                <For each={repositories.data ?? []}>
                  {(repository) => <option value={repository.id}>{repository.fullName}</option>}
                </For>
              </select>
            </div>
            <Show when={!installations.isPending && installations.data?.length === 0}>
              <p sx={styles.note}>
                No GitHub App installations are available to this account. Install the MacroGraph
                GitHub App, then reconnect or refresh this module.
              </p>
            </Show>
            <button
              type="button"
              sx={styles.button}
              disabled={installations.isFetching}
              onClick={() => void installations.refetch()}
            >
              {installations.isFetching ? "Refreshing GitHub access…" : "Refresh GitHub access"}
            </button>
            <Show when={installations.error ?? repositories.error}>
              <p role="alert" sx={styles.error}>
                Could not load GitHub App installations and repositories.
              </p>
            </Show>
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
                selectedInstallation() === undefined ||
                selectedRepository() === undefined ||
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
