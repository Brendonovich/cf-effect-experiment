import { Button, createStateMachine } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, createSignal, type Component } from "solid-js";

import {
  ClientRpcs,
  ClientState,
  type ServerDefinition,
  type ServerId,
  type ServerState,
  type ServerStatus,
} from "./Definition.ts";
import WebSocketServerPlugin from "./Plugin.ts";

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
  field: { display: "flex", flexDirection: "column", gap: 4 },
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
  addGrid: {
    alignItems: { default: "stretch", [sm]: "flex-end" },
    display: "grid",
    gap: 12,
    gridTemplateColumns: { default: "1fr", [sm]: "1fr 8rem auto" },
  },
  serverRow: {
    alignItems: "center",
    display: "flex",
    flexDirection: "row",
    gap: 8,
    paddingBlock: 8,
  },
  serverContainer: {
    borderTopColor: { default: colors.gray6, ":first-child": "transparent" },
    borderTopStyle: "solid",
    borderTopWidth: 1,
  },
  serverDetails: { flex: 1, minWidth: 0 },
  inline: { alignItems: "center", display: "flex", flexDirection: "row", gap: 8 },
  serverName: {
    color: colors.gray12,
    fontSize: 14,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  endpoint: { color: colors.gray10, flexShrink: 0, fontFamily: "monospace", fontSize: 11 },
  dot: { borderRadius: "50%", flexShrink: 0, height: 8, width: 8 },
  green: { backgroundColor: "var(--green-9)" },
  yellow: { backgroundColor: "var(--yellow-9)" },
  red: { backgroundColor: colors.red9 },
  gray: { backgroundColor: colors.gray8 },
  state: { color: colors.gray11, fontSize: 12 },
  error: { color: colors.red10, fontSize: 11 },
  actions: { alignItems: "center", display: "flex", flexDirection: "row", flexShrink: 0, gap: 4 },
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
    padding: "4px 8px",
  },
  editForm: {
    alignItems: { default: "stretch", [sm]: "flex-end" },
    borderTop: `1px solid ${colors.gray6}`,
    display: "flex",
    flexDirection: { default: "column", [sm]: "row" },
    gap: 12,
    paddingBlock: 8,
  },
  editFields: {
    alignItems: { default: "stretch", [sm]: "flex-end" },
    display: "flex",
    flex: 1,
    flexDirection: { default: "column", [sm]: "row" },
    gap: 12,
  },
  nameField: { width: { default: "auto", [sm]: "40%" } },
  portField: { width: { default: "auto", [sm]: "20%" } },
  hostField: { flex: { default: "initial", [sm]: 1 } },
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
  sectionLabel: { color: colors.gray11, fontSize: 12, fontWeight: 500 },
  empty: {
    color: colors.gray10,
    fontSize: 12,
    fontStyle: "italic",
    paddingBlock: 12,
    textAlign: "center",
  },
  invalid: { color: colors.red10, fontSize: 12 },
});

export interface SettingsProps<Error = unknown> {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly WebSocketServerAdd: (payload: {
      readonly name: string;
      readonly host: string;
      readonly port: number;
    }) => Effect.Effect<ServerId, Error>;
    readonly WebSocketServerUpdate: (payload: ServerDefinition) => Effect.Effect<void, Error>;
    readonly WebSocketServerRemove: (payload: {
      readonly id: ServerId;
    }) => Effect.Effect<void, Error>;
    readonly WebSocketServerStart: (payload: {
      readonly id: ServerId;
    }) => Effect.Effect<void, Error>;
    readonly WebSocketServerStop: (payload: {
      readonly id: ServerId;
    }) => Effect.Effect<void, Error>;
  };
  readonly onChanged: () => Promise<void>;
}

const errorMessage = (error: unknown) =>
  typeof error === "object" && error !== null && "reason" in error
    ? String(error.reason)
    : "WebSocket server operation failed";

const SERVER_STATE_INDICATOR: Record<ServerStatus, { dot: stylex.StyleXStyles; label: string }> = {
  running: { dot: styles.green, label: "Running" },
  starting: { dot: styles.yellow, label: "Starting" },
  error: { dot: styles.red, label: "Error" },
  stopped: { dot: styles.gray, label: "Stopped" },
};

type ServerEditContext = {
  readonly name: string;
  readonly host: string;
  readonly port: number;
};

