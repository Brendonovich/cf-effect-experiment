import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, Show, createSignal, createUniqueId } from "solid-js";

import {
  ClientRpcs,
  ClientState,
  type DeviceDefinition,
  type DeviceId,
  type LightState,
} from "./Definition.ts";
import plugin from "./Plugin.ts";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 12 },
  form: {
    backgroundColor: colors.gray3,
    borderRadius: 6,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  field: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: colors.gray11 },
  input: {
    backgroundColor: colors.gray2,
    border: 0,
    borderRadius: 2,
    boxShadow: `0 0 0 1px ${colors.gray6}`,
    color: colors.gray12,
    height: 32,
    paddingInline: 8,
    width: "100%",
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 8 },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingBlock: 8,
    borderBottom: `1px solid ${colors.gray6}`,
  },
  address: {
    color: colors.gray11,
    fontFamily: "monospace",
    fontSize: 12,
    overflowWrap: "anywhere",
  },
  hint: { color: colors.gray11, fontSize: 12 },
  status: { color: colors.gray12, fontSize: 12 },
});

interface SettingsProps {
  readonly state: () => typeof ClientState.Type;
  readonly onChanged: () => Promise<void>;
  readonly rpc: {
    readonly ElgatoKeyLightAddDevice: (
      payload: Omit<DeviceDefinition, "id">,
    ) => Effect.Effect<DeviceId, unknown>;
    readonly ElgatoKeyLightUpdateDevice: (
      payload: DeviceDefinition,
    ) => Effect.Effect<void, unknown>;
    readonly ElgatoKeyLightRemoveDevice: (payload: {
      id: DeviceId;
    }) => Effect.Effect<void, unknown>;
    readonly ElgatoKeyLightTestDevice: (payload: {
      id: DeviceId;
    }) => Effect.Effect<LightState, unknown>;
  };
}

function Settings(props: SettingsProps) {
  const formId = createUniqueId();
  const [editing, setEditing] = createSignal<DeviceId | undefined>(undefined);
  const [name, setName] = createSignal("");
  const [url, setUrl] = createSignal("http://192.168.1.20:9123");
  const [timeout, setTimeout] = createSignal("5000");
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal("");

  const reset = () => {
    setEditing(undefined);
    setName("");
    setUrl("http://192.168.1.20:9123");
    setTimeout("5000");
  };
  const run = async (effect: Effect.Effect<string, unknown>) => {
    if (busy()) return false;
    setBusy(true);
    setStatus("");
    try {
      const result = await Effect.runPromise(effect);
      await props.onChanged();
      setStatus(result);
      return true;
    } catch (error) {
      setStatus(
        typeof error === "object" && error !== null && "reason" in error
          ? String(error.reason)
          : error instanceof Error
            ? error.message
            : String(error),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const id = editing();
    const payload = { name: name(), url: url(), timeoutMs: Number(timeout()) };
    const effect =
      id === undefined
        ? props.rpc.ElgatoKeyLightAddDevice(payload).pipe(Effect.asVoid)
        : props.rpc.ElgatoKeyLightUpdateDevice({ ...payload, id });
    if (await run(effect.pipe(Effect.as("Device saved.")))) reset();
  };

  return (
    <div sx={styles.stack}>
      <p sx={styles.hint}>
        Configure a Key Light reachable from the server. HTTP port defaults to 9123. No discovery,
        polling or requests occur until a node runs or you test a device.
      </p>
      <form
        sx={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label sx={styles.field} for={`${formId}-name`}>
          Name
          <input
            sx={styles.input}
            id={`${formId}-name`}
            required
            maxlength={80}
            value={name()}
            disabled={busy()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <label sx={styles.field} for={`${formId}-url`}>
          Device HTTP URL
          <input
            sx={styles.input}
            id={`${formId}-url`}
            type="url"
            required
            maxlength={2048}
            value={url()}
            disabled={busy()}
            onInput={(event) => setUrl(event.currentTarget.value)}
          />
        </label>
        <label sx={styles.field} for={`${formId}-timeout`}>
          Request Timeout (milliseconds)
          <input
            sx={styles.input}
            id={`${formId}-timeout`}
            type="number"
            required
            min={100}
            max={30000}
            step={1}
            value={timeout()}
            disabled={busy()}
            onInput={(event) => setTimeout(event.currentTarget.value)}
          />
        </label>
        <div sx={styles.actions}>
          <Button type="submit" disabled={busy()}>
            {editing() ? "Save Device" : "Add Device"}
          </Button>
          <Show when={editing()}>
            <Button type="button" disabled={busy()} onClick={reset}>
              Cancel Edit
            </Button>
          </Show>
        </div>
      </form>
      <p role="status" aria-live="polite" sx={styles.status}>
        {status()}
      </p>
      <For
        each={props.state().devices}
        fallback={<p sx={styles.hint}>No Key Lights configured.</p>}
      >
        {(device) => (
          <div sx={styles.row}>
            <strong>{device.name}</strong>
            <span sx={styles.address}>
              {device.url} ({device.timeoutMs}ms timeout)
            </span>
            <div sx={styles.actions}>
              <Button
                type="button"
                disabled={busy()}
                onClick={() => {
                  setEditing(device.id);
                  setName(device.name);
                  setUrl(device.url);
                  setTimeout(String(device.timeoutMs));
                }}
              >
                Edit
              </Button>
              <Button
                type="button"
                disabled={busy()}
                onClick={() =>
                  void run(
                    props.rpc
                      .ElgatoKeyLightTestDevice({ id: device.id })
                      .pipe(
                        Effect.map(
                          (state) =>
                            `${device.name}: ${state.on ? "on" : "off"}, ${state.brightness}% brightness, ${state.kelvin} K.`,
                        ),
                      ),
                  )
                }
              >
                Test
              </Button>
              <Button
                type="button"
                disabled={busy()}
                onClick={async () => {
                  if (
                    (await run(
                      props.rpc
                        .ElgatoKeyLightRemoveDevice({ id: device.id })
                        .pipe(Effect.as("Device removed.")),
                    )) &&
                    editing() === device.id
                  )
                    reset();
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

export const settings = ClientSettings.make({
  plugin,
  state: ClientState,
  initial: { devices: [] },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <Settings state={state} rpc={context.rpc} onChanged={context.onChanged} />
  ),
  renderInvalid: () => <p>Elgato Key Light settings state is unavailable.</p>,
});
