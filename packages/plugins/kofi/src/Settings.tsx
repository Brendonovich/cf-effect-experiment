import { createStateMachine } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, action, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState, type WebhookId } from "./Definition.ts";
import KofiPlugin from "./Plugin.ts";

const sm = "@media (min-width: 640px)";
const styles = stylex.create({
  root: { color: colors.gray12 },
  webhookRow: {
    alignItems: "center",
    borderBottom: `1px solid ${colors.gray6}`,
    columnGap: 8,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    paddingBlock: 8,
    rowGap: 2,
  },
  nameBox: { height: 24, marginLeft: -6, maxWidth: "100%", minWidth: 0, width: 224 },
  focus: {
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
    outline: "none",
  },
  nameButton: {
    backgroundColor: { default: "transparent", ":hover": colors.gray3 },
    border: 0,
    borderRadius: 4,
    color: colors.gray12,
    fontSize: 12,
    fontWeight: 500,
    height: "100%",
    overflow: "hidden",
    paddingInline: 6,
    textAlign: "left",
    textOverflow: "ellipsis",
    transitionProperty: "background-color",
    whiteSpace: "nowrap",
    width: "100%",
  },
  nameInput: {
    backgroundColor: colors.gray1,
    border: `1px solid ${colors.gray7}`,
    borderRadius: 4,
    color: colors.gray12,
    fontSize: 12,
    height: "100%",
    minWidth: 0,
    paddingInline: 6,
    width: "100%",
  },
  remove: {
    alignSelf: "center",
    backgroundColor: { default: "transparent", ":hover": colors.red3, ":disabled": colors.red3 },
    border: 0,
    borderRadius: 4,
    color: { default: colors.red10, ":disabled": colors.red9 },
    fontSize: 12,
    fontWeight: 500,
    gridColumnStart: 2,
    gridRow: "1 / span 2",
    height: 28,
    padding: "4px 8px",
    transitionProperty: "background-color",
  },
  copyWrap: { minWidth: 0, position: "relative" },
  copyButton: {
    backgroundColor: "transparent",
    border: 0,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    display: "block",
    fontFamily: "monospace",
    fontSize: 12,
    overflow: "hidden",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "100%",
  },
  tooltip: {
    backgroundColor: colors.gray1,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 3,
    bottom: "100%",
    color: colors.gray12,
    fontSize: 11,
    fontWeight: 500,
    left: "50%",
    marginBottom: 5,
    opacity: 0,
    padding: "2px 6px",
    pointerEvents: "none",
    position: "absolute",
    transform: "translateX(-50%)",
    transition: "opacity .15s",
    zIndex: 10,
  },
  tooltipVisible: { opacity: 1 },
  addSection: {
    backgroundColor: colors.gray3,
    borderRadius: 6,
    marginBottom: 8,
    padding: 12,
  },
  heading: { fontSize: 12, fontWeight: 600, margin: 0 },
  addRow: {
    alignItems: { default: "stretch", [sm]: "center" },
    display: "flex",
    flexDirection: { default: "column", [sm]: "row" },
    gap: 8,
    marginTop: 8,
  },
  input: {
    backgroundColor: colors.gray2,
    borderColor: { default: colors.gray6, ":focus": colors.gray8 },
    borderRadius: 2,
    borderStyle: "solid",
    borderWidth: 1,
    color: { default: colors.gray12, "::placeholder": colors.gray9 },
    fontSize: 12,
    minWidth: 0,
    padding: "6px 8px",
  },
  nameNew: { width: { default: "auto", [sm]: 160 } },
  token: { flex: 1, fontFamily: { default: "monospace", "::placeholder": "sans-serif" } },
  addButton: {
    alignSelf: "flex-end",
    backgroundColor: {
      default: colors.gray12,
      ":hover": colors.gray11,
      ":disabled": colors.gray10,
    },
    border: 0,
    borderRadius: 4,
    color: colors.gray1,
    fontSize: 12,
    fontWeight: 500,
    height: 28,
    padding: "4px 8px",
    transitionProperty: "background-color",
  },
  status: { color: colors.gray11, fontSize: 12, fontStyle: "italic" },
  invalid: { color: colors.red10, fontSize: 12 },
});

export interface SettingsEndpoint {
  readonly id: string;
  readonly url: string;
  readonly schema: { readonly id: string; readonly displayName: string };
  readonly instanceKey: string;
  readonly displayName?: string;
}

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
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

type WebhookEditState = {
  context: { readonly webhookId: WebhookId; name: string } | undefined;
  mode: "idle" | "editing" | "saving" | "failed";
};