type ServerEditState = {
  context: ServerEditContext | undefined;
  mode: "viewing" | "editing" | "saving" | "failed";
};

type ServerEditActions = {
  readonly start: (serverId: ServerId, context: ServerEditContext) => void;
  readonly change: (serverId: ServerId, context: Partial<ServerEditContext>) => void;
  readonly save: (serverId: ServerId) => void;
  readonly failure: (serverId: ServerId) => void;
  readonly success: (serverId: ServerId) => void;
  readonly cancel: (serverId: ServerId) => void;
};

const viewingServerEdit: ServerEditState = { context: undefined, mode: "viewing" };

const Field: Component<{
  readonly label: string;
  readonly value: string | number;
  readonly type?: "text" | "number";
  readonly placeholder?: string;
  readonly onInput: (value: string) => void;
}> = (props) => (
  <label sx={styles.field}>
    <span sx={styles.label}>{props.label}</span>
    <input
      type={props.type ?? "text"}
      sx={[styles.focus, styles.input]}
      value={props.value}
      min={props.type === "number" ? 1 : undefined}
      max={props.type === "number" ? 65535 : undefined}
      placeholder={props.placeholder}
      required
      onInput={(event) => props.onInput(event.currentTarget.value)}
    />
  </label>
);

const ServerRow: Component<{
  readonly server: ServerState;
  readonly edit: () => ServerEditState;
  readonly actions: ServerEditActions;
  readonly run: (effect: Effect.Effect<unknown, unknown>) => Promise<boolean>;
  readonly rpc: SettingsProps["rpc"];
}> = (props) => {
  const indicator = () => SERVER_STATE_INDICATOR[props.server.status];

  return (
    <div sx={styles.serverContainer}>
      <div sx={styles.serverRow}>
        <div sx={styles.serverDetails}>
          <div sx={styles.inline}>
            <span sx={styles.serverName}>{props.server.definition.name}</span>
            <span sx={styles.endpoint}>
              {props.server.definition.host}:{props.server.definition.port}
            </span>
          </div>
          <div sx={styles.inline}>
            <span
              sx={[
                styles.dot,
                props.server.status === "running"
                  ? styles.green
                  : props.server.status === "starting"
                    ? styles.yellow
                    : props.server.status === "error"
                      ? styles.red
                      : styles.gray,
              ]}
            />
            <span sx={styles.state}>
              {indicator().label}
              {props.server.status === "running"
                ? ` (${props.server.clientCount} ${
                    props.server.clientCount === 1 ? "client" : "clients"
                  })`
                : ""}
            </span>
          </div>
          <Show when={props.server.error}>{(error) => <p sx={styles.error}>{error()}</p>}</Show>
        </div>
        <div sx={styles.actions}>
          <button
            type="button"
            sx={[styles.focus, styles.actionButton]}
            disabled={props.server.status === "starting"}
            onClick={() =>
              void props.run(
                props.server.status === "running"
                  ? props.rpc.WebSocketServerStop({ id: props.server.definition.id })
                  : props.rpc.WebSocketServerStart({ id: props.server.definition.id }),
              )
            }
          >
            {props.server.status === "running" ? "Stop" : "Start"}
          </button>
          <button
            type="button"
            sx={[styles.focus, styles.actionButton]}
            disabled={props.edit().mode === "saving"}
            onClick={() =>
              props.edit().mode === "viewing"
                ? props.actions.start(props.server.definition.id, {
                    name: props.server.definition.name,
                    host: props.server.definition.host,
                    port: props.server.definition.port,
                  })
                : props.actions.cancel(props.server.definition.id)
            }
          >
            {props.edit().mode === "viewing" ? "Edit" : "Cancel"}
          </button>
          <button
            type="button"
            sx={[styles.focus, styles.removeButton]}
            onClick={() =>
              void props.run(
                props.rpc.WebSocketServerRemove({ id: props.server.definition.id }),
              )
            }
          >
            Remove
          </button>
        </div>
      </div>
      <Show when={props.edit().context}>
        {(context) => (
          <form
            sx={styles.editForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (props.edit().mode === "saving") return;
              const draft = context();
              props.actions.save(props.server.definition.id);
              void props
                .run(
                  props.rpc.WebSocketServerUpdate({
                    ...props.server.definition,
                    id: props.server.definition.id,
                    ...draft,
                  }),
                )
                .then((saved) =>
                  saved
                    ? props.actions.success(props.server.definition.id)
                    : props.actions.failure(props.server.definition.id),
                );
            }}
          >
            <div sx={styles.editFields}>
              <div sx={styles.nameField}>
                <Field
                  label="Name"
                  value={context().name}
                  onInput={(name) => props.actions.change(props.server.definition.id, { name })}
                />
              </div>
              <div sx={styles.portField}>
                <Field
                  label="Port"
                  type="number"
                  value={context().port}
                  onInput={(value) =>
                    props.actions.change(props.server.definition.id, { port: Number(value) })
                  }
                />
              </div>
              <div sx={styles.hostField}>
                <Field
                  label="Host"
                  value={context().host}
                  onInput={(host) => props.actions.change(props.server.definition.id, { host })}
                />
              </div>
            </div>
            <Button type="submit" variant="primary" disabled={props.edit().mode === "saving"}>
              Save
            </Button>
          </form>
        )}
      </Show>
    </div>
  );
};

