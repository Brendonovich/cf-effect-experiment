import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, createSignal, createUniqueId } from "solid-js";

import { type ButtonId, ClientRpcs, ClientState, DEFAULT_PORT } from "./Definition.ts";
import plugin from "./Plugin.ts";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 16 },
  hint: { color: colors.gray11, fontSize: 12, margin: 0 },
  section: { display: "flex", flexDirection: "column", gap: 8 },
  heading: { color: colors.gray12, fontSize: 14, fontWeight: 600, margin: 0 },
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
  actions: { display: "flex", flexWrap: "wrap", gap: 8 },
  list: { display: "flex", flexDirection: "column", gap: 4 },
  empty: {
    color: colors.gray11,
    fontSize: 12,
    fontStyle: "italic",
    padding: 8,
    textAlign: "center",
  },
  row: {
    alignItems: "center",
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
  meta: {
    color: colors.gray11,
    fontFamily: "monospace",
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  status: {
    alignItems: "center",
    display: "flex",
    flexDirection: "row",
    gap: 8,
  },
  statusRow: {
    alignItems: "center",
    color: colors.gray12,
    display: "flex",
    flexDirection: "row",
    fontSize: 13,
    gap: 8,
  },
  dot: { borderRadius: "50%", flexShrink: 0, height: 8, width: 8 },
  green: { backgroundColor: "var(--green-9)" },
  gray: { backgroundColor: colors.gray8 },
  error: { color: colors.red9, fontSize: 12, margin: 0 },
});

export const settings = ClientSettings.make({
  plugin,
  state: ClientState,
  initial: { servers: [], buttons: [], devices: [] },
  rpcs: ClientRpcs,
  render: (state, context) => {
    const formId = createUniqueId();
    const [error, setError] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [editing, setEditing] = createSignal<ButtonId | undefined>(undefined);
    const [name, setName] = createSignal("");

    const run = async (effect: Effect.Effect<unknown, unknown>) => {
      if (busy()) return false;
      setBusy(true);
      setError("");
      try {
        await Effect.runPromise(effect);
        await context.onChanged();
        return true;
      } catch (reason: unknown) {
        setError(
          typeof reason === "object" && reason !== null && "message" in reason
            ? String(reason.message)
            : typeof reason === "object" && reason !== null && "reason" in reason
              ? String(reason.reason)
              : String(reason),
        );
        return false;
      } finally {
        setBusy(false);
      }
    };

    const resetForm = () => {
      setEditing(undefined);
      setName("");
    };

    const saveButton = async () => {
      const id = editing();
      const effect =
        id === undefined
          ? context.rpc.StreamDeckAddButton({ name: name() })
          : context.rpc.StreamDeckUpdateButton({ id, name: name() });
      if (await run(effect)) resetForm();
    };

    const bridge = () => {
      const servers = state().servers;
      const running = servers.some((server) => server.status === "running");
      const connected = servers.some((server) => server.clientCount > 0);
      const errorMessage = servers.find((server) => server.error !== undefined)?.error;
      return { running, connected, errorMessage, count: servers.length };
    };

    return (
      <div sx={styles.stack}>
        <p sx={styles.hint}>
          Create buttons here, then create a matching <strong>Constant</strong> (left sidebar →
          Constants → Stream Deck Button) so nodes can select them. Bind keys from the Stream Deck
          property inspector. The bridge listens automatically on port {DEFAULT_PORT}.
        </p>

        <div sx={styles.section}>
          <h3 sx={styles.heading}>Bridge</h3>
          <div sx={styles.statusRow}>
            <span sx={[styles.dot, bridge().running ? styles.green : styles.gray]} />
            <span>
              Listener {bridge().running ? "running" : bridge().count === 0 ? "starting…" : "stopped"}
            </span>
          </div>
          <div sx={styles.statusRow}>
            <span sx={[styles.dot, bridge().connected ? styles.green : styles.gray]} />
            <span>Plugin {bridge().connected ? "connected" : "not connected"}</span>
          </div>
          <Show when={bridge().errorMessage}>
            {(message) => (
              <p role="status" sx={styles.error}>
                {message()}
              </p>
            )}
          </Show>
        </div>

        <div sx={styles.section}>
          <h3 sx={styles.heading}>Buttons</h3>
          <div sx={styles.form}>
            <div sx={styles.field}>
              <label for={`${formId}-name`} sx={styles.label}>
                Name
              </label>
              <input
                id={`${formId}-name`}
                sx={styles.input}
                value={name()}
                placeholder="Mute Mic"
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </div>
            <div sx={styles.actions}>
              <Button
                variant="primary"
                disabled={busy() || name().trim().length === 0}
                onClick={() => void saveButton()}
              >
                {editing() === undefined ? "Add Button" : "Save Button"}
              </Button>
              <Show when={editing() !== undefined}>
                <Button variant="secondary" disabled={busy()} onClick={resetForm}>
                  Cancel
                </Button>
              </Show>
            </div>
          </div>
          <div sx={styles.list}>
            <Show
              when={state().buttons.length > 0}
              fallback={<p sx={styles.empty}>No buttons yet.</p>}
            >
              <For each={state().buttons}>
                {(button) => (
                  <div sx={styles.row}>
                    <div sx={styles.details}>
                      <span sx={styles.name}>{button.name}</span>
                      <span sx={styles.status}>
                        <span sx={[styles.dot, button.bound ? styles.green : styles.gray]} />
                        <span sx={styles.meta}>
                          {button.bound
                            ? `${button.deviceId ?? "device"} @ ${button.column},${button.row}`
                            : "unbound"}
                        </span>
                      </span>
                    </div>
                    <div sx={styles.actions}>
                      <Button
                        variant="secondary"
                        disabled={busy()}
                        onClick={() => {
                          setEditing(button.id);
                          setName(button.name);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy()}
                        onClick={() =>
                          void run(context.rpc.StreamDeckRemoveButton({ id: button.id }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div sx={styles.section}>
          <h3 sx={styles.heading}>Devices</h3>
          <div sx={styles.list}>
            <Show
              when={state().devices.length > 0}
              fallback={
                <p sx={styles.empty}>
                  No devices connected. Open the Stream Deck app with the MacroGraph plugin
                  installed.
                </p>
              }
            >
              <For each={state().devices}>
                {(device) => (
                  <div sx={styles.row}>
                    <div sx={styles.details}>
                      <span sx={styles.name}>{device.type}</span>
                      <span sx={styles.meta}>
                        {device.id}
                        {device.columns !== undefined && device.rows !== undefined
                          ? ` · ${device.columns}×${device.rows}`
                          : ""}
                        {` · ${device.bindingCount} bound`}
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <Show when={error()}>
          <p role="status" sx={styles.error}>
            {error()}
          </p>
        </Show>
      </div>
    );
  },
  renderInvalid: () => <p>Stream Deck settings state is unavailable.</p>,
});
