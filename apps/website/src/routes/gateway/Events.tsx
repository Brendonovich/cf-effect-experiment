import { Button, LoadingState } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { isServer } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useMutation, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import {
  gateway,
  type GatewayEvent,
  gatewayKeys,
  gatewayPaths,
  type GatewaySubscriptions,
  type SubscriptionsInput,
} from "../../gatewayApi";
import { showToast } from "../../Toasts";
import { Section, styles, time } from "./shared";

const defaultGithubEvents = ["push", "pull_request", "issues", "issue_comment", "release"];

const toggle = (values: ReadonlyArray<string>, value: string, on: boolean) =>
  on ? [...new Set([...values, value])] : values.filter((candidate) => candidate !== value);

const fromServer = (data: GatewaySubscriptions): SubscriptionsInput => ({
  twitch: data.subscriptions.twitch,
  github: data.subscriptions.github,
  discord:
    data.subscriptions.discord === null
      ? null
      : { token: null, intents: data.subscriptions.discord.intents },
});

/** What the gateway listens for on the user's behalf, and the events it has received. */
export function GatewayEventsRoute() {
  return (
    <div sx={styles.page}>
      <Subscriptions />
      <LiveEvents />
    </div>
  );
}

function Subscriptions() {
  const queryClient = useQueryClient();
  const subscriptions = createQuery(() => ({
    queryKey: gatewayKeys.subscriptions,
    queryFn: gateway.subscriptions,
    refetchInterval: 15_000,
  }));
  const repositories = createQuery(() => ({
    queryKey: gatewayKeys.repositories,
    queryFn: gateway.repositories,
    enabled: (subscriptions.data?.options.github.accounts.length ?? 0) > 0,
  }));
  // Edits stay local until saved; until then the server's subscriptions are shown.
  const [draft, setDraft] = createSignal<SubscriptionsInput>();
  const current = createMemo(
    () =>
      draft() ?? (subscriptions.data === undefined ? undefined : fromServer(subscriptions.data)),
  );
  const edit = (change: (value: SubscriptionsInput) => SubscriptionsInput) => {
    const value = current();
    if (value !== undefined) setDraft(change(value));
  };
  const [repositoryChoice, setRepositoryChoice] = createSignal("");
  const availableRepositories = createMemo(() =>
    (repositories.data?.repositories ?? []).filter(
      (repository) =>
        !(current()?.github ?? []).some(
          (subscribed) =>
            subscribed.installationId === repository.installationId &&
            subscribed.repositoryId === repository.repositoryId,
        ),
    ),
  );

  const save = useMutation(() => ({
    networkMode: "always" as const,
    mutationFn: gateway.setSubscriptions,
    onSuccess: (result) => {
      queryClient.setQueryData(gatewayKeys.subscriptions, result);
      setDraft(undefined);
      showToast(
        result.error === null
          ? { tone: "success", content: "Subscriptions saved" }
          : { tone: "error", content: result.error },
      );
    },
    onError: (error) => showToast({ tone: "error", content: error.message }),
  }));

  const discordStatus = createMemo(() => subscriptions.data?.discord.status ?? "off");

  return (
    <Show
      when={subscriptions.data !== undefined && current() !== undefined}
      fallback={<LoadingState label="Loading subscriptions" style={styles.loading} />}
    >
      <Section
        title="Twitch"
        description="EventSub subscriptions for each account. Twitch only sends events your connection is allowed to see."
      >
        <div sx={styles.list}>
          <For
            each={subscriptions.data?.options.twitch.accounts ?? []}
            fallback={
              <p sx={styles.empty}>
                <a href="/account/credentials" sx={styles.link}>
                  Connect a Twitch account
                </a>{" "}
                to subscribe to its events.
              </p>
            }
          >
            {(account) => (
              <details sx={styles.card} data-twitch-account={account.id}>
                <summary sx={local.summary}>
                  <span sx={styles.name}>{account.displayName ?? account.id}</span>
                  <span sx={styles.muted}>
                    {(current()?.twitch[account.id] ?? []).length} of{" "}
                    {subscriptions.data?.options.twitch.events.length ?? 0} events
                  </span>
                </summary>
                <div sx={styles.form}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    sx={styles.button}
                    onClick={() =>
                      edit((value) => ({
                        ...value,
                        twitch: {
                          ...value.twitch,
                          [account.id]: subscriptions.data?.options.twitch.events ?? [],
                        },
                      }))
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    sx={styles.button}
                    onClick={() =>
                      edit((value) => ({ ...value, twitch: { ...value.twitch, [account.id]: [] } }))
                    }
                  >
                    Clear
                  </Button>
                </div>
                <div sx={styles.checks}>
                  <For each={subscriptions.data?.options.twitch.events ?? []}>
                    {(type) => (
                      <label sx={styles.check}>
                        <input
                          type="checkbox"
                          checked={(current()?.twitch[account.id] ?? []).includes(type)}
                          onChange={(event) => {
                            const on = event.currentTarget.checked;
                            edit((value) => ({
                              ...value,
                              twitch: {
                                ...value.twitch,
                                [account.id]: toggle(value.twitch[account.id] ?? [], type, on),
                              },
                            }));
                          }}
                        />
                        <span sx={styles.checkLabel}>{type}</span>
                      </label>
                    )}
                  </For>
                </div>
              </details>
            )}
          </For>
        </div>
      </Section>

      <Section
        title="GitHub"
        description="Repository webhooks, created through the MacroGraph GitHub App on repositories it's installed on."
      >
        <Show
          when={(subscriptions.data?.options.github.accounts.length ?? 0) > 0}
          fallback={
            <div sx={styles.list}>
              <p sx={styles.empty}>
                <a href="/account/credentials" sx={styles.link}>
                  Connect a GitHub account
                </a>{" "}
                to subscribe to repository events.
              </p>
            </div>
          }
        >
          <div sx={styles.form}>
            <select
              sx={styles.input}
              aria-label="Repository"
              value={repositoryChoice()}
              onChange={(event) => {
                setRepositoryChoice(event.currentTarget.value);
              }}
            >
              <option value="">
                {repositories.isPending ? "Loading repositories…" : "Choose a repository"}
              </option>
              <For each={availableRepositories()}>
                {(repository) => (
                  <option value={`${repository.installationId}:${repository.repositoryId}`}>
                    {repository.owner}/{repository.repository}
                  </option>
                )}
              </For>
            </select>
            <Button
              type="button"
              size="sm"
              sx={styles.button}
              disabled={repositoryChoice() === ""}
              onClick={() => {
                const repository = availableRepositories().find(
                  (candidate) =>
                    `${candidate.installationId}:${candidate.repositoryId}` === repositoryChoice(),
                );
                if (repository === undefined) return;
                edit((value) => ({
                  ...value,
                  github: [...value.github, { ...repository, events: defaultGithubEvents }],
                }));
                setRepositoryChoice("");
              }}
            >
              Add repository
            </Button>
          </div>
          <Show when={(current()?.github.length ?? 0) > 0}>
            <div sx={styles.list}>
              <For each={current()?.github ?? []}>
                {(repository) => (
                  <div sx={styles.card} data-github-repository={repository.repositoryId}>
                    <div sx={local.cardHeader}>
                      <span sx={styles.name}>
                        {repository.owner}/{repository.repository}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        sx={styles.button}
                        onClick={() =>
                          edit((value) => ({
                            ...value,
                            github: value.github.filter(
                              (candidate) => candidate.repositoryId !== repository.repositoryId,
                            ),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                    <div sx={styles.checks}>
                      <For each={subscriptions.data?.options.github.events ?? []}>
                        {(type) => (
                          <label sx={styles.check}>
                            <input
                              type="checkbox"
                              checked={repository.events.includes(type)}
                              onChange={(event) => {
                                const on = event.currentTarget.checked;
                                edit((value) => ({
                                  ...value,
                                  github: value.github.map((candidate) =>
                                    candidate.repositoryId === repository.repositoryId
                                      ? { ...candidate, events: toggle(candidate.events, type, on) }
                                      : candidate,
                                  ),
                                }));
                              }}
                            />
                            <span sx={styles.checkLabel}>{type}</span>
                          </label>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Section>

      <Section
        title="Discord"
        description="A bot connection MacroGraph keeps open, delivering every gateway event its intents cover."
        actions={
          <Show when={subscriptions.data?.subscriptions.discord !== null}>
            <span
              sx={[
                styles.badge,
                discordStatus() === "connected" && styles.badgeGood,
                discordStatus() === "connecting" && styles.badgeWarn,
                discordStatus() === "error" && styles.badgeBad,
              ]}
            >
              {discordStatus() === "connected"
                ? "Connected"
                : discordStatus() === "connecting"
                  ? "Connecting"
                  : discordStatus() === "error"
                    ? `Error${subscriptions.data?.discord.error ? `: ${subscriptions.data.discord.error}` : ""}`
                    : "Off"}
            </span>
          </Show>
        }
      >
        <div sx={styles.list}>
          <Show
            when={current()?.discord}
            fallback={
              <div sx={styles.card}>
                <p sx={styles.muted}>
                  Discord events come from a bot. Create one in the Discord developer portal and
                  invite it to your server.
                </p>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    sx={styles.button}
                    onClick={() =>
                      edit((value) => ({
                        ...value,
                        discord: { token: "", intents: ["guilds", "guild_messages"] },
                      }))
                    }
                  >
                    Connect a bot
                  </Button>
                </div>
              </div>
            }
          >
            {(discord) => (
              <div sx={styles.card}>
                <div sx={styles.form}>
                  <input
                    sx={styles.input}
                    type="password"
                    autocomplete="off"
                    aria-label="Bot token"
                    placeholder={
                      subscriptions.data?.subscriptions.discord !== null
                        ? `Token saved for bot ${subscriptions.data?.subscriptions.discord?.bot ?? ""}. Enter a new one to replace it.`
                        : "Bot token"
                    }
                    value={discord().token ?? ""}
                    onInput={(event) => {
                      const token = event.currentTarget.value;
                      edit((value) => ({
                        ...value,
                        discord:
                          value.discord === null
                            ? null
                            : { ...value.discord, token: token === "" ? null : token },
                      }));
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    sx={styles.button}
                    onClick={() => edit((value) => ({ ...value, discord: null }))}
                  >
                    Remove bot
                  </Button>
                </div>
                <div sx={styles.checks}>
                  <For each={subscriptions.data?.options.discord.intents ?? []}>
                    {(intent) => (
                      <label sx={styles.check}>
                        <input
                          type="checkbox"
                          checked={discord().intents.includes(intent.id)}
                          onChange={(event) => {
                            const on = event.currentTarget.checked;
                            edit((value) => ({
                              ...value,
                              discord:
                                value.discord === null
                                  ? null
                                  : {
                                      ...value.discord,
                                      intents: toggle(value.discord.intents, intent.id, on),
                                    },
                            }));
                          }}
                        />
                        <span sx={styles.checkLabel}>{intent.name}</span>
                        <Show when={intent.privileged}>
                          <span
                            sx={styles.badge}
                            title="Enable it for the bot in the Discord developer portal"
                          >
                            Privileged
                          </span>
                        </Show>
                      </label>
                    )}
                  </For>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Section>

      <Show when={subscriptions.data?.error}>
        <p sx={[styles.callout, local.error]} role="alert">
          {subscriptions.data?.error}
        </p>
      </Show>

      <Show when={draft() !== undefined}>
        <div sx={local.saveBar}>
          <span sx={styles.muted}>Unsaved changes</span>
          <div sx={styles.form}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              sx={styles.button}
              onClick={() => setDraft(undefined)}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              sx={styles.button}
              disabled={save.isPending}
              onClick={() => {
                const value = draft();
                if (value !== undefined) save.mutate(value);
              }}
            >
              {save.isPending ? "Saving..." : "Save subscriptions"}
            </Button>
          </div>
        </div>
      </Show>
    </Show>
  );
}

function LiveEvents() {
  const history = createQuery(() => ({ queryKey: gatewayKeys.events, queryFn: gateway.events }));
  const subscriptions = createQuery(() => ({
    queryKey: gatewayKeys.subscriptions,
    queryFn: gateway.subscriptions,
  }));
  const accountName = (event: GatewayEvent) =>
    event.source === "twitch"
      ? (subscriptions.data?.options.twitch.accounts.find((account) => account.id === event.account)
          ?.displayName ?? event.account)
      : event.account;
  const [live, setLive] = createSignal<ReadonlyArray<GatewayEvent>>([]);
  const [connected, setConnected] = createSignal(false);
  const events = createMemo(() => {
    const bySeq = new Map<number, GatewayEvent>();
    for (const event of [...(history.data?.events ?? []), ...live()]) bySeq.set(event.seq, event);
    return [...bySeq.values()].sort((a, b) => b.seq - a.seq).slice(0, 100);
  });

  createEffect(
    () => !isServer,
    (client) => {
      if (!client) return;
      const source = new EventSource(gatewayPaths.eventStream);
      source.onopen = () => setConnected(true);
      source.onerror = () => setConnected(false);
      source.addEventListener("event", (message) => {
        const event = JSON.parse(String(message.data)) as GatewayEvent;
        setLive((current) => [event, ...current].slice(0, 100));
      });
      return () => source.close();
    },
  );

  return (
    <Section
      title="Live events"
      description="Everything the gateway receives, as it arrives. Events are kept for 7 days."
      actions={
        <span sx={[styles.badge, connected() && styles.badgeGood]}>
          {connected() ? "Live" : "Connecting"}
        </span>
      }
    >
      <div sx={styles.list}>
        <For each={events()} fallback={<p sx={styles.empty}>No events yet.</p>}>
          {(event) => (
            <details sx={local.event} data-event={event.seq}>
              <summary sx={local.eventSummary}>
                <span sx={styles.badge}>{event.source}</span>
                <span sx={local.eventType}>{event.type}</span>
                <span sx={styles.muted}>{accountName(event)}</span>
                <span sx={local.eventTime}>{time.format(new Date(event.receivedAt))}</span>
              </summary>
              <pre sx={styles.code}>{JSON.stringify(event.data, null, 2)}</pre>
            </details>
          )}
        </For>
      </div>
    </Section>
  );
}

const local = stylex.create({
  summary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    cursor: "pointer",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  error: { color: colors.red11 },
  saveBar: {
    position: "sticky",
    bottom: 16,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    borderColor: colors.gray7,
    borderStyle: "solid",
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: colors.gray1,
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)",
  },
  event: {
    paddingBlock: 8,
    paddingInline: 16,
    borderTopColor: colors.gray4,
    borderTopStyle: "solid",
    borderTopWidth: { default: 1, ":first-child": 0 },
  },
  eventSummary: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    fontSize: 13,
    cursor: "pointer",
  },
  eventType: {
    minWidth: 0,
    overflow: "hidden",
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
    color: colors.gray12,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  eventTime: { marginInlineStart: "auto", flexShrink: 0, fontSize: 12, color: colors.gray10 },
});
