import "@macrograph/editor-ui/styles.css";
import { render } from "@solidjs/web";
import { Effect } from "effect";
import {
  Loading,
  createEffect,
  createMemo,
  createStore,
  isPending,
  type Component,
} from "solid-js";

import { AccountId, type ClientState } from "../../src/Definition.ts";
import Settings, { type SettingsProps } from "../../src/Settings.tsx";
import BuggySettings from "./BuggySettings.tsx";
import "./repro.css";

type TwitchState = typeof ClientState.Type;
type SocketState = TwitchState["accounts"][number]["eventSubSocket"]["state"];

const ASYNC_DELAY = 1_000;
const successCase = new URLSearchParams(window.location.search).get("case") === "success";
const firstAccountId = AccountId.make("solid-2-repro-one");
const secondAccountId = AccountId.make("solid-2-repro-two");
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, ASYNC_DELAY));

const socketStates = new Map<typeof AccountId.Type, SocketState>([
	[firstAccountId, "connected"],
	[secondAccountId, "connected"],
]);
const accountEnabled = new Map<typeof AccountId.Type, boolean>([
  [firstAccountId, true],
  [secondAccountId, true],
]);
const subscriptions = new Map<typeof AccountId.Type, ReadonlyArray<string>>([
  [firstAccountId, ["channel.follow", "channel.subscribe"]],
  [secondAccountId, ["channel.chat.message"]],
]);
const twitchSnapshot = (): TwitchState => ({
  transport: "websocket",
  accounts: [
    {
      id: firstAccountId,
      displayName: "Socket 1",
      eventSubSocket: {
        state:
          accountEnabled.get(firstAccountId) === true
            ? (socketStates.get(firstAccountId) ?? "disconnected")
            : "disconnected",
      },
      enabledSubscriptions: subscriptions.get(firstAccountId) ?? [],
    },
    {
      id: secondAccountId,
      displayName: "Socket 2",
      eventSubSocket: {
        state:
          accountEnabled.get(secondAccountId) === true
            ? (socketStates.get(secondAccountId) ?? "disconnected")
            : "disconnected",
      },
      enabledSubscriptions: subscriptions.get(secondAccountId) ?? [],
    },
  ],
});

const [data, setData] = createStore({ state: twitchSnapshot() });
let request = 0;
let pendingState: { readonly request: number; readonly state: TwitchState } | undefined;
const statePending = () => isPending(() => data.state);
const commitState = (pending: NonNullable<typeof pendingState>) => {
  if (pending.request === request) setData(() => ({ state: pending.state }));
};
createEffect(statePending, (pending) => {
  if (pending || pendingState === undefined) return;
  const queued = pendingState;
  pendingState = undefined;
  queueMicrotask(() => {
    if (statePending()) {
      pendingState = queued;
      return;
    }
    commitState(queued);
  });
});
const reload = async () => {
  const currentRequest = ++request;
  await delay();
  if (currentRequest !== request) return;
  const pending = { request: currentRequest, state: twitchSnapshot() };
  pendingState = undefined;
  if (statePending()) pendingState = pending;
  else commitState(pending);
};

const rpc: SettingsProps["rpc"] = {
  ConnectEventSub: ({ accountId }) =>
    Effect.promise(async () => {
      if (accountEnabled.get(accountId) !== true) accountEnabled.set(accountId, true);
      socketStates.set(accountId, "connecting");
      await delay();
      socketStates.set(accountId, "connected");
    }),
  DisconnectEventSub: ({ accountId }) =>
    Effect.promise(async () => {
      await delay();
      socketStates.set(accountId, "disconnected");
      accountEnabled.set(accountId, false);
    }),
  ToggleEventSubSubscription: ({ accountId, subscriptionType, enabled }) =>
    Effect.promise(async () => {
      await delay();
      const current = subscriptions.get(accountId) ?? [];
      subscriptions.set(
        accountId,
        enabled
          ? [...current, subscriptionType]
          : current.filter((value) => value !== subscriptionType),
      );
    }),
};

const ConnectedSettings: Component = () => {
  const View = successCase ? Settings : BuggySettings;
  const view = createMemo(() => (
    <View state={() => data.state} rpc={rpc} onChanged={reload} />
  ));
  return <>{view()}</>;
};

render(
  () => (
    <Loading fallback={<p class="loading">Loading Twitch settings...</p>}>
      <ConnectedSettings />
    </Loading>
  ),
  document.querySelector("#app")!,
);
