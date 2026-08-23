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
      readonly name: string;
      readonly verificationToken: string;
    }) => Effect.Effect<WebhookId, unknown>;
    readonly KofiRenameWebhook: (payload: {
      readonly webhookId: WebhookId;
      readonly name: string;
    }) => Effect.Effect<void, unknown>;
    readonly KofiRemoveWebhook: (payload: {
      readonly webhookId: WebhookId;
    }) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [name, setName] = createSignal("");
  const [verificationToken, setVerificationToken] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [copied, setCopied] = createSignal<string>();
  const [editingWebhook, setEditingWebhook] = createSignal<WebhookId>();
  const [editedName, setEditedName] = createSignal("");

  const endpointFor = (webhookId: WebhookId) =>
    props.endpoints.find(
      (endpoint) => endpoint.handlerId === "kofi:payment" && endpoint.instanceKey === webhookId,
    );

  const createWebhook = action(async function* () {
    const webhookName = name().trim();
    const token = verificationToken().trim();
    if (webhookName.length === 0 || token.length === 0) return;
    setStatus("Creating webhook...");
    yield;
    const result = await Effect.runPromise(
      props.rpc.KofiCreateWebhook({ name: webhookName, verificationToken: token }),
    ).then(
      () => ({ success: true as const }),
      (error: unknown) => ({ success: false as const, error }),
    );
    yield;
    if (!result.success) {
      setStatus(`Could not create webhook: ${String(result.error)}`);
      return;
    }
    setName("");
    setVerificationToken("");
    yield props.onChanged();
    setStatus("Webhook added");
  });

  const renameWebhook = action(async function* (webhookId: WebhookId) {
    const webhookName = editedName().trim();
    setEditingWebhook(undefined);
    if (webhookName.length === 0) return;
    setStatus("Renaming webhook...");
    yield;
    const result = await Effect.runPromise(
      props.rpc.KofiRenameWebhook({ webhookId, name: webhookName }),
    ).then(
      () => ({ success: true as const }),
      (error: unknown) => ({ success: false as const, error }),
    );
    yield;
    if (!result.success) {
      setStatus(`Could not rename webhook: ${String(result.error)}`);
      return;
    }
    yield props.onChanged();
    setStatus("");
  });

  const removeWebhook = action(async function* (webhookId: WebhookId) {
    setStatus("Removing webhook...");
    yield;
    const result = await Effect.runPromise(props.rpc.KofiRemoveWebhook({ webhookId })).then(
      () => ({ success: true as const }),
      (error: unknown) => ({ success: false as const, error }),
    );
    yield;
    if (!result.success) {
      setStatus(`Could not remove webhook: ${String(result.error)}`);
      return;
    }
    yield props.onChanged();
    setStatus("Webhook removed");
  });

  const copyEndpoint = async (endpoint: SettingsEndpoint) => {
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
          await navigator.clipboard.writeText(endpoint.url);
        } catch {
          copyWithSelection();
        }
      } else {
        copyWithSelection();
      }
      setCopied(endpoint.id);
      setStatus("");
      await new Promise((resolve) => setTimeout(resolve, 1800));
      if (copied() === endpoint.id) setCopied(undefined);
    } catch {
      setStatus("Could not copy the ingest URL");
    }
  };

  return (
    <section class="text-gray-12">
      <For each={props.state.webhooks}>
        {(webhook) => {
          const endpoint = () => endpointFor(webhook.id);
          return (
            <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-gray-6 py-3 first:pt-0">
              <div class="-ml-2 h-7 w-64 max-w-full min-w-0">
                <Show
                  when={editingWebhook() === webhook.id}
                  fallback={
                    <button
                      type="button"
                      class="focus-ring h-full w-full truncate rounded bg-transparent px-2 text-left text-sm font-medium text-gray-12 transition-colors hover:bg-gray-3"
                      title="Rename webhook"
                      onClick={() => {
                        setEditedName(webhook.name);
                        setEditingWebhook(webhook.id);
                      }}
                    >
                      {webhook.name}
                    </button>
                  }
                >
                  <input
                    ref={(input) =>
                      queueMicrotask(() => {
                        input.focus();
                        input.select();
                      })
                    }
                    type="text"
                    aria-label="Webhook name"
                    class="focus-ring h-full w-full min-w-0 rounded border border-gray-7 bg-gray-1 px-2 text-sm text-gray-12"
                    value={editedName()}
                    onInput={(event) => setEditedName(event.currentTarget.value)}
                    onBlur={() => {
                      if (editingWebhook() === webhook.id) void renameWebhook(webhook.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void renameWebhook(webhook.id);
                      if (event.key === "Escape") setEditingWebhook(undefined);
                    }}
                  />
                </Show>
              </div>
              <button
                type="button"
                class="focus-ring col-start-2 row-span-2 row-start-1 h-8 self-center rounded bg-transparent px-2.5 py-1 text-sm font-medium text-red-10 transition-colors enabled:hover:bg-red-3 disabled:bg-red-3 disabled:text-red-9"
                onClick={() => void removeWebhook(webhook.id)}
              >
                Remove
              </button>
              <Show
                when={endpoint()}
                fallback={<div class="min-w-0 text-xs italic text-gray-11">Provisioning...</div>}
              >
                {(resolved) => (
                  <div class="group/copy relative min-w-0">
                    <button
                      type="button"
                      class="focus-ring block w-full truncate text-left font-mono text-xs text-gray-11 hover:text-gray-12"
                      aria-label={`Copy webhook URL for ${webhook.name}`}
                      onClick={() => void copyEndpoint(resolved())}
                    >
                      {resolved().url}
                    </button>
                    <span class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 translate-y-1 scale-95 rounded border border-gray-6 bg-gray-2 px-2 py-1 text-[11px] font-medium text-gray-12 opacity-0 shadow-xl transition group-hover/copy:translate-y-0 group-hover/copy:scale-100 group-hover/copy:opacity-100 group-focus-within/copy:translate-y-0 group-focus-within/copy:scale-100 group-focus-within/copy:opacity-100">
                      {copied() === resolved().id ? "Copied" : "Copy URL"}
                      <span class="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 border-b border-r border-gray-6 bg-gray-2" />
                    </span>
                  </div>
                )}
              </Show>
            </div>
          );
        }}
      </For>
      <section class="py-3">
        <h3 class="text-sm font-semibold">Add webhook</h3>
        <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            aria-label="Webhook name"
            autocomplete="off"
            class="focus-ring min-w-0 rounded-md border border-gray-6 bg-gray-1 px-3 py-2 text-xs text-gray-12 placeholder:text-gray-9 focus:border-gray-8 sm:w-48"
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder="Name"
          />
          <input
            id="kofi-token"
            type="password"
            aria-label="Ko-fi verification token"
            autocomplete="off"
            class="focus-ring min-w-0 flex-1 rounded-md border border-gray-6 bg-gray-1 px-3 py-2 font-mono text-xs text-gray-12 placeholder:font-sans placeholder:text-gray-9 focus:border-gray-8"
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
            placeholder="Verification token"
          />
          <button
            type="button"
            class="focus-ring h-8 self-end rounded bg-gray-12 px-2.5 py-1 text-sm font-medium text-gray-1 transition-colors hover:bg-gray-11 disabled:bg-gray-10"
            disabled={name().trim().length === 0 || verificationToken().trim().length === 0}
            onClick={() => void createWebhook()}
          >
            Add
          </button>
        </div>
      </section>
      <Show when={status().length > 0}>
        <div class="text-xs italic text-gray-11">{status()}</div>
      </Show>
    </section>
  );
};

export default Settings;
