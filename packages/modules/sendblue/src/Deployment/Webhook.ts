import { Engine } from "@macrograph/module";
import { Effect } from "effect";

import { AccountId } from "../Definition.ts";
import SendblueEngineLive from "../Engine.ts";
import SendblueModule from "../Module.ts";
import { handler as pollingHandler, requirements as pollingRequirements } from "../Polling.ts";
import { handler, WebhookIngress } from "../Webhook.ts";

export default Engine.withPollingIngress(
  Engine.withHttpIngress(Engine.deployment(SendblueModule, SendblueEngineLive), {
    handlers: [handler],
    requirements: (state) =>
      Effect.succeed(
        Object.entries(state.accounts).flatMap(([accountId, account]) =>
          account.mode !== "webhook" || account.webhookSecret === null
            ? []
            : [
                WebhookIngress.require({
                  instanceKey: accountId,
                  displayName: account.name,
                  metadata: { accountId: AccountId.make(accountId) },
                  configuration: { signingSecret: account.webhookSecret },
                }),
              ],
        ),
      ),
  }),
  { handlers: [pollingHandler], requirements: pollingRequirements },
);
