import { Effect } from "effect";
import { For, Show, action, createSignal, type Component } from "solid-js";

import type { ClientState, WebhookId } from "./Definition.ts";

export interface SettingsEndpoint {
  readonly id: string;
  readonly url: string;
  readonly handlerId: string;
  readonly instanceKey: string;
}

export interface SettingsProps {
  readonly state: typeof ClientState.Type;
  readonly endpoints: ReadonlyArray<SettingsEndpoint>;
  readonly rpc: {
    readonly KofiCreateWebhook: (payload: {
      readonly verificationToken: string;
    }) => Effect.Effect<WebhookId, unknown>;
    readonly KofiRemoveWebhook: (payload: {
      readonly webhookId: WebhookId;
    }) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [verificationToken, setVerificationToken] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [copied, setCopied] = createSignal<string>();
  const [collapsedWebhooks, setCollapsedWebhooks] = createSignal<ReadonlyArray<WebhookId>>([]);

  const endpointFor = (webhookId: WebhookId) =>
    props.endpoints.find(
      (endpoint) => endpoint.handlerId === "kofi:payment" && endpoint.instanceKey === webhookId,
    );

  const createWebhook = action(async function* () {
    const token = verificationToken().trim();
    if (token.length === 0) return;
    setStatus("Creating endpoint...");
    yield;
    const result = await Effect.runPromise(
      props.rpc.KofiCreateWebhook({ verificationToken: token }),
    ).then(
      () => ({ success: true as const }),
      (error: unknown) => ({ success: false as const, error }),
    );
    yield;
    if (!result.success) {
      setStatus(`Could not create endpoint: ${String(result.error)}`);
      return;
    }
    setVerificationToken("");
    yield props.onChanged();
    setStatus("Endpoint ready");
  });

  const removeWebhook = action(async function* (webhookId: WebhookId) {
    setStatus("Removing endpoint...");
    yield;
    const result = await Effect.runPromise(props.rpc.KofiRemoveWebhook({ webhookId })).then(
      () => ({ success: true as const }),
      (error: unknown) => ({ success: false as const, error }),
    );
    yield;
    if (!result.success) {
      setStatus(`Could not remove endpoint: ${String(result.error)}`);
      return;
    }
    yield props.onChanged();
    setStatus("Endpoint removed");
  });

  const copyEndpoint = action(async function* (endpoint: SettingsEndpoint) {
    const copyWithSelection = () => {
      const input = document.createElement("textarea");
      input.value = endpoint.url;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      let copied = false;
      try {
        input.select();
        copied = document.execCommand("copy");
      } finally {
        input.remove();
      }
      if (!copied) throw new Error("Copy command was rejected");
    };

    try {
      if (window.isSecureContext && navigator.clipboard !== undefined) {
        try {
          yield navigator.clipboard.writeText(endpoint.url);
        } catch {
          copyWithSelection();
        }
      } else {
        copyWithSelection();
      }
      setCopied(endpoint.id);
      setStatus("");
      yield new Promise((resolve) => setTimeout(resolve, 1800));
      setCopied(undefined);
    } catch {
      yield;
      setStatus("Could not copy the ingest URL");
    }
  });

  return (
    <section class="text-gray-12">
      <For each={props.state.webhooks}>
        {(webhook) => {
          const endpoint = () => endpointFor(webhook.id);
          const collapsed = () => collapsedWebhooks().includes(webhook.id);
          return (
            <section class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-gray-6 py-3 first:pt-0">
              <button
                type="button"
                class="focus-ring col-start-1 row-start-1"
                aria-label={collapsed() ? "Expand webhook" : "Collapse webhook"}
                onClick={() =>
                  setCollapsedWebhooks((webhooks) =>
                    webhooks.includes(webhook.id)
                      ? webhooks.filter((id) => id !== webhook.id)
                      : [...webhooks, webhook.id],
                  )
                }
              >
                <svg
                  viewBox="0 0 16 16"
                  class={`size-4 transition-transform ${collapsed() ? "-rotate-90" : ""}`}
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
              <h3 class="col-start-2 row-start-1 truncate text-sm font-semibold">Ko-fi Webhook</h3>
              <button
                class="focus-ring col-start-3 row-start-1 px-1 text-xs font-medium hover:text-red-11"
                onClick={() => void removeWebhook(webhook.id)}
              >
                Remove
              </button>
              <Show when={!collapsed()}>
                <span
                  class={`col-start-1 row-start-2 size-2.5 justify-self-center rounded-full ${endpoint() ? "bg-green-500" : "bg-amber-500"}`}
                />
                <span class="col-start-2 row-start-2 text-xs italic text-gray-11">
                  {endpoint() ? "Endpoint Connected" : "Endpoint Provisioning"}
                </span>
                <div class="col-start-2 row-start-3 mt-2 min-w-0">
                  <div class="text-xs font-medium">Ingest URL</div>
                  <Show
                    when={endpoint()}
                    fallback={<div class="text-xs text-gray-11">Provisioning...</div>}
                  >
                    {(resolved) => (
                      <div class="truncate text-xs text-gray-11">{resolved().url}</div>
                    )}
                  </Show>
                </div>
                <Show when={endpoint()}>
                  {(resolved) => (
                    <button
                      type="button"
                      class="focus-ring col-start-3 row-start-3 mt-2 self-end px-1 text-xs font-medium hover:text-gray-11"
                      onClick={() => void copyEndpoint(resolved())}
                    >
                      {copied() === resolved().id ? "Copied" : "Copy"}
                    </button>
                  )}
                </Show>
              </Show>
            </section>
          );
        }}
      </For>
      <section class="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1 py-3">
        <svg
          viewBox="0 0 16 16"
          class="col-start-1 row-start-1 size-4 self-center"
          aria-hidden="true"
        >
          <path
            d="M8 3v10M3 8h10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
          />
        </svg>
        <h3 class="col-start-2 row-start-1 text-sm font-semibold">Add Webhook</h3>
        <p class="col-span-2 col-start-2 row-start-2 text-xs text-gray-11">
          Paste the verification token from your Ko-fi webhook settings.
        </p>
        <label class="col-start-2 row-start-3 mt-2 min-w-0" for="kofi-token">
          <span class="block text-xs font-medium text-gray-11">Verification Token</span>
          <input
            id="kofi-token"
            type="text"
            autocomplete="off"
            class="focus-ring w-full border-0 border-b border-gray-7 bg-transparent px-0 py-1 text-xs text-gray-12 placeholder:text-gray-9"
            value={verificationToken()}
            onInput={(event) => setVerificationToken(event.currentTarget.value)}
            onPaste={(event) => {
              if (event.clipboardData === null) return;
              event.preventDefault();
              const input = event.currentTarget;
              const start = input.selectionStart ?? input.value.length;
              const end = input.selectionEnd ?? start;
              const pasted = event.clipboardData.getData("text");
              setVerificationToken(
                `${input.value.slice(0, start)}${pasted}${input.value.slice(end)}`,
              );
              queueMicrotask(() =>
                input.setSelectionRange(start + pasted.length, start + pasted.length),
              );
            }}
            placeholder="Verification token from Ko-fi"
          />
        </label>
        <button
          class="focus-ring col-start-3 row-start-3 px-1 py-1 text-xs font-medium hover:text-gray-11 disabled:opacity-40"
          disabled={verificationToken().trim().length === 0}
          onClick={() => void createWebhook()}
        >
          Create endpoint
        </button>
      </section>
      <Show when={status().length > 0}>
        <div class="pl-7 text-xs italic text-gray-11">{status()}</div>
      </Show>
    </section>
  );
};

export default Settings;