const Settings: Component<SettingsProps> = (props) => {
  const [name, setName] = createSignal("");
  const [host, setHost] = createSignal("127.0.0.1");
  const [port, setPort] = createSignal(1890);
  const [status, setStatus] = createSignal("");
  const [serverEdits, serverEditActions] = createStateMachine(
    { edits: {} as Record<string, ServerEditState | undefined> },
    {
      start(state, serverId: ServerId, context: ServerEditContext) {
        state.edits[serverId] = { context, mode: "editing" };
      },
      change(state, serverId: ServerId, context: Partial<ServerEditContext>) {
        const edit = state.edits[serverId];
        if (edit?.context === undefined || edit.mode === "saving") return;
        edit.context = { ...edit.context, ...context };
        edit.mode = "editing";
      },
      save(state, serverId: ServerId) {
        const edit = state.edits[serverId];
        if (edit?.context !== undefined) edit.mode = "saving";
      },
      failure(state, serverId: ServerId) {
        const edit = state.edits[serverId];
        if (edit?.mode === "saving") edit.mode = "failed";
      },
      success(state, serverId: ServerId) {
        if (state.edits[serverId]?.mode === "saving") state.edits[serverId] = undefined;
      },
      cancel(state, serverId: ServerId) {
        state.edits[serverId] = undefined;
      },
    },
  );

  const run = async (effect: Effect.Effect<unknown, unknown>) => {
    setStatus("");
    const result = await Effect.runPromise(effect).then(
      () => ({ success: true as const }),
      (error: unknown) => ({ success: false as const, error }),
    );
    setStatus(result.success ? "" : errorMessage(result.error));
    if (result.success) await props.onChanged();
    return result.success;
  };

  const add = async () => {
    const added = await run(
      props.rpc.WebSocketServerAdd({
        name: name(),
        host: host(),
        port: port(),
      }),
    );
    if (added) {
      setName("");
      setHost("127.0.0.1");
      setPort(1890);
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
        <Field label="Name" value={name()} onInput={setName} placeholder="My Server" />
        <div sx={styles.addGrid}>
          <Field label="Host" value={host()} onInput={setHost} placeholder="127.0.0.1" />
          <Field
            label="Port"
            type="number"
            value={port()}
            onInput={(value) => setPort(Number(value))}
          />
          <Button type="submit">Add Server</Button>
        </div>
      </form>

      <Show when={status()}>
        <p sx={styles.status}>{status()}</p>
      </Show>

      <div>
        <span sx={styles.sectionLabel}>WebSocket Servers</span>
        <Show
          when={props.state().servers.length > 0}
          fallback={<p sx={styles.empty}>No Servers</p>}
        >
          <div>
            <For each={props.state().servers}>
              {(server) => (
                <ServerRow
                  server={server}
                  edit={() => serverEdits.edits[server.definition.id] ?? viewingServerEdit}
                  actions={serverEditActions}
                  rpc={props.rpc}
                  run={run}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default Settings;

export const settings = ClientSettings.make({
  plugin: WebSocketServerPlugin,
  state: ClientState,
  initial: { servers: [] },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.invalid}>Plugin settings state is unavailable.</p>,
});
