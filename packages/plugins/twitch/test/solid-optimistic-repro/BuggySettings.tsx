import { Effect } from "effect";
import { For, action, affects, createOptimistic, type Component } from "solid-js";

import type { SettingsProps } from "../../src/Settings.tsx";

const BuggySettings: Component<SettingsProps> = (props) => {
  const run = action(async function* (
    effect: Effect.Effect<void, unknown>,
    optimistic: () => void,
  ) {
    optimistic();
    yield;
    const success = await Effect.runPromise(effect).then(
      () => true,
      () => false,
    );
    yield;
    if (!success) return;
    yield props.onChanged();
  });

  return (
    <For each={props.state().accounts} keyed={(account) => account.id}>
      {(account) => {
        const [state, setState] = createOptimistic(() => account().eventSubSocket.state);
        return (
          <section>
            <h3>{account().displayName}</h3>
            <p>EventSub {state()}</p>
            <button
              type="button"
              disabled={state() === "connecting"}
              aria-busy={state() === "connecting" ? "true" : undefined}
              onClick={() => {
                const connected = state() === "connected";
                void run(
                  connected
                    ? props.rpc.DisconnectEventSub({ accountId: account().id })
                    : props.rpc.ConnectEventSub({ accountId: account().id }),
                  () => {
                    setState(connected ? "disconnected" : "connecting");
                    affects(state);
                  },
                );
              }}
            >
              {state() === "connected" ? "Disconnect" : "Connect"}
            </button>
          </section>
        );
      }}
    </For>
  );
};

export default BuggySettings;
