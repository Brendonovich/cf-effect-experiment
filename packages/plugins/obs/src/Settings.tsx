import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Match, Show, Switch, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState, SocketAddress, type HighVolumeEvents } from "./Definition.ts";
import OBSPlugin from "./Plugin.ts";

const sm = "@media (min-width: 640px)";
const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 16 },
  eventOptions: {
    border: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: 0,
    minWidth: 0,
    padding: 0,
  },
  eventLegend: { color: colors.gray11, fontSize: 12, marginBottom: 8 },
  checkbox: { alignItems: "center", color: colors.gray11, display: "flex", fontSize: 12, gap: 6 },
  hint: { color: colors.gray11, fontSize: 12, margin: 0, overflowWrap: "anywhere" },
  tableScroll: { overflowX: "auto", width: "100%" },
  form: {
    backgroundColor: colors.gray3,
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 12,
  },
  grid: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: { default: "1fr", [sm]: "repeat(2, minmax(0, 1fr))" },
  },
  formRow: {
    alignItems: { default: "stretch", [sm]: "flex-end" },
    display: "flex",
    flexDirection: { default: "column", [sm]: "row" },
    gap: 12,
  },
  label: {
    color: colors.gray11,
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
    fontWeight: 500,
    gap: 4,
  },
  grow: { flex: 1 },
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
  },
  mono: { fontFamily: "monospace", fontSize: 12 },
  primaryButton: {
    backgroundColor: { default: colors.gray12, ":hover": colors.gray11 },
    border: 0,
    borderRadius: 2,
    color: colors.gray1,
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 600,
    height: 32,
    paddingInline: 12,
  },
  table: { tableLayout: "auto", width: "100%", fontSize: 14 },
  tableHead: { color: colors.gray11, fontSize: 12, textAlign: "left" },
  heading: { fontWeight: 500, paddingRight: 8 },
  cell: { paddingBlock: 6, paddingRight: 8 },
  rightCell: { paddingBlock: 6, textAlign: "right" },
  name: { color: colors.gray12, fontWeight: 500, marginRight: 8 },
  address: { color: colors.gray11, fontFamily: "monospace", fontSize: 12 },
  state: { color: colors.gray12, paddingBlock: 6, paddingRight: 8 },
  stateLabel: { marginRight: 12 },
  muted: { color: colors.gray11 },
  error: { color: colors.red10 },
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
  empty: {
    color: colors.gray11,
    fontSize: 12,
    fontStyle: "italic",
    paddingBlock: 8,
    textAlign: "center",
  },
  invalid: { color: colors.red10, fontSize: 12 },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly AddSocket: (payload: {
      readonly address: SocketAddress;
      readonly name?: string;
      readonly password?: string;
      readonly highVolumeEvents?: typeof HighVolumeEvents.Type;
    }) => Effect.Effect<void, unknown>;
    readonly UpdateSocket: (payload: {
      readonly currentAddress: SocketAddress;
      readonly address: SocketAddress;
      readonly name?: string;
      readonly connectOnStartup: boolean;
      readonly highVolumeEvents: typeof HighVolumeEvents.Type;
    }) => Effect.Effect<void, unknown>;
    readonly RemoveSocket: (payload: {
      readonly address: SocketAddress;
    }) => Effect.Effect<void, unknown>;
    readonly ConnectSocket: (payload: {
      readonly address: SocketAddress;
    }) => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const HighVolumeOptions: Component<{
  readonly value: typeof HighVolumeEvents.Type;
  readonly disabled: boolean;
  readonly onChange: (value: typeof HighVolumeEvents.Type) => void;
}> = (props) => (
  <fieldset sx={styles.eventOptions} disabled={props.disabled}>
    <legend sx={styles.eventLegend}>High-Volume Events (Optional)</legend>
    <div sx={styles.grid}>
      <For
        each={
          [
            ["InputVolumeMeters", "Audio meters"],
            ["InputActiveStateChanged", "Input active state"],
            ["InputShowStateChanged", "Input show state"],
            ["SceneItemTransformChanged", "Scene item transforms"],
          ] as const
        }
      >
        {([type, label]) => (
          <label sx={styles.checkbox}>
            <input
              type="checkbox"
              checked={props.value.includes(type)}
              onChange={(event) =>
                props.onChange(
                  event.currentTarget.checked
                    ? [...props.value, type]
                    : props.value.filter((value) => value !== type),
                )
              }
            />
            {label}
          </label>
        )}
      </For>
    </div>
  </fieldset>
);

