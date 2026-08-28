import { Button } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import * as stylex from "@stylexjs/stylex";
import { Effect } from "effect";
import { For, createSignal, createUniqueId } from "solid-js";

import { ClientRpcs, ClientState, initialClientState } from "./Definition.ts";
import plugin from "./Plugin.ts";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: 12 },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 12,
    borderRadius: 6,
    backgroundColor: colors.gray3,
  },
  field: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: colors.gray11 },
  input: {
    width: "100%",
    height: 32,
    paddingInline: 8,
    border: 0,
    borderRadius: 2,
    backgroundColor: colors.gray2,
    color: colors.gray12,
    boxShadow: `0 0 0 1px ${colors.gray6}`,
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 8 },
  hint: { fontSize: 12, color: colors.gray11, overflowWrap: "anywhere" },
});

export const settings = ClientSettings.make({
  plugin,
  state: ClientState,
  initial: initialClientState,
  rpcs: ClientRpcs,
  render: (state, context) => {
    const id = createUniqueId();
    const [host, setHost] = createSignal("");
    const [timeout, setTimeout] = createSignal("10000");
    const [securityCode, setSecurityCode] = createSignal("");
    const [busy, setBusy] = createSignal(false);
    const [status, setStatus] = createSignal("");
    const run = async (effect: Effect.Effect<unknown, unknown>, message: string) => {
      if (busy()) return;
      setBusy(true);
      setStatus("");
      try {
        await Effect.runPromise(effect);
        await context.onChanged();
        setStatus(message);
      } catch {
        // Never render raw RPC errors: transport/provider details can contain credentials.
        setStatus(
          "Gateway operation failed. Check the address, credential, network and supported values.",
        );
      } finally {
        setBusy(false);
      }
    };
    return (
      <div sx={styles.stack}>
        <p sx={styles.hint}>
          TRADFRI gateway only, not DIRIGERA. Enter its IPv4 address or DNS hostname reachable from
          the server (UDP 5684). Pair with the security code printed on the gateway. Credentials
          remain in project storage; protect project files and backups. No discovery or observation
          runs at mount.
        </p>
        <p sx={styles.hint}>
          {state().host || "No gateway configured"}.{" "}
          {state().hasCredentials ? "Credentials saved." : "Not paired."}
          {state().connected ? " Connected." : " Disconnected (requests reconnect on demand)."}
        </p>
        <form
          sx={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            const code = securityCode();
            setSecurityCode("");
            void run(
              context.rpc.IkeaPair({
                host: host(),
                timeoutMs: Number(timeout()),
                securityCode: code,
              }),
              "Paired. Refresh lights to populate graph resources.",
            );
          }}
        >
          <label sx={styles.field} for={`${id}-host`}>
            Gateway Host
            <input
              sx={styles.input}
              id={`${id}-host`}
              required
              maxlength={253}
              value={host()}
              placeholder="192.168.1.20"
              disabled={busy()}
              onInput={(e) => setHost(e.currentTarget.value)}
            />
          </label>
          <label sx={styles.field} for={`${id}-timeout`}>
            Timeout (milliseconds)
            <input
              sx={styles.input}
              id={`${id}-timeout`}
              type="number"
              min={1000}
              max={30000}
              step={1}
              required
              value={timeout()}
              disabled={busy()}
              onInput={(e) => setTimeout(e.currentTarget.value)}
            />
          </label>
          <label sx={styles.field} for={`${id}-code`}>
            Gateway Security Code (pairing only)
            <input
              sx={styles.input}
              id={`${id}-code`}
              type="password"
              autocomplete="off"
              maxlength={128}
              required
              value={securityCode()}
              disabled={busy()}
              onInput={(e) => setSecurityCode(e.currentTarget.value)}
            />
          </label>
          <div sx={styles.actions}>
            <Button type="submit" disabled={busy()}>
              Pair Gateway
            </Button>
            <Button
              type="button"
              disabled={busy()}
              onClick={() => {
                setHost(state().host);
                setTimeout(String(state().timeoutMs));
              }}
            >
              Use Saved Address
            </Button>
            <Button
              type="button"
              disabled={busy() || !state().hasCredentials}
              onClick={() =>
                void run(
                  context.rpc.IkeaConfigure({ host: host(), timeoutMs: Number(timeout()) }),
                  "Address saved; existing credentials retained.",
                )
              }
            >
              Save Address
            </Button>
          </div>
        </form>
        <div sx={styles.actions}>
          <Button
            disabled={busy() || !state().hasCredentials}
            onClick={() =>
              void run(context.rpc.IkeaReconnect(), "Connected using saved credentials.")
            }
          >
            Reconnect
          </Button>
          <Button
            disabled={busy() || !state().hasCredentials}
            onClick={() => void run(context.rpc.IkeaRefreshLights(), "Light resources refreshed.")}
          >
            Refresh Lights
          </Button>
          <Button
            disabled={busy()}
            onClick={() =>
              void run(
                context.rpc.IkeaDisconnect(),
                "Disconnected. A future request reconnects on demand.",
              )
            }
          >
            Disconnect
          </Button>
          <Button
            disabled={busy()}
            onClick={() =>
              void run(
                context.rpc.IkeaForget(),
                "Gateway credentials and resources removed from this project.",
              )
            }
          >
            Forget Gateway
          </Button>
        </div>
        <p role="status" aria-live="polite" sx={styles.hint}>
          {status()}
        </p>
        <For
          each={state().lights}
          fallback={<p sx={styles.hint}>No light resources. Pair and refresh lights.</p>}
        >
          {(light) => (
            <p sx={styles.hint}>
              {light.name} (ID {light.id})
            </p>
          )}
        </For>
        <p sx={styles.hint}>
          Light State Changed is deferred: this port does not subscribe to CoAP observations or emit
          events.
        </p>
      </div>
    );
  },
  renderInvalid: () => <p>IKEA settings state is unavailable.</p>,
});
