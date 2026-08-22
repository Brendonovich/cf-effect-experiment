import { Engine } from "@macrograph/plugin";
import { Effect } from "effect";

import { AccountId } from "../Definition.ts";
import { make as makeEngine } from "../Engine.ts";
import TwitchPlugin from "../Plugin.ts";
import {
  EventSubIngress,
  handler,
  make as makeEventSub,
} from "../WebhookEventSub.ts";

export default Engine.withHttpIngress(
  Engine.deployment(TwitchPlugin, makeEngine(makeEventSub)),
  {
    handlers: [handler],
    requirements: (state) =>
      Effect.succeed(
        Object.entries(state.accounts).map(([accountId, account]) =>
          EventSubIngress.require({
            instanceKey: accountId,
            metadata: { accountId: AccountId.make(accountId) },
            configuration: { subscriptions: account.subscriptions },
          }),
        ),
      ),
  },
);
