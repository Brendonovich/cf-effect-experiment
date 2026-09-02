import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, action, createSignal, type Component } from "solid-js";

import { ClientRpcs, ClientState } from "./Definition.ts";
import OpenCodePlugin from "./Plugin.ts";

const styles = stylex.create({
  root: {
    color: colors.gray12,
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
    gap: 12,
    minWidth: 0,
  },
  row: { alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 },
  header: { justifyContent: "space-between" },
  heading: { fontSize: 14, fontWeight: 500, margin: 0, overflowWrap: "anywhere" },
  card: {
    backgroundColor: colors.gray3,
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    padding: 12,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  field: { display: "flex", flex: "1 1 180px", flexDirection: "column", gap: 4, minWidth: 0 },
  input: {
    backgroundColor: colors.gray2,
    border: `1px solid ${colors.gray6}`,
    borderRadius: 4,
    color: colors.gray12,
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
  remove: { color: colors.red11 },
  focus: { outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` } },
  note: { color: colors.gray11, margin: 0, overflowWrap: "anywhere" },
  address: { fontFamily: "monospace" },
  error: { color: colors.red11 },
});

export interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly rpc: {
    readonly OpenCodeSaveConnection: (payload: {
      readonly id?: string;
      readonly address: string;
      readonly name: string;
      readonly password?: string;
    }) => Effect.Effect<void, unknown>;
    readonly OpenCodeRemoveConnection: (payload: {
      readonly id: string;
    }) => Effect.Effect<void, unknown>;
    readonly OpenCodeRefresh: () => Effect.Effect<void, unknown>;
  };
  readonly onChanged: () => Promise<void>;
}

const Settings: Component<SettingsProps> = (props) => {
  const [editingId, setEditingId] = createSignal<string | undefined>(undefined);
  const [address, setAddress] = createSignal("");
  const [name, setName] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [clearPassword, setClearPassword] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [status, setStatus] = createSignal("");

  const resetForm = () => {
    setEditingId(undefined);
    setAddress("");
    setName("");
    setPassword("");
    setClearPassword(false);
  };

  const run = action(async function* (
    operation: { type: "save" } | { type: "refresh" } | { type: "remove"; id: string },
  ) {
    if (pending()) return;
    if (operation.type === "save" && address().trim().length === 0) return;
    const id = editingId();
    const effect =
      operation.type === "save"
        ? props.rpc.OpenCodeSaveConnection({
            ...(id === undefined ? {} : { id }),
            address: address().trim(),
            name: name().trim(),
            // A blank edit preserves the stored password unless explicitly cleared.
            ...(clearPassword()
              ? { password: "" }
              : password() === ""
                ? {}
                : { password: password() }),
          })
        : operation.type === "remove"
          ? props.rpc.OpenCodeRemoveConnection({ id: operation.id })
          : props.rpc.OpenCodeRefresh();
    setPending(true);
    setStatus("");
    if (operation.type === "save") setPassword("");
    yield;
    const success = await Effect.runPromise(effect).then(
      () => true,
      () => false,
    );
    const refreshed =
      success &&
      (await props.onChanged().then(
        () => true,
        () => false,
      ));
    yield;
    setPending(false);
    if (
      success &&
      (operation.type === "save" || (operation.type === "remove" && operation.id === id))
    ) {
      resetForm();
    }
    setStatus(
      !success
        ? operation.type === "save"
          ? "Could not save the connection. Check the address and password and try again."
          : operation.type === "remove"
            ? "Could not remove the connection. Try again."
            : "Could not refresh connections. Try again."
        : !refreshed
          ? "Operation completed; could not reload settings. Try Refresh."
          : operation.type === "save"
            ? "Connection saved."
            : operation.type === "remove"
              ? "Connection removed."
              : "Connections refreshed.",
    );
  });

  return (
    <section sx={styles.root}>
      <div sx={[styles.row, styles.header]}>
        <h3 sx={styles.heading}>OpenCode Servers</h3>
        <button
          type="button"
          sx={[styles.button, styles.focus]}
          disabled={pending()}
          onClick={() => void run({ type: "refresh" })}
        >
          Refresh
        </button>
      </div>
      <p sx={styles.note}>
        Running OpenCode services are discovered on the MacroGraph host, not in your browser.
        MacroGraph does not start an OpenCode server. Start OpenCode separately or add a manual
        connection.
      </p>

      <form
        sx={styles.card}
        onSubmit={(event) => {
          event.preventDefault();
          void run({ type: "save" });
        }}
      >
        <h3 sx={styles.heading}>
          {editingId() === undefined ? "Add Manual Connection" : "Edit Manual Connection"}
        </h3>
        <div sx={styles.row}>
          <label sx={styles.field}>
            Address
            <input
              type="url"
              required
              autocomplete="off"
              spellcheck={false}
              sx={[styles.input, styles.focus]}
              value={address()}
              placeholder="http://127.0.0.1:4096"
              disabled={pending()}
              onInput={(event) => setAddress(event.currentTarget.value)}
            />
          </label>
          <label sx={styles.field}>
            Name
            <input
              required
              sx={[styles.input, styles.focus]}
              value={name()}
              placeholder="Connection name"
              disabled={pending()}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label sx={styles.field}>
            Password
            <input
              type="password"
              autocomplete="new-password"
              spellcheck={false}
              sx={[styles.input, styles.focus]}
              value={password()}
              placeholder={editingId() === undefined ? "Optional" : "Leave blank to keep existing"}
              disabled={pending() || clearPassword()}
              onInput={(event) => setPassword(event.currentTarget.value)}
            />
          </label>
        </div>
        <p sx={styles.note}>
          Use an address reachable from the MacroGraph host. Enter credentials only in the password
          field. Passwords are stored on the host and are not returned by settings. Protect project
          storage and backups.
        </p>
        <Show when={editingId() !== undefined}>
          <label sx={styles.row}>
            <input
              type="checkbox"
              sx={styles.focus}
              checked={clearPassword()}
              disabled={pending()}
              onChange={(event) => {
                setClearPassword(event.currentTarget.checked);
                setPassword("");
              }}
            />
            Clear stored password
          </label>
        </Show>
        <div sx={styles.row}>
          <button
            type="submit"
            sx={[styles.button, styles.focus]}
            disabled={pending() || address().trim().length === 0}
          >
            {editingId() === undefined ? "Add Connection" : "Save Changes"}
          </button>
          <Show when={editingId() !== undefined}>
            <button
              type="button"
              sx={[styles.button, styles.focus]}
              disabled={pending()}
              onClick={resetForm}
            >
              Cancel
            </button>
          </Show>
        </div>
      </form>

      <p role="status" sx={styles.note}>
        {status()}
      </p>
      <Show when={props.state().connections.length === 0}>
        <p sx={styles.note}>
          No OpenCode connections. Start OpenCode and refresh, or add a manual connection.
        </p>
      </Show>
      <ul sx={styles.list}>
        <For each={props.state().connections}>
          {(connection) => (
            <li sx={styles.card}>
              <div sx={[styles.row, styles.header]}>
                <h3 sx={styles.heading}>{connection.name || "OpenCode"}</h3>
                <span sx={styles.note}>{connection.discovered ? "Discovered" : "Manual"}</span>
              </div>
              <p sx={[styles.note, styles.address]}>{connection.address}</p>
              <div sx={styles.row}>
                <span sx={connection.state === "error" && styles.error}>
                  {connection.state === "connected"
                    ? "Connected"
                    : connection.state === "connecting"
                      ? "Connecting"
                      : "Connection error"}
                </span>
                <span sx={styles.note}>
                  {connection.catalog.providers.length} providers /{" "}
                  {connection.catalog.models.length} models
                </span>
              </div>
              <p sx={styles.note}>
                Default model: {connection.catalog.defaultModel ?? "Not configured"}
              </p>
              <Show when={connection.state === "error"}>
                <p sx={styles.note}>
                  Could not load the catalog. Check that OpenCode is running and reachable, then
                  refresh.
                </p>
              </Show>
              <Show when={!connection.discovered}>
                <div sx={styles.row}>
                  <button
                    type="button"
                    sx={[styles.button, styles.focus]}
                    disabled={pending()}
                    onClick={() => {
                      setEditingId(connection.id);
                      setAddress(connection.address);
                      setName(connection.name);
                      setPassword("");
                      setClearPassword(false);
                      setStatus("");
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    sx={[styles.button, styles.remove, styles.focus]}
                    disabled={pending()}
                    onClick={() => void run({ type: "remove", id: connection.id })}
                  >
                    Remove
                  </button>
                </div>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
};

export default Settings;

export const settings = ClientSettings.make({
  plugin: OpenCodePlugin,
  state: ClientState,
  initial: { connections: [] },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p sx={styles.note}>Plugin settings state is unavailable.</p>,
});
