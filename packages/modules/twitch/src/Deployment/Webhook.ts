import { Engine } from "@macrograph/module";
import { Effect } from "effect";

import { AccountId } from "../Definition.ts";
import { make as makeEngine } from "../Engine.ts";
import TwitchModule from "../Module.ts";
import { EventSubIngress, handler, make as makeEventSub } from "../WebhookEventSub.ts";

export default Engine.withHttpIngress(Engine.deployment(TwitchModule, makeEngine(makeEventSub)), {
  handlers: [handler],
  requirements: (state) =>
    Effect.succeed(
      Object.entries(state.accounts).flatMap(([accountId, account]) =>
        account.enabled
          ? [
              EventSubIngress.require({
                instanceKey: accountId,
                metadata: { accountId: AccountId.make(accountId) },
                configuration: { subscriptions: account.subscriptions },
              }),
            ]
          : [],
      ),
    ),
});
