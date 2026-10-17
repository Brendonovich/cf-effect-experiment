import { assert, describe, it } from "@effect/vitest";
import { HttpEndpoint } from "@macrograph/module";
import * as HttpIngress from "@macrograph/module/HttpIngress";
import { Effect } from "effect";

import { AccountId } from "../src/Definition.ts";
import deployment from "../src/Deployment/Webhook.ts";
import { handler as webhookHandler } from "../src/Webhook.ts";

const delivery = {
  message_handle: "message-1",
  is_outbound: false,
  status: "RECEIVED",
  from_number: "+15125550101",
  to_number: "+15125550100",
  content: "Hello!",
  media_url: "",
  service: "iMessage",
  message_type: "message",
  group_id: "",
  date_sent: "2026-10-13T12:00:00Z",
};

const request = (signingSecret: string, payload: unknown = delivery) => ({
  endpoint: {
    id: HttpEndpoint.Id.make("endpoint-1"),
    url: "https://example.com/ingress/project/endpoint-1",
    schema: {
      id: HttpEndpoint.HandlerId.make("sendblue:receive"),
      displayName: "Receive Messages",
    },
    instanceKey: HttpEndpoint.InstanceKey.make("primary"),
    metadata: { accountId: AccountId.make("primary") },
  },
  configuration: { signingSecret: "secret-token" },
  method: "POST",
  headers: { "sb-signing-secret": signingSecret },
  body: new TextEncoder().encode(JSON.stringify(payload)),
});

describe("Sendblue webhook", () => {
  it.effect("derives an ingress requirement only when configured", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* deployment.httpIngress.requirements({
          accounts: {},
        }),
        [],
      );
      const requirements = yield* deployment.httpIngress.requirements({
        accounts: {
          primary: {
            name: "Primary",
            apiKey: "key",
            apiSecret: "api-secret",
            webhookSecret: "secret-token",
            mode: "webhook",
          },
        },
      });
      assert.deepStrictEqual(yield* HttpIngress.manifest(requirements), [
        {
          handlerId: HttpEndpoint.HandlerId.make("sendblue:receive"),
          moduleId: "sendblue",
          instanceKey: HttpEndpoint.InstanceKey.make("primary"),
          displayName: "Primary",
          metadata: { accountId: "primary" },
          configuration: { signingSecret: "secret-token" },
        },
      ]);
    }),
  );

  it.effect("accepts a signed inbound message and deduplicates by message handle", () =>
    Effect.gen(function* () {
      const handler = yield* webhookHandler.build;
      const response = yield* handler.handle(request("secret-token"));
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.events[0]?.eventType, "SendblueMessageReceived");
      assert.strictEqual(response.events[0]?.eventId, "message-1");
      assert.deepInclude(response.events[0]?.payload, {
        accountId: "primary",
        fromNumber: "+15125550101",
        toNumber: "+15125550100",
        content: "Hello!",
      });
    }),
  );

  it.effect("rejects an invalid secret and ignores outbound callbacks", () =>
    Effect.gen(function* () {
      const handler = yield* webhookHandler.build;
      const rejected = yield* handler.handle(request("wrong-secret"));
      assert.strictEqual(rejected.status, 403);
      assert.deepStrictEqual(rejected.events, []);
      const outbound = yield* handler.handle(
        request("secret-token", { ...delivery, is_outbound: true, status: "SENT" }),
      );
      assert.strictEqual(outbound.status, 200);
      assert.deepStrictEqual(outbound.events, []);
    }),
  );
});
