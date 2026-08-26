import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, createSignal, createUniqueId, type Component } from "solid-js";

import {
  ClientRpcs,
  ClientState,
  type ConnectionDefinition,
  type ConnectionId,
} from "./Definition.ts";
import WebSocketClientPlugin from "./Plugin.ts";

const sm = "@media (min-width: 640px)";
const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 16 },
  form: {
    backgroundColor: colors.gray3,
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 12,
  },
  field: { alignItems: "stretch", display: "flex", flex: 1, flexDirection: "column", gap: 4 },
  label: { color: colors.gray11, fontSize: 12, fontWeight: 500 },
  focus: {
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
    outline: "none",
  },
  input: {
    backgroundColor: colors.gray2,
    border: 0,
    borderRadius: 2,
    boxShadow: `0 0 0 1px ${colors.gray6}`,
    color: colors.gray12,
    fontSize: 14,
    height: 32,
    paddingInline: 8,
    width: "100%",
  },
  formRow: {
    alignItems: { default: "stretch", [sm]: "flex-end" },
    display: "flex",
    flexDirection: { default: "column", [sm]: "row" },
    gap: 12,
  },
  buttonEnd: { marginLeft: { default: 0, [sm]: "auto" } },
  status: {
    backgroundColor: colors.gray3,
    borderColor: colors.gray6,
    borderRadius: 2,
    borderStyle: "solid",
    borderWidth: 1,
    color: colors.gray11,
    fontSize: 12,
    padding: "6px 8px",
  },
  list: { display: "flex", flexDirection: "column", gap: 4 },
  listLabel: { color: colors.gray11, fontSize: 12, fontWeight: 500 },
  empty: {
    color: colors.gray11,
    fontSize: 12,
    fontStyle: "italic",
    padding: 8,
    textAlign: "center",
  },
  row: {
    display: "flex",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingBlock: 8,
    width: "100%",
  },
  details: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  name: {
    color: colors.gray12,
    fontSize: 14,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  addressRow: { alignItems: "center", display: "flex", flexDirection: "row", gap: 8 },
  dot: { borderRadius: "50%", flexShrink: 0, height: 8, width: 8 },
  green: { backgroundColor: "var(--green-9)" },
  yellow: { backgroundColor: "var(--yellow-9)" },
  red: { backgroundColor: colors.red9 },
  gray: { backgroundColor: colors.gray8 },
  address: {
    color: colors.gray11,
    fontFamily: "monospace",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  error: { color: colors.red10, fontSize: 11 },
  actions: {
    alignItems: "center",
    display: "flex",
    flexDirection: "row",
    gap: 4,
    justifyContent: "flex-end",
  },
  actionButton: {
    backgroundColor: { default: "transparent", ":hover": colors.gray5 },
    border: 0,
    borderRadius: 2,
    color: colors.gray11,
    fontSize: 12,
    padding: "4px 8px",
  },
  removeButton: {
    backgroundColor: { default: "transparent", ":hover": colors.red3 },
    border: 0,
    borderRadius: 2,
    color: colors.red10,
    fontSize: 12,
    fontWeight: 500,
    padding: "4px 8px",
  },
  invalid: { color: colors.red10, fontSize: 12 },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly WebSocketAddConnection: (payload: {
      readonly name: string;
      readonly url: string;
    }) => Effect.Effect<ConnectionId, unknown>;
    readonly WebSocketUpdateConnection: (
      payload: ConnectionDefinition,
    ) => Effect.Effect<void, unknown>;
    readonly WebSocketRemoveConnection: (payload: {
      readonly id: ConnectionId;
    }) => Effect.Effect<void, unknown>;
    readonly WebSocketConnect: (payload: {
      readonly id: ConnectionId;
    }) => Effect.Effect<void, unknown>;
    readonly WebSocketDisconnect: (payload: {
      readonly id: ConnectionId;
    }) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const message = (error: unknown) =>
  typeof error === "object" && error !== null && "reason" in error
    ? String(error.reason)
    : "WebSocket operation failed";

const CONNECTION_INDICATOR = {
  connected: styles.green,
  connecting: styles.yellow,
  error: styles.red,
  disconnected: styles.gray,
} as const;

function InputField(props: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly maxlength?: number;
  readonly required?: boolean;
  readonly onInput: (value: string) => void;
}) {
  const id = createUniqueId();

  return (
    <div sx={styles.field}>
      <label for={id} sx={styles.label}>
        {props.label}
      </label>
      <input
        id={id}
        sx={[styles.focus, styles.input]}
        value={props.value}
        placeholder={props.placeholder}
        maxlength={props.maxlength}
        required={props.required}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </div>
  );
}

const Settings: Component<SettingsProps> = (props) => {
  const [name, setName] = createSignal("");
  const [url, setUrl] = createSignal("ws://localhost:8080");
  const [status, setStatus] = createSignal("");

  const run = async (effect: Effect.Effect<unknown, unknown>) => {
    setStatus("");
    const result = await Effect.runPromise(effect).then(
      () => ({ success: true as const }),
      (error: unknown) => ({ success: false as const, error }),
    );
    setStatus(result.success ? "" : message(result.error));
    if (result.success) await props.onChanged();
    return result.success;
  };

  const add = async () => {
    const added = await run(
      props.rpc.WebSocketAddConnection({
        name: name(),
        url: url(),
      }),
    );
    if (added) {
      setName("");
      setUrl("ws://localhost:8080");
    }
  };

  return (
    <div sx={styles.stack}>
      <form
        sx={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <InputField label="Address" value={url()} required onInput={setUrl} />
        <div sx={styles.formRow}>
          <InputField
            label="Name"
            value={name()}
            placeholder="Optional"
            maxlength={80}
            onInput={setName}
          />
          <Button type="submit" sx={styles.buttonEnd}>
            Add WebSocket
          </Button>
        </div>
      </form>

      <Show when={status()}>
        <p sx={styles.status}>{status()}</p>
      </Show>

      <div sx={styles.list}>
        <span sx={styles.listLabel}>WebSocket Connections</span>
        <For
          each={props.state().connections}
          fallback={<div sx={styles.empty}>No Connections</div>}
        >
          {(connection) => (
            <li sx={styles.row}>
              <div sx={styles.details}>
                <span sx={styles.name}>
                  {connection.definition.name || connection.definition.url}
                </span>
                <div sx={styles.addressRow}>
                  <div sx={[styles.dot, CONNECTION_INDICATOR[connection.status]]} />
                  <pre sx={styles.address}>{connection.definition.url}</pre>
                </div>
                <Show when={connection.error}>
                  {(error) => <span sx={styles.error}>{error()}</span>}
                </Show>
              </div>
              <div sx={styles.actions}>
                <button
                  type="button"
                  sx={[styles.focus, styles.actionButton]}
                  disabled={connection.status === "connecting"}
                  onClick={() =>
                    void run(
                      connection.status === "connected"
                        ? props.rpc.WebSocketDisconnect({
                            id: connection.definition.id,
                          })
                        : props.rpc.WebSocketConnect({
                            id: connection.definition.id,
                          }),
                    )
                  }
                >
                  {connection.status === "connected" ? "Disconnect" : "Connect"}
                </button>
                <button
                  type="button"
                  sx={[styles.focus, styles.removeButton]}
                  onClick={() =>
                    void run(
                      props.rpc.WebSocketRemoveConnection({
                        id: connection.definition.id,
                      }),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </li>
          )}
        </For>
      </div>
    </div>
  );
};

export default Settings;

export const settings = ClientSettings.make({
  plugin: WebSocketClientPlugin,
  state: ClientState,
  initial: { connections: [] },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.invalid}>Plugin settings state is unavailable.</p>,
});