const Settings: Component<SettingsProps> = (props) => {
  const [address, setAddress] = createSignal("ws://localhost:4455");
  const [password, setPassword] = createSignal("");
  const [name, setName] = createSignal("");
  const [highVolumeEvents, setHighVolumeEvents] = createSignal<typeof HighVolumeEvents.Type>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  const run = async (effect: Effect.Effect<unknown, unknown>) => {
    if (busy()) return false;
    setBusy(true);
    setError("");
    try {
      await Effect.runPromise(effect);
      await props.onChanged();
      return true;
    } catch {
      setError("Could not update the OBS connection. Check its status and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const succeeded = await run(
      props.rpc.AddSocket({
        address: SocketAddress.make(address()),
        ...(name() === "" ? {} : { name: name() }),
        ...(password() === "" ? {} : { password: password() }),
        highVolumeEvents: highVolumeEvents(),
      }),
    );
    if (succeeded) {
      setAddress("ws://localhost:4455");
      setPassword("");
      setName("");
      setHighVolumeEvents([]);
    }
  };

  const ConnectionForm = () => (
    <form
      sx={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div sx={styles.grid}>
        <label sx={styles.label}>
          Address
          <input
            sx={[styles.focus, styles.input, styles.mono]}
            value={address()}
            required
            disabled={busy()}
            onInput={(event) => setAddress(event.currentTarget.value)}
          />
        </label>
        <label sx={styles.label}>
          Password
          <input
            type="password"
            autocomplete="new-password"
            disabled={busy()}
            sx={[styles.focus, styles.input]}
            value={password()}
            placeholder="Optional"
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </label>
      </div>
      <div sx={styles.formRow}>
        <label sx={[styles.label, styles.grow]}>
          Name
          <input
            sx={[styles.focus, styles.input]}
            value={name()}
            placeholder="Optional"
            maxlength={80}
            disabled={busy()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <button type="submit" disabled={busy()} sx={[styles.focus, styles.primaryButton]}>
          Connect
        </button>
      </div>
      <HighVolumeOptions
        value={highVolumeEvents()}
        disabled={busy()}
        onChange={setHighVolumeEvents}
      />
      <p sx={styles.hint}>
        High-volume events can drop intermediate updates under load. Changing options reconnects
        startup-enabled connections.
      </p>
    </form>
  );

  return (
    <div sx={styles.stack}>
      <ConnectionForm />
      <Show when={error()}>
        <p role="alert" sx={styles.error}>
          {error()}
        </p>
      </Show>
      <Show when={props.state().sockets.length > 0}>
        <div sx={styles.tableScroll}>
          <table sx={styles.table}>
            <thead>
              <tr sx={styles.tableHead}>
                <th sx={styles.heading}>IP Address</th>
                <th sx={styles.heading}>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <For each={props.state().sockets}>
                {(socket) => (
                  <tr>
                    <td sx={styles.cell}>
                      <Show when={socket.name}>
                        {(name) => <span sx={styles.name}>{name()}</span>}
                      </Show>
                      <span sx={styles.address}>{socket.address}</span>
                      <HighVolumeOptions
                        value={socket.highVolumeEvents ?? []}
                        disabled={busy()}
                        onChange={(events) =>
                          void run(
                            props.rpc.UpdateSocket({
                              currentAddress: socket.address,
                              address: socket.address,
                              ...(socket.name === undefined ? {} : { name: socket.name }),
                              connectOnStartup: socket.connectOnStartup,
                              highVolumeEvents: events,
                            }),
                          )
                        }
                      />
                    </td>
                    <td sx={styles.state}>
                      <Switch>
                        <Match when={socket.state === "connected"}>Connected</Match>
                        <Match when={socket.state === "connecting"}>Connecting...</Match>
                        <Match when={socket.state === "disconnected" || socket.state === "error"}>
                          <span
                            sx={[
                              styles.stateLabel,
                              socket.state === "error" ? styles.error : styles.muted,
                            ]}
                          >
                            {socket.state === "error" ? (socket.error ?? "Error") : "Disconnected"}
                          </span>
                          <button
                            type="button"
                            disabled={busy()}
                            sx={[styles.focus, styles.actionButton]}
                            onClick={() =>
                              void run(props.rpc.ConnectSocket({ address: socket.address }))
                            }
                          >
                            Connect
                          </button>
                        </Match>
                      </Switch>
                    </td>
                    <td sx={styles.rightCell}>
                      <button
                        type="button"
                        disabled={busy()}
                        sx={[styles.focus, styles.removeButton]}
                        onClick={() =>
                          void run(props.rpc.RemoveSocket({ address: socket.address }))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
      <Show when={props.state().sockets.length === 0}>
        <p sx={styles.empty}>No OBS connections</p>
      </Show>
    </div>
  );
};

export default Settings;

export const settings = ClientSettings.make({
  plugin: OBSPlugin,
  state: ClientState,
  initial: { sockets: [] },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.invalid}>Plugin settings state is unavailable.</p>,
});
