import { assert, describe, it } from "@effect/vitest";
import { HttpEndpoint, HttpIngress } from "@macrograph/module";
import { Effect, Layer, Option, Redacted } from "effect";

import { AccountId, WebhookId } from "../src/Definition.ts";
import deployment from "../src/Deployment/Webhook.ts";
import { handler as webhookHandler } from "../src/Webhook.ts";

const secret = "github-webhook-secret";
const endpoint = {
  id: HttpEndpoint.Id.make("endpoint-1"),
  url: "https://example.com/ingress/project/endpoint-1",
  schema: {
    id: HttpEndpoint.HandlerId.make("github:repository"),
    displayName: "Repository Webhook",
  },
  instanceKey: HttpEndpoint.InstanceKey.make("primary"),
  metadata: { webhookId: WebhookId.make("primary"), owner: "macrograph", repository: "macrograph" },
};
const hostService: HttpEndpoint.Service = {
  ensure: (_handler, options) => Effect.succeed({ ...endpoint, metadata: options.metadata }),
  get: () => Effect.succeed(Option.none()),
  remove: () => Effect.void,
  lookup: () => Effect.succeed(Option.none()),
  secret: () => Effect.succeed(Redacted.make(secret)),
};
const host = Layer.succeed(HttpEndpoint.Host, hostService);
const sign = async (body: Uint8Array) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, Uint8Array.from(body));
  return `sha256=${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
};
const request = async (event = "push", signature?: string) => {
  const body = new TextEncoder().encode(
    JSON.stringify({ ref: "refs/heads/main", sender: { login: "octocat" } }),
  );
  return {
    endpoint,
    configuration: { events: ["push" as const] },
    method: "POST",
    headers: {
      "x-github-delivery": "delivery-1",
      "x-github-event": event,
      "x-hub-signature-256": signature ?? (await sign(body)),
    },
    body,
  };
};

describe("GitHub repository webhook", () => {
  it.effect("derives an ingress requirement from storage", () =>
    Effect.gen(function* () {
      const requirements = yield* deployment.httpIngress.requirements({
        webhooks: {
          [WebhookId.make("primary")]: {
            name: "Main repository",
            accountId: AccountId.make("account-1"),
            owner: "macrograph",
            repository: "macrograph",
            events: ["push", "pull_request"],
            providerHookId: 123,
          },
        },
      });
      assert.deepStrictEqual(yield* HttpIngress.manifest(requirements), [
        {
          handlerId: HttpEndpoint.HandlerId.make("github:repository"),
          moduleId: "github",
          instanceKey: HttpEndpoint.InstanceKey.make("primary"),
          displayName: "Main repository",
          metadata: { webhookId: "primary", owner: "macrograph", repository: "macrograph" },
          configuration: { events: ["push", "pull_request"] },
        },
      ]);
    }),
  );

  it.effect("verifies signatures and emits normalized deliveries", () =>
    Effect.gen(function* () {
      const live = yield* webhookHandler.build.pipe(Effect.provide(host));
      const response = yield* live.handle(yield* Effect.promise(() => request()));
      assert.strictEqual(response.status, 202);
      assert.strictEqual(response.events[0]?.eventId, "delivery-1");
      assert.deepInclude(response.events[0]?.payload, {
        webhookId: "primary",
        event: "push",
        sender: "octocat",
        owner: "macrograph",
        repository: "macrograph",
      });
    }),
  );

  it.effect("rejects invalid signatures and accepts signed pings", () =>
    Effect.gen(function* () {
      const live = yield* webhookHandler.build.pipe(Effect.provide(host));
      assert.strictEqual(
        (yield* live.handle(yield* Effect.promise(() => request("push", "sha256=bad")))).status,
        403,
      );
      assert.strictEqual(
        (yield* live.handle(yield* Effect.promise(() => request("ping")))).status,
        200,
      );
    }),
  );
});
