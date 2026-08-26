import { assert, describe, it } from "@effect/vitest";
import { Engine, HttpEndpoint, HttpIngress } from "@macrograph/plugin";
import { Effect, HashMap, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import { AccountId } from "../src/Definition.ts";
import deployment from "../src/Deployment/Webhook.ts";
import {
  EventSubEndpoint,
  AppCredentials,
  SignatureVerifier,
  layerWebCrypto,
  make,
  type Request,
} from "../src/WebhookEventSub.ts";

interface HttpCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

const headers = (
  type: string,
  signature = "sha256=valid",
  id = `${type}-1`,
): Request["headers"] => ({
  "Twitch-Eventsub-Message-Id": id,
  "Twitch-Eventsub-Message-Timestamp": "1970-01-01T00:00:00Z",
  "Twitch-Eventsub-Message-Signature": signature,
  "Twitch-Eventsub-Message-Type": type,
});

const body = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("WebhookEventSub", () => {
  it.effect("derives its HTTP ingress manifest from engine state", () =>
    Effect.gen(function* () {
      const requirements = yield* deployment.httpIngress.requirements({
        accounts: {
          [AccountId.make("account-1")]: { enabled: true, subscriptions: ["channel.ban"] },
          [AccountId.make("account-2")]: {
            enabled: true,
            subscriptions: ["channel.ban", "channel.unban"],
          },
          [AccountId.make("account-3")]: {
            enabled: false,
            subscriptions: ["channel.ban"],
          },
        },
      });
      assert.deepStrictEqual(yield* HttpIngress.manifest(requirements), [
        {
          handlerId: HttpEndpoint.HandlerId.make("twitch:eventsub"),
          pluginId: "twitch",
          instanceKey: HttpEndpoint.InstanceKey.make("account-1"),
          displayName: "EventSub Webhook",
          metadata: { accountId: "account-1" },
          configuration: { subscriptions: ["channel.ban"] },
        },
        {
          handlerId: HttpEndpoint.HandlerId.make("twitch:eventsub"),
          pluginId: "twitch",
          instanceKey: HttpEndpoint.InstanceKey.make("account-2"),
          displayName: "EventSub Webhook",
          metadata: { accountId: "account-2" },
          configuration: { subscriptions: ["channel.ban", "channel.unban"] },
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
      const provisioned: Array<{
        readonly handlerId: string;
        readonly instanceKey: string;
      }> = [];
      let clientRefreshes = 0;
      const endpoint = {
        id: HttpEndpoint.Id.make("endpoint-1"),
        url: "https://new.trycloudflare.com/ingress/project-1/endpoint-1",
        schema: { id: EventSubEndpoint.id, displayName: EventSubEndpoint.displayName },
        instanceKey: HttpEndpoint.InstanceKey.make(accountId),
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
                  ? request.url === "https://id.twitch.tv/oauth2/token"
                    ? new TextDecoder().decode(request.body.body)
                    : JSON.parse(new TextDecoder().decode(request.body.body))
                  : undefined,
            });
            const response =
              request.url === "https://id.twitch.tv/oauth2/token"
                ? {
                    access_token: "app-token",
                    expires_in: 3600,
                    token_type: "bearer",
                  }
                : request.method === "GET"
                  ? Object.hasOwn(Object.fromEntries(request.urlParams), "after")
                    ? {
                        data: [],
                        total: 1,
                        total_cost: 0,
                        max_total_cost: 10_000,
                        pagination: {},
                      }
                    : {
                        data: [
                          {
                            id: "other-project-subscription",
                            type: "channel.ban",
                            version: "1",
                            status: "enabled",
                            condition: { broadcaster_user_id: accountId },
                            transport: {
                              method: "webhook",
                              callback: "https://other.example/webhooks/twitch/account-1",
                            },
                            created_at: "2026-07-23T00:00:00Z",
                            cost: 0,
                          },
                          {
                            id: "previous-tunnel-subscription",
                            type: "channel.ban",
                            version: "1",
                            status: "enabled",
                            condition: { broadcaster_user_id: accountId },
                            transport: {
                              method: "webhook",
                              callback:
                                "https://old.trycloudflare.com/ingress/project-1/endpoint-1",
                            },
                            created_at: "2026-07-23T00:00:00Z",
                            cost: 0,
                          },
                        ],
                        total: 1,
                        total_cost: 0,
                        max_total_cost: 10_000,
                        pagination: { cursor: "next-page" },
                      }
                  : { data: [{ id: "subscription-1" }] };
            return HttpClientResponse.fromWeb(
              request,
              request.method === "DELETE"
                ? new Response(null, { status: 204 })
                : new Response(JSON.stringify(response), {
                    status: request.method === "POST" ? 202 : 200,
                    headers: { "content-type": "application/json" },
                  }),
            );
          }),
        Effect.succeed,
      );

      const dependencies = Layer.mergeAll(
        Layer.succeed(AppCredentials)({
          clientId: "test-client-id",
          clientSecret: Redacted.make("test-client-secret"),
        }),
        Layer.succeed(HttpClient.HttpClient)(httpClient),
        Layer.succeed(Engine.Credentials)({
          get: Effect.succeed([
            {
              id: accountId,
              provider: "twitch",
              token: { access: Redacted.make("cloud-token") },
            },
          ]),
          refresh: () =>
            Effect.succeed({
              id: accountId,
              provider: "twitch",
              token: { access: Redacted.make("refreshed-cloud-token") },
            }),
          subscribe: () => Effect.void,
        }),
        Layer.succeed(HttpEndpoint.Host)({
          ensure: (handler, options) =>
            Effect.sync(() => {
              provisioned.push({
                handlerId: handler.id,
                instanceKey: options.instanceKey,
              });
              return {
                id: endpoint.id,
                url: endpoint.url,
                schema: { id: handler.id, displayName: handler.displayName },
                instanceKey: HttpEndpoint.InstanceKey.make(options.instanceKey),
                metadata: options.metadata,
              };
            }),
          get: <Metadata>(_handler: HttpEndpoint.Handler<Metadata>, instanceKey: string) =>
            Effect.succeed(
              Option.some({
                id: endpoint.id,
                url: endpoint.url,
                schema: endpoint.schema,
                instanceKey: HttpEndpoint.InstanceKey.make(instanceKey),
                metadata: endpoint.metadata as Metadata,
              }),
            ),
          remove: () => Effect.void,
          lookup: () => Effect.succeed(Option.some(endpoint)),
          secret: (endpointId) =>
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
          getSubscriptions: () => Effect.succeed(["channel.ban", "channel.unban"]),
          emit: () => Effect.void,
          refresh: Effect.sync(() => {
            clientRefreshes++;
          }),
        });
        assert.deepStrictEqual(
          HashMap.get(yield* eventSub.state, accountId),
          Option.some({ state: "connected" }),
        );

        yield* ingressRegistry.mount(
          {
            handlerId: HttpEndpoint.HandlerId.make("twitch:eventsub"),
            pluginId: "twitch",
            instanceKey: HttpEndpoint.InstanceKey.make(accountId),
            displayName: "EventSub Webhook",
            metadata: { accountId },
            configuration: { subscriptions: ["channel.ban", "channel.unban"] },
          },
          endpointHost,
        );
        assert.deepStrictEqual(provisioned, [
          { handlerId: HttpEndpoint.HandlerId.make("twitch:eventsub"), instanceKey: accountId },
        ]);
        assert.deepStrictEqual(
          calls.map(({ method, url }) => ({ method, url })),
          [
            { method: "POST", url: "https://id.twitch.tv/oauth2/token" },
            {
              method: "GET",
              url: "https://api.twitch.tv/helix/eventsub/subscriptions",
            },
            {
              method: "GET",
              url: "https://api.twitch.tv/helix/eventsub/subscriptions",
            },
            {
              method: "DELETE",
              url: "https://api.twitch.tv/helix/eventsub/subscriptions",
            },
            {
              method: "POST",
              url: "https://api.twitch.tv/helix/eventsub/subscriptions",
            },
            {
              method: "POST",
              url: "https://api.twitch.tv/helix/eventsub/subscriptions",
            },
          ],
        );
        assert.strictEqual(
          calls[0]?.body,
          "client_id=test-client-id&client_secret=test-client-secret&grant_type=client_credentials",
        );
        assert.deepStrictEqual(calls[4]?.body, {
          type: "channel.ban",
          version: "1",
          condition: { broadcaster_user_id: accountId },
          transport: {
            method: "webhook",
            callback: endpoint.url,
            secret: "webhook-secret",
          },
        });
        assert.strictEqual(calls[4]?.headers.authorization, "Bearer app-token");
        assert.strictEqual(calls[4]?.headers["client-id"], "test-client-id");
        assert.deepStrictEqual(calls[5]?.body, {
          type: "channel.unban",
          version: "1",
          condition: { broadcaster_user_id: accountId },
          transport: {
            method: "webhook",
            callback: endpoint.url,
            secret: "webhook-secret",
          },
        });
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
            broadcaster_user_id: accountId,
            broadcaster_user_login: "streamer",
            broadcaster_user_name: "Streamer",
            user_id: "viewer-1",
            user_login: "viewer",
            user_name: "Viewer",
            moderator_user_id: accountId,
            moderator_user_login: "streamer",
            moderator_user_name: "Streamer",
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
        const duplicate = yield* ingressRegistry.handle({
          endpoint,
          configuration: { subscriptions: ["channel.ban"] },
          method: "POST",
          headers: headers("notification"),
          body: notificationBody,
        });
        assert.strictEqual(duplicate.status, 204);
        assert.deepStrictEqual(duplicate.events, []);

        const unban = yield* ingressRegistry.handle({
          endpoint,
          configuration: { subscriptions: ["channel.ban", "channel.unban"] },
          method: "POST",
          headers: headers("notification", "sha256=valid", "notification-2"),
          body: body({
            subscription: {
              id: "subscription-2",
              status: "enabled",
              type: "channel.unban",
              version: "1",
              condition: { broadcaster_user_id: accountId },
            },
            event: {
              user_id: "user-1",
              user_login: "viewer",
              user_name: "Viewer",
              broadcaster_user_id: accountId,
              broadcaster_user_login: "streamer",
              broadcaster_user_name: "Streamer",
              moderator_user_id: accountId,
              moderator_user_login: "streamer",
              moderator_user_name: "Streamer",
            },
          }),
        });
        assert.strictEqual(unban.status, 204);
        assert.strictEqual(unban.events[0]?.eventType, "channel.unban");

        const disabled = yield* ingressRegistry.handle({
          endpoint,
          configuration: { subscriptions: ["channel.ban"] },
          method: "POST",
          headers: headers("notification", "sha256=valid", "notification-3"),
          body: body({
            subscription: {
              id: "subscription-2",
              status: "enabled",
              type: "channel.unban",
              version: "1",
              condition: { broadcaster_user_id: accountId },
            },
            event: {},
          }),
        });
        assert.strictEqual(disabled.status, 204);
        assert.deepStrictEqual(disabled.events, []);

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
        assert.deepStrictEqual(
          yield* ingressRegistry.handle({
            endpoint,
            configuration: { subscriptions: ["channel.ban"] },
            method: "POST",
            headers: headers("notification"),
            body: body({
              subscription: {
                id: "subscription-2",
                status: "enabled",
                type: "channel.ban",
                version: "1",
                condition: {
                  broadcaster_user_id: accountId,
                  moderator_user_id: "account-2",
                },
              },
              event: {
                reason: "spam",
                ends_at: null,
                is_permanent: true,
              },
            }),
          }),
          { status: 400, events: [] },
        );
        assert.strictEqual(verifiedMessages.length, 7);
        assert.ok(verifiedMessages[1]?.endsWith(new TextDecoder().decode(notificationBody)));

        const refreshesBeforeDisconnect = clientRefreshes;
        yield* eventSub.disconnect(accountId);
        assert.deepStrictEqual(
          HashMap.get(yield* eventSub.state, accountId),
          Option.some({ state: "disconnected" }),
        );
        assert.isTrue(clientRefreshes > refreshesBeforeDisconnect);
      }).pipe(
        Effect.provide(HttpIngress.layer(deployment.httpIngress.handlers)),
        Effect.provide(dependencies),
      );
    }),
  );
});