const Settings: Component<SettingsProps> = (props) => {
  const [name, setName] = createSignal("");
  const [verificationToken, setVerificationToken] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [copied, setCopied] = createSignal<string>();
  const [webhookEdit, webhookEditActions] = createStateMachine(
    { context: undefined, mode: "idle" } as WebhookEditState,
    {
      start(state, webhookId: WebhookId, name: string) {
        state.context = { webhookId, name };
        state.mode = "editing";
      },
      change(state, webhookId: WebhookId, name: string) {
        if (state.context?.webhookId !== webhookId || state.mode === "saving") return;
        state.context.name = name;
        state.mode = "editing";
      },
      save(state, webhookId: WebhookId) {
        if (state.context?.webhookId === webhookId) state.mode = "saving";
      },
      failure(state, webhookId: WebhookId) {
        if (state.context?.webhookId === webhookId && state.mode === "saving") {
          state.mode = "failed";
        }
      },
      success(state, webhookId: WebhookId) {
        if (state.context?.webhookId !== webhookId || state.mode !== "saving") return;
        state.context = undefined;
        state.mode = "idle";
      },
      cancel(state) {
        state.context = undefined;
        state.mode = "idle";
      },
    },
  );
  const [activeTooltip, setActiveTooltip] = createSignal<string>();

  const endpointFor = (webhookId: WebhookId) =>
    props.endpoints.find(
      (endpoint) => endpoint.schema.id === "kofi:payment" && endpoint.instanceKey === webhookId,
    );

  const createWebhook = action(async function* () {
    const webhookName = name().trim();
    const token = verificationToken().trim();
    if (webhookName.length === 0 || token.length === 0) return;
    setStatus("");
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
    const edit = webhookEdit;
    if (edit.mode === "saving" || edit.context?.webhookId !== webhookId) return;
    const webhookName = edit.context.name.trim();
    if (webhookName.length === 0) {
      webhookEditActions.cancel();
      return;
    }
    webhookEditActions.save(webhookId);
    setStatus("");
    yield;
    const result = await Effect.runPromise(
      props.rpc.KofiRenameWebhook({ webhookId, name: webhookName }),
    ).then(
      () => ({ success: true as const }),
      (error: unknown) => ({ success: false as const, error }),
    );
    yield;
    if (!result.success) {
      webhookEditActions.failure(webhookId);
      setStatus(`Could not rename webhook: ${String(result.error)}`);
      return;
    }
    webhookEditActions.success(webhookId);
    yield props.onChanged();
    setStatus("");
  });

  const removeWebhook = action(async function* (webhookId: WebhookId) {
    setStatus("");
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
      try {
        input.select();
        return document.execCommand("copy");
      } finally {
        input.remove();
      }
    };

    try {
      let didCopy = false;
      if (window.isSecureContext && navigator.clipboard !== undefined) {
        try {
          await navigator.clipboard.writeText(endpoint.url);
          didCopy = true;
        } catch {
          didCopy = copyWithSelection();
        }
      } else {
        didCopy = copyWithSelection();
      }
      if (!didCopy) {
        setStatus("Could not copy the ingest URL");
        return;
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
    <section sx={styles.root}>
      <section sx={styles.addSection}>
        <h3 sx={styles.heading}>Add webhook</h3>
        <div sx={styles.addRow}>
          <input
            type="text"
            aria-label="Webhook name"
            autocomplete="off"
            sx={[styles.focus, styles.input, styles.nameNew]}
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder="Name"
          />
          <input
            id="kofi-token"
            type="password"
            aria-label="Ko-fi verification token"
            autocomplete="off"
            sx={[styles.focus, styles.input, styles.token]}
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
            sx={[styles.focus, styles.addButton]}
            disabled={name().trim().length === 0 || verificationToken().trim().length === 0}
            onClick={() => void createWebhook()}
          >
            Add
          </button>
        </div>
      </section>
      <For each={props.state().webhooks}>
        {(webhook) => {
          const endpoint = () => endpointFor(webhook.id);
          return (
            <div sx={styles.webhookRow}>
              <div sx={styles.nameBox}>
                <Show
                  when={webhookEdit.context?.webhookId === webhook.id}
                  fallback={
                    <button
                      type="button"
                      sx={[styles.focus, styles.nameButton]}
                      title="Rename webhook"
                      onClick={() => {
                        webhookEditActions.start(
                          webhook.id,
                          endpoint()?.displayName ?? webhook.name,
                        );
                      }}
                    >
                      {endpoint()?.displayName ?? webhook.name}
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
                    sx={[styles.focus, styles.nameInput]}
                    value={webhookEdit.context?.name ?? ""}
                    readonly={webhookEdit.mode === "saving"}
                    onInput={(event) => {
                      webhookEditActions.change(webhook.id, event.currentTarget.value);
                    }}
                    onBlur={() => {
                      if (webhookEdit.context?.webhookId === webhook.id) {
                        void renameWebhook(webhook.id);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void renameWebhook(webhook.id);
                      if (event.key === "Escape") webhookEditActions.cancel();
                    }}
                  />
                </Show>
              </div>
              <button
                type="button"
                sx={[styles.focus, styles.remove]}
                onClick={() => void removeWebhook(webhook.id)}
              >
                Remove
              </button>
              <Show when={endpoint()}>
                {(resolved) => (
                  <div
                    sx={styles.copyWrap}
                    onMouseEnter={() => setActiveTooltip(resolved().id)}
                    onMouseLeave={() => setActiveTooltip(undefined)}
                    onFocusIn={() => setActiveTooltip(resolved().id)}
                    onFocusOut={() => setActiveTooltip(undefined)}
                  >
                    <button
                      type="button"
                      sx={[styles.focus, styles.copyButton]}
                      aria-label={`Copy webhook URL for ${resolved().displayName ?? webhook.name}`}
                      onClick={() => void copyEndpoint(resolved())}
                    >
                      {resolved().url}
                    </button>
                    <span
                      sx={[
                        styles.tooltip,
                        activeTooltip() === resolved().id && styles.tooltipVisible,
                      ]}
                    >
                      {copied() === resolved().id ? "Copied" : "Copy URL"}
                    </span>
                  </div>
                )}
              </Show>
            </div>
          );
        }}
      </For>
      <Show when={status().length > 0}>
        <div sx={styles.status}>{status()}</div>
      </Show>
    </section>
  );
};

export default Settings;

export const settings = ClientSettings.make({
  plugin: KofiPlugin,
  state: ClientState,
  initial: { webhooks: [] },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings
      state={state}
      endpoints={context.endpoints}
      rpc={context.rpc}
      onChanged={context.onChanged}
    />
  ),
  renderInvalid: () => <p sx={styles.invalid}>Plugin settings state is unavailable.</p>,
});
