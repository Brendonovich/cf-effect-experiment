import { Effect } from "effect";
import { For, Show, action, createSignal, untrack, type Component } from "solid-js";

import { SUBSCRIPTION_TYPES, type AccountId, type ClientState } from "./Definition.ts";

const subscriptionName = (subscription: string) =>
  subscription
    .replace(/^channel\./, "")
    .split(/[._]/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

export interface SettingsProps {
  readonly state: typeof ClientState.Type;
  readonly rpc: {
    readonly ConnectEventSub: (payload: {
      readonly accountId: AccountId;
    }) => Effect.Effect<void, unknown>;
    readonly DisconnectEventSub: (payload: {
      readonly accountId: AccountId;
    }) => Effect.Effect<void, unknown>;
    readonly ToggleEventSubSubscription: (payload: {
      readonly accountId: AccountId;
      readonly subscriptionType: string;
      readonly enabled: boolean;
    }) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [status, setStatus] = createSignal("");
  const [collapsedAccounts, setCollapsedAccounts] = createSignal<ReadonlyArray<AccountId>>(
    untrack(() => props.state.accounts.map((account) => account.id)),
  );

  const run = action(async function* (label: string, effect: Effect.Effect<void, unknown>) {
    setStatus(label);
    yield;
    const result = await Effect.runPromise(effect).then(
      () => ({ success: true as const }),
      (error: unknown) => ({ success: false as const, error }),
    );
    yield;
    if (!result.success) {
      setStatus(`Twitch operation failed: ${String(result.error)}`);
      return;
    }
    yield props.onChanged();
    setStatus("");
  });

  return (
    <section class="text-gray-12">
      <div>
        <For each={props.state.accounts}>
          {(account) => {
            const connected = () => account.eventSubSocket.state === "connected";
            const toggleCollapsed = () =>
              setCollapsedAccounts((accounts) =>
                accounts.includes(account.id)
                  ? accounts.filter((id) => id !== account.id)
                  : [...accounts, account.id],
              );
            return (
              <section class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b border-gray-6 py-3 first:pt-0 last:border-b-0">
                <div
                  class="col-span-2 col-start-1 row-start-1 grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2"
                  onClick={toggleCollapsed}
                >
                  <button
                    type="button"
                    class="focus-ring rounded p-0.5 transition-colors hover:bg-gray-3"
                    aria-label={
                      collapsedAccounts().includes(account.id)
                        ? "Expand account"
                        : "Collapse account"
                    }
                  >
                    <svg
                      viewBox="0 0 16 16"
                      class={`size-3 transition-transform ${collapsedAccounts().includes(account.id) ? "-rotate-90" : ""}`}
                      aria-hidden="true"
                    >
                      <path
                        d="m3 6 5 5 5-5"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.75"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>
                  <h3 class="truncate text-sm font-semibold">{account.displayName}</h3>
                </div>
                <span
                  class={`col-start-1 row-start-2 size-2 justify-self-center rounded-full ${connected() ? "bg-green-500" : "bg-red-500"}`}
                />
                <div class="col-start-2 row-start-2 text-xs italic text-gray-11">
                  EventSub{" "}
                  {connected()
                    ? "Connected"
                    : account.eventSubSocket.state === "connecting"
                      ? "Connecting"
                      : "Disconnected"}
                </div>
                <button
                  type="button"
                  class="focus-ring col-start-3 row-start-1 h-8 rounded bg-transparent px-2.5 py-1 text-sm font-medium text-gray-12 transition-colors enabled:hover:bg-gray-3 disabled:bg-gray-3 disabled:text-gray-10"
                  disabled={account.eventSubSocket.state === "connecting"}
                  onClick={() =>
                    void run(
                      connected() ? "Disconnecting..." : "Connecting...",
                      connected()
                        ? props.rpc.DisconnectEventSub({ accountId: account.id })
                        : props.rpc.ConnectEventSub({ accountId: account.id }),
                    )
                  }
                >
                  {connected() ? "Disconnect" : "Connect"}
                </button>
                <Show when={!collapsedAccounts().includes(account.id)}>
                  <div class="col-span-2 col-start-2 row-start-3 mt-2">
                    <h4 class="mb-1 text-xs font-semibold text-gray-11">EventSub Subscriptions</h4>
                    <For each={SUBSCRIPTION_TYPES}>
                      {(subscription) => (
                        <label class="flex cursor-pointer items-center justify-between gap-4 px-2 py-2 hover:bg-gray-3/60">
                          <span class="min-w-0">
                            <span class="block text-sm text-gray-12">
                              {subscriptionName(subscription)}
                            </span>
                            <span class="block truncate text-xs text-gray-11">{subscription}</span>
                          </span>
                          <input
                            type="checkbox"
                            class="size-4 shrink-0 accent-gray-12"
                            checked={account.enabledSubscriptions.includes(subscription)}
                            onChange={(event) =>
                              void run(
                                "Updating subscriptions...",
                                props.rpc.ToggleEventSubSubscription({
                                  accountId: account.id,
                                  subscriptionType: subscription,
                                  enabled: event.currentTarget.checked,
                                }),
                              )
                            }
                          />
                        </label>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            );
          }}
        </For>
        <Show when={props.state.accounts.length === 0}>
          <div class="border-y border-gray-6 py-8 text-center text-xs italic text-gray-11">
            No Twitch credentials are available to this editor host.
          </div>
        </Show>
        <Show when={status().length > 0}>
          <div class="mt-3 text-xs italic text-gray-11">{status()}</div>
        </Show>
      </div>
    </section>
  );
};

export default Settings;
