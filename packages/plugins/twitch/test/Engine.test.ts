import { assert, describe, expect, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Deferred, Effect, Layer, Option, Redacted } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";
import { Socket } from "effect/unstable/socket";

import { AccountId, TwitchEngine, TwitchEventSub } from "../src/Definition.ts";
import deployment from "../src/Deployment/WebSocket.ts";

interface HttpCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly query: Record<string, string>;
}

describe("TwitchEngine", () => {
  it("declares its WebSocket deployment", () => {
    assert.strictEqual(deployment.pluginId, "twitch");
    assert.strictEqual("httpIngress" in deployment, false);
  });

  it.effect("runs EventSub and actions when validation is blocked", () =>
    Effect.gen(function* () {
      const accountId = AccountId.make("account-1");
      const httpCalls: Array<HttpCall> = [];
      const webSocketCalls: Array<string> = [];
      const webSockets: Array<EventTarget> = [];
      let webSocketCloses = 0;
      const webSocketOpened = yield* Deferred.make<void>();
      let chatAttempts = 0;
      const credentialSubscriber = yield* Deferred.make<() => Effect.Effect<void>>();
      const refreshClient = vi.fn();
      const refreshResource = vi.fn();
      const setStorage = vi.fn();
      let storage: typeof TwitchEngine.Storage.Type = {
        accounts: {
          [accountId]: { enabled: true, subscriptions: ["channel.ban"] },
        },
      };
      const refreshCredential = vi.fn((_provider: string, _id: string) => ({
        id: accountId,
        provider: "twitch",
        token: { access: Redacted.make("refreshed-token") },
      }));

      const httpClient = HttpClient.makeWith<
        HttpClientError.HttpClientError,
        never,
        HttpClientError.HttpClientError,
        never
      >(
        (requestEffect) =>
          Effect.flatMap(requestEffect, (request) => {
            const isChatRequest = request.url.endsWith("/chat/messages");
            const isExpiredCredential = isChatRequest && chatAttempts++ === 0;
            httpCalls.push({
              method: request.method,
              url: request.url,
              headers: { ...request.headers },
              query: Object.fromEntries(request.urlParams),
              body:
                request.body._tag === "Uint8Array"
                  ? JSON.parse(new TextDecoder().decode(request.body.body))
                  : undefined,
            });

            if (request.url === "https://id.twitch.tv/oauth2/validate")
              return Effect.fail(
                new HttpClientError.HttpClientError({
                  reason: new HttpClientError.TransportError({
                    request,
                    cause: new TypeError("Failed to fetch"),
                  }),
                }),
              );
            const response =
              request.method === "GET"
                ? {
                    data: [],
                    total: 0,
                    total_cost: 0,
                    max_total_cost: 10_000,
                  }
                : request.url.endsWith("/eventsub/subscriptions")
                  ? { data: [{ id: "subscription-1" }] }
                  : request.url.endsWith("/moderation/bans")
                    ? {
                        data: [
                          {
                            broadcaster_id: "broadcaster-1",
                            moderator_id: accountId,
                            user_id: "viewer-1",
                            created_at: "2026-08-23T00:00:00Z",
                            end_time: "2026-08-23T00:10:00Z",
                          },
                        ],
                      }
                    : request.url.endsWith("/chat/messages")
                      ? { data: [{ message_id: "message-1", is_sent: true }] }
                      : undefined;

            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(response === undefined ? undefined : JSON.stringify(response), {
                  status: isExpiredCredential
                    ? 401
                    : request.url.endsWith("/clips")
                      ? 403
                      : response === undefined
                        ? 204
                        : request.method === "POST" &&
                            request.url.endsWith("/eventsub/subscriptions")
                          ? 202
                          : 200,
                  ...(response === undefined
                    ? {}
                    : { headers: { "content-type": "application/json" } }),
                }),
              ),
            );
          }),
        Effect.succeed,
      );

      class MockWebSocket extends EventTarget {
        readonly url: string;
        readonly readyState = 1;

        constructor(url: string) {
          super();
          this.url = url;
          webSockets.push(this);
          webSocketCalls.push(url);
          Effect.runFork(Deferred.succeed(webSocketOpened, undefined));
          queueMicrotask(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  metadata: {
                    message_id: "welcome-1",
                    message_timestamp: "2026-07-22T00:00:00.000Z",
                    message_type: "session_welcome",
                  },
                  payload: {
                    session: {
                      id: "session-1",
                      status: "connected",
                    },
                  },
                }),
              }),
            );
          });
        }

        send() {}
        close() {
          webSocketCloses++;
        }
      }

      const dependencies = Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient)(httpClient),
        Layer.succeed(Socket.WebSocketConstructor)(
          (url) => new MockWebSocket(url) as unknown as globalThis.WebSocket,
        ),
        Layer.succeed(TwitchEngine.EngineContext)({
          storage: {
            get: Effect.sync(() => storage),
            set: (value) =>
              Effect.sync(() => {
                storage = value;
                setStorage(value);
              }),
            update: (f) =>
              Effect.sync(() => {
                storage = f(storage);
                setStorage(storage);
              }),
          },
          resource: {
            refresh: (resource) => Effect.sync(() => refreshResource(resource)),
          },
          credentials: {
            get: Effect.succeed([
              {
                id: accountId,
                provider: "twitch",
                displayName: "Streamer",
                clientId: "custom-client-id",
                token: { access: Redacted.make("test-token") },
              },
            ]),
            refresh: (provider, id) => Effect.sync(() => refreshCredential(provider, id)),
            subscribe: (callback) =>
              Deferred.succeed(credentialSubscriber, callback).pipe(Effect.asVoid),
          },
          client: {
            refresh: Effect.sync(refreshClient),
          },
          emit: () => Effect.void,
        }),
      );

      yield* Effect.gen(function* () {
        const { client, engine, runtime } = yield* EngineTest.makeClients(TwitchEngine);

        expect(refreshResource).not.toHaveBeenCalled();
        yield* Deferred.await(webSocketOpened);
        assert.deepStrictEqual(webSocketCalls, ["wss://eventsub.wss.twitch.tv/ws"]);

        const credentialSubscriberResult = yield* Deferred.poll(credentialSubscriber);
        assert(Option.isSome(credentialSubscriberResult));
        const notifyCredentialChange = yield* credentialSubscriberResult.value;
        yield* notifyCredentialChange();
        while (webSocketCalls.length < 2) yield* Effect.yieldNow;

        expect(refreshResource).toHaveBeenCalledWith(TwitchEngine.Resource[0]);
        expect(refreshResource).toHaveBeenCalledWith(TwitchEngine.Resource[1]);

        yield* client.ConnectEventSub({ accountId });

        assert.deepStrictEqual(
          yield* TwitchEventSub.values.pipe(Effect.provide(engine.resources)),
          [{ id: accountId, display: "Streamer" }],
        );

        assert.deepStrictEqual(webSocketCalls, [
          "wss://eventsub.wss.twitch.tv/ws",
          "wss://eventsub.wss.twitch.tv/ws",
        ]);
        assert.strictEqual(
          httpCalls.filter(({ url }) => url === "https://id.twitch.tv/oauth2/validate").length,
          2,
        );
        assert.strictEqual(
          httpCalls.filter(
            ({ method, url }) =>
              method === "POST" && url === "https://api.twitch.tv/helix/eventsub/subscriptions",
          ).length,
          2,
        );
        assert.deepStrictEqual(
          httpCalls.findLast(
            ({ method, url }) =>
              method === "POST" && url === "https://api.twitch.tv/helix/eventsub/subscriptions",
          )?.body,
          {
            type: "channel.ban",
            version: "1",
            condition: { broadcaster_user_id: accountId },
            transport: { method: "websocket", session_id: "session-1" },
          },
        );
        webSockets[1]?.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({
              metadata: {
                message_id: "reconnect-1",
                message_timestamp: "2026-07-22T00:01:00.000Z",
                message_type: "session_reconnect",
              },
              payload: {
                session: {
                  id: "session-1",
                  reconnect_url: "wss://eventsub.wss.twitch.tv/ws?reconnect=1",
                },
              },
            }),
          }),
        );
        while (!webSocketCalls.includes("wss://eventsub.wss.twitch.tv/ws?reconnect=1"))
          yield* Effect.yieldNow;

        yield* client.ToggleEventSubSubscription({
          accountId,
          subscriptionType: "channel.ban",
          enabled: false,
        });
        assert.deepStrictEqual(webSocketCalls, [
          "wss://eventsub.wss.twitch.tv/ws",
          "wss://eventsub.wss.twitch.tv/ws",
          "wss://eventsub.wss.twitch.tv/ws?reconnect=1",
        ]);
        expect(setStorage).toHaveBeenCalledOnce();
        expect(setStorage).toHaveBeenCalledWith({
          accounts: {
            [accountId]: { enabled: true, subscriptions: [] },
          },
        });

        const state = yield* engine.client.state;
        assert.deepStrictEqual(state.accounts, [
          {
            id: accountId,
            displayName: "Streamer",
            eventSubSocket: { state: "connected" },
            enabledSubscriptions: [],
          },
        ]);

        yield* runtime.SendChatMessage({
          account_id: accountId,
          broadcaster_id: "broadcaster-1",
          sender_id: accountId,
          message: "Hello from the test",
        });

        expect(refreshCredential).toHaveBeenCalledOnce();
        expect(refreshCredential).toHaveBeenCalledWith("twitch", accountId);
        assert.deepStrictEqual(
          httpCalls.slice(-2).map(({ method, url, headers }) => ({
            method,
            url,
            authorization: headers.authorization,
            clientId: headers["client-id"],
          })),
          [
            {
              method: "POST",
              url: "https://api.twitch.tv/helix/chat/messages",
              authorization: "Bearer test-token",
              clientId: "custom-client-id",
            },
            {
              method: "POST",
              url: "https://api.twitch.tv/helix/chat/messages",
              authorization: "Bearer refreshed-token",
              clientId: "custom-client-id",
            },
          ],
        );

        const scopeFailure = yield* Effect.flip(
          runtime.CreateClip({
            account_id: accountId,
            broadcaster_id: "broadcaster-1",
          }),
        );
        assert.strictEqual(scopeFailure._tag, "HelixError");
        if (scopeFailure._tag === "HelixError") {
          assert.strictEqual(scopeFailure.status, 403);
          assert.include(scopeFailure.reason, "required scope or channel role");
        }
        assert.strictEqual(httpCalls.at(-1)?.url, "https://api.twitch.tv/helix/clips");
        assert.strictEqual(httpCalls.at(-1)?.headers.authorization, "Bearer refreshed-token");
        expect(refreshCredential).toHaveBeenCalledOnce();

        const identityFailure = yield* Effect.flip(
          runtime.UpdateChatSettings({
            account_id: accountId,
            broadcaster_id: "broadcaster-1",
            moderator_id: "different-account",
          }),
        );
        assert.strictEqual(identityFailure._tag, "TwitchCredentialAuthorizationError");

        yield* client.DisconnectEventSub({ accountId });
        assert.isTrue(webSocketCloses > 0);
        expect(setStorage).toHaveBeenLastCalledWith({
          accounts: {
            [accountId]: { enabled: false, subscriptions: [] },
          },
        });
        assert.deepStrictEqual((yield* engine.client.state).accounts[0]?.eventSubSocket, {
          state: "disconnected",
        });
        assert.strictEqual(
          httpCalls.filter(({ url }) => url === "https://id.twitch.tv/oauth2/validate").length,
          2,
        );
      }).pipe(Effect.provide(deployment.layer.pipe(Layer.provide(dependencies))));
    }),
  );
});
