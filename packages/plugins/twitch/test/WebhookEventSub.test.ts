import { assert, describe, it } from "@effect/vitest";
import { Engine, HttpEndpoint, HttpIngress } from "@macrograph/plugin";
import { Effect, HashMap, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import { AccountId } from "../src/Definition.ts";
import deployment from "../src/Deployment/Webhook.ts";
import {
  EventSubEndpoint,
  SignatureVerifier,
  layerWebCrypto,
  make,
  type Request,
} from "../src/WebhookEventSub.ts";
import { Helix } from "../src/Helix.ts";

interface HttpCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

const headers = (type: string, signature = "sha256=valid"): Request["headers"] => ({
  "Twitch-Eventsub-Message-Id": `${type}-1`,
  "Twitch-Eventsub-Message-Timestamp": "2026-07-23T00:00:00Z",
  "Twitch-Eventsub-Message-Signature": signature,
  "Twitch-Eventsub-Message-Type": type,
});

const body = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("WebhookEventSub", () => {
  it.effect("derives its HTTP ingress manifest from engine state", () =>
    Effect.gen(function* () {
      const requirements = yield* deployment.httpIngress.requirements({
        accounts: {
          [AccountId.make("account-1")]: { subscriptions: ["channel.ban"] },
          [AccountId.make("account-2")]: {
            subscriptions: ["channel.ban", "channel.update"],
          },
        },
      });
      assert.deepStrictEqual(yield* HttpIngress.manifest(requirements), [
        {
          handlerId: "twitch:eventsub",
          pluginId: "twitch",
          instanceKey: "account-1",
          metadata: { accountId: "account-1" },
          configuration: { subscriptions: ["channel.ban"] },
        },
        {
          handlerId: "twitch:eventsub",
          pluginId: "twitch",
          instanceKey: "account-2",
          metadata: { accountId: "account-2" },
          configuration: { subscriptions: ["channel.ban", "channel.update"] },
        },
      ]);
    }),
  );

  it.effect("verifies HMAC-SHA256 signatures", () =>
    Effect.gen(function* () {
      const secret = Redacted.make("webhook-secret");
      const message = new TextEncoder().encode('message-id2026-07-23T00:00:00Z{"event":true}');
      const key = yield* Effect.promise(() =>
        globalThis.crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(Redacted.value(secret)),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
      );
      const signed = yield* Effect.promise(() =>
        globalThis.crypto.subtle.sign("HMAC", key, message),
      );
      const signature = `sha256=${[...new Uint8Array(signed)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")}`;

      const verifier = yield* SignatureVerifier;
      assert.isTrue(yield* verifier.verify(secret, message, signature));
      assert.isFalse(
        yield* verifier.verify(secret, new TextEncoder().encode("different"), signature),
      );
    }).pipe(Effect.provide(layerWebCrypto(globalThis.crypto))),
  );

  it.effect("reconciles subscriptions and handles signed deliveries", () =>
    Effect.gen(function* () {
      const accountId = AccountId.make("account-1");
      const calls: Array<HttpCall> = [];
      const verifiedMessages: Array<string> = [];
      const provisioned: Array<{ readonly handlerId: string; readonly instanceKey: string }> = [];
      const endpoint = {
        id: "endpoint-1",
        url: "https://example.com/webhooks/twitch/account-1",
        handlerId: EventSubEndpoint.id,
        instanceKey: accountId,
        metadata: { accountId },
      };

      const httpClient = HttpClient.makeWith<
        HttpClientError.HttpClientError,
        never,
        HttpClientError.HttpClientError,
        never
      >(
        (requestEffect) =>
          Effect.map(requestEffect, (request) => {
            calls.push({
              method: request.method,
              url: request.url,
              headers: { ...request.headers },
              body:
                request.body._tag === "Uint8Array"
                  ? JSON.parse(new TextDecoder().decode(request.body.body))
                  : undefined,
            });
            const response =
              request.method === "GET"
                ? { data: [], total: 0, total_cost: 0, max_total_cost: 10_000 }
                : { data: [{ id: "subscription-1" }] };
            return HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify(response), {
                status: request.method === "POST" ? 202 : 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }),
        Effect.succeed,
      );

      const dependencies = Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient)(httpClient),
        Layer.succeed(Engine.Credentials)({
          get: Effect.succeed([
            { id: accountId, provider: "twitch", token: { access: "cloud-token" } },
          ]),
          refresh: () =>
            Effect.succeed({
              id: accountId,
              provider: "twitch",
              token: { access: "refreshed-cloud-token" },
            }),
          subscribe: () => Effect.void,
        }),
        Layer.succeed(HttpEndpoint.Host)({
          ensure: (handler, options) =>
            Effect.sync(() => {
              provisioned.push({ handlerId: handler.id, instanceKey: options.instanceKey });
              return {
                id: endpoint.id,
                url: endpoint.url,
                handlerId: handler.id,
                instanceKey: options.instanceKey,
                metadata: options.metadata,
              };
            }),
          get: <Metadata>(handler: HttpEndpoint.Handler<Metadata>, instanceKey: string) =>
            Effect.succeed(
              Option.some({
                id: endpoint.id,
                url: endpoint.url,
                handlerId: handler.id,
                instanceKey,
                metadata: endpoint.metadata as Metadata,
              }),
            ),
          remove: () => Effect.void,
          lookup: () => Effect.succeed(Option.some(endpoint)),
        }),
        Layer.succeed(HttpEndpoint.SecretStore)({
          upsert: (endpointId) =>
            Effect.sync(() => {
              assert.strictEqual(endpointId, endpoint.id);
              return Redacted.make("webhook-secret");
            }),
        }),
        Layer.succeed(SignatureVerifier)({
          verify: (secret, message, signature) =>
            Effect.sync(() => {
              assert.strictEqual(Redacted.value(secret), "webhook-secret");
              verifiedMessages.push(new TextDecoder().decode(message));
              return signature === "sha256=valid";
            }),
        }),
      );

      yield* Effect.gen(function* () {
        const ingressRegistry = yield* HttpIngress.Registry;
        const endpointHost = yield* HttpEndpoint.Host;
        const eventSub = yield* make({
          getAccountIds: Effect.succeed([accountId]),
          getHelix: () => Effect.die("not used by webhook EventSub"),
          getSubscriptions: () => Effect.succeed(["channel.ban"]),
          emit: () => Effect.void,
          refresh: Effect.void,
        });
        assert.deepStrictEqual(
          HashMap.get(yield* eventSub.state, accountId),
          Option.some({ state: "connected" }),
        );

        yield* ingressRegistry.mount(
          {
            handlerId: "twitch:eventsub",
            pluginId: "twitch",
            instanceKey: accountId,
            metadata: { accountId },
            configuration: { subscriptions: ["channel.ban"] },
          },
          endpointHost,
        );
        assert.deepStrictEqual(provisioned, [
          { handlerId: "twitch:eventsub", instanceKey: accountId },
        ]);
        assert.deepStrictEqual(
          calls.map(({ method, url }) => ({ method, url })),
          [
            { method: "GET", url: "https://api.twitch.tv/helix/eventsub/subscriptions" },
            { method: "POST", url: "https://api.twitch.tv/helix/eventsub/subscriptions" },
          ],
        );
        assert.deepStrictEqual(calls[1]?.body, {
          type: "channel.ban",
          version: "1",
          condition: { broadcaster_user_id: accountId },
          transport: {
            method: "webhook",
            callback: endpoint.url,
            secret: "webhook-secret",
          },
        });
        assert.strictEqual(calls[1]?.headers.authorization, "Bearer cloud-token");
        assert.strictEqual(calls[1]?.headers["client-id"], Helix.DEFAULT_CLIENT_ID);
        const challengeBody = JSON.stringify({
          challenge: "challenge-value",
          subscription: {
            id: "subscription-1",
            status: "webhook_callback_verification_pending",
            type: "channel.ban",
            version: "1",
            condition: { broadcaster_user_id: accountId },
          },
        });
        const challenge = yield* ingressRegistry.handle({
          endpoint,
          configuration: { subscriptions: ["channel.ban"] },
          method: "POST",
          headers: headers("webhook_callback_verification"),
          body: new TextEncoder().encode(challengeBody),
        });
        assert.strictEqual(challenge.status, 200);
        assert.strictEqual(challenge.body, "challenge-value");
        assert.strictEqual(challenge.contentType, "text/plain");

        const notificationBody = body({
          subscription: {
            id: "subscription-1",
            status: "enabled",
            type: "channel.ban",
            version: "1",
            condition: { broadcaster_user_id: accountId },
          },
          event: {
            reason: "spam",
            banned_at: "2026-07-23T00:00:00Z",
            ends_at: null,
            is_permanent: true,
          },
        });
        const notification = yield* ingressRegistry.handle({
          endpoint,
          configuration: { subscriptions: ["channel.ban"] },
          method: "POST",
          headers: headers("notification"),
          body: notificationBody,
        });
        assert.strictEqual(notification.status, 204);
        assert.strictEqual(notification.events.length, 1);
        assert.strictEqual(notification.events[0]?.pluginId, "twitch");
        assert.strictEqual(notification.events[0]?.eventType, "channel.ban");
        assert.strictEqual(notification.events[0]?.eventId, "notification-1");
        assert.deepStrictEqual(
          yield* Schema.decodeUnknownEffect(
            Schema.Struct({ _tag: Schema.String, reason: Schema.String }),
          )(notification.events[0]?.payload),
          { _tag: "channel.ban", reason: "spam" },
        );

        assert.deepStrictEqual(
          yield* ingressRegistry.handle({
            endpoint,
            configuration: { subscriptions: ["channel.ban"] },
            method: "POST",
            headers: headers("notification", "sha256=invalid"),
            body: notificationBody,
          }),
          { status: 403, events: [] },
        );
        assert.strictEqual(verifiedMessages.length, 3);
        assert.ok(verifiedMessages[1]?.endsWith(new TextDecoder().decode(notificationBody)));
      }).pipe(
        Effect.provide(HttpIngress.layer(deployment.httpIngress.handlers)),
        Effect.provide(dependencies),
      );
    }),
  );
});
