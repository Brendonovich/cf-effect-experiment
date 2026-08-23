import { assert, describe, expect, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Deferred, Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";
import { Socket } from "effect/unstable/socket";

import { AccountId, TwitchEngine } from "../src/Definition.ts";
import deployment from "../src/Deployment/WebSocket.ts";

interface HttpCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

describe("TwitchEngine", () => {
  it("declares its WebSocket deployment", () => {
    assert.strictEqual(deployment.pluginId, "twitch");
    assert.strictEqual("httpIngress" in deployment, false);
  });

  it.effect("records HTTP and WebSocket calls from engine RPCs", () =>
    Effect.gen(function* () {
      const accountId = AccountId.make("account-1");
      const httpCalls: Array<HttpCall> = [];
      const webSocketCalls: Array<string> = [];
      const webSocketOpened = yield* Deferred.make<void>();
      let chatAttempts = 0;
      const credentialSubscriber =
        yield* Deferred.make<
          (credential: {
            id: string;
            provider: string;
            token: { access: string };
          }) => Effect.Effect<void>
        >();
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
        token: { access: "refreshed-token" },
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
              body:
                request.body._tag === "Uint8Array"
                  ? JSON.parse(new TextDecoder().decode(request.body.body))
                  : undefined,
            });

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
                  : undefined;

            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response(response === undefined ? undefined : JSON.stringify(response), {
                  status: isExpiredCredential
                    ? 401
                    : response === undefined
                      ? 204
                      : request.method === "POST" && request.url.endsWith("/eventsub/subscriptions")
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
        close() {}
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
                token: { access: "test-token" },
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
        yield* notifyCredentialChange({
          id: accountId,
          provider: "twitch",
          token: { access: "test-token" },
        });

        expect(refreshResource).toHaveBeenCalledOnce();
        expect(refreshResource).toHaveBeenCalledWith(TwitchEngine.Resource[0]);

        yield* client.ConnectEventSub({ accountId });

        assert.deepStrictEqual(webSocketCalls, ["wss://eventsub.wss.twitch.tv/ws"]);
        assert.deepStrictEqual(
          httpCalls.map(({ method, url }) => ({ method, url })),
          [
            { method: "GET", url: "https://api.twitch.tv/helix/eventsub/subscriptions" },
            { method: "POST", url: "https://api.twitch.tv/helix/eventsub/subscriptions" },
          ],
        );
        assert.deepStrictEqual(httpCalls[1]?.body, {
          type: "channel.ban",
          version: "1",
          condition: { broadcaster_user_id: accountId },
          transport: { method: "websocket", session_id: "session-1" },
        });
        expect(refreshClient).toHaveBeenCalledTimes(3);

        yield* client.ToggleEventSubSubscription({
          accountId,
          subscriptionType: "channel.ban",
          enabled: false,
        });
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
          httpCalls.map(({ method, url }) => ({ method, url })),
          [
            { method: "GET", url: "https://api.twitch.tv/helix/eventsub/subscriptions" },
            { method: "POST", url: "https://api.twitch.tv/helix/eventsub/subscriptions" },
            { method: "POST", url: "https://api.twitch.tv/helix/chat/messages" },
            { method: "POST", url: "https://api.twitch.tv/helix/chat/messages" },
          ],
        );
        assert.deepStrictEqual(
          httpCalls.map((call) => call.headers.authorization),
          ["Bearer test-token", "Bearer test-token", "Bearer test-token", "Bearer refreshed-token"],
        );

        yield* client.DisconnectEventSub({ accountId });
        expect(setStorage).toHaveBeenLastCalledWith({
          accounts: {
            [accountId]: { enabled: false, subscriptions: [] },
          },
        });
        assert.deepStrictEqual((yield* engine.client.state).accounts[0]?.eventSubSocket, {
          state: "disconnected",
        });
      }).pipe(Effect.provide(deployment.layer.pipe(Layer.provide(dependencies))));
    }),
  );
});
