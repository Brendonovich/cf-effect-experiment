import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";

import { Helix } from "../src/Helix.ts";

describe("Twitch Helix errors", () => {
  it.effect("omits trace propagation headers from EventSub fetches and retries", () =>
    Effect.gen(function* () {
      const requests: Array<Headers> = [];
      const fetch: typeof globalThis.fetch = (_input, init) => {
        requests.push(new Headers(init?.headers));
        return Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "subscription-1" }] }), {
            status: requests.length === 1 ? 401 : 202,
            headers: { "content-type": "application/json" },
          }),
        );
      };
      yield* Effect.gen(function* () {
        const client = yield* Helix.makeClient("credential", Effect.succeed("refreshed"));
        yield* client.eventsub.createSubscription({
          payload: {
            type: "channel.ban",
            version: "1",
            condition: { broadcaster_user_id: "account-1" },
            transport: { method: "websocket", session_id: "session-1" },
          },
        });
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );
      assert.strictEqual(requests.length, 2);
      for (const headers of requests) {
        assert.deepStrictEqual([...headers.keys()].sort(), [
          "authorization",
          "client-id",
          "content-type",
        ]);
      }
      assert.strictEqual(requests[0]!.get("authorization"), "Bearer credential");
      assert.strictEqual(requests[1]!.get("authorization"), "Bearer refreshed");
    }),
  );

  it.effect("reports missing scopes actionably without leaking Twitch response secrets", () =>
    Effect.gen(function* () {
      const httpClient = HttpClient.makeWith<
        HttpClientError.HttpClientError,
        never,
        HttpClientError.HttpClientError,
        never
      >(
        (requestEffect) =>
          Effect.map(requestEffect, (request) =>
            HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  message: "Missing scope moderator:manage:banned_users",
                  access_token: "response-secret",
                }),
                {
                  status: 403,
                  headers: {
                    "content-type": "application/json",
                    "ratelimit-limit": "800",
                    "ratelimit-remaining": "42",
                    "ratelimit-reset": "123456",
                  },
                },
              ),
            ),
          ),
        Effect.succeed,
      );
      const client = yield* Helix.makeClient("credential-secret", Effect.succeed("refreshed")).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );
      const error = yield* Effect.flip(
        client.channels
          .modifyInformation({
            query: { broadcaster_id: "channel" },
            payload: { title: "Updated title" },
          })
          .pipe(
            Effect.catchTag("HttpClientError", Helix.fromHttpClientError),
            Effect.catchTag(
              "SchemaError",
              (cause) => new Helix.HelixError({ reason: String(cause) }),
            ),
          ),
      );
      assert.strictEqual(error._tag, "HelixError");
      assert.include(error.reason, "required scope or channel role");
      assert.notInclude(error.reason, "credential-secret");
      assert.notInclude(error.reason, "response-secret");
      assert.strictEqual(error.rateLimit, 800);
      assert.strictEqual(error.rateLimitRemaining, 42);
      assert.strictEqual(error.rateLimitReset, 123456);
    }),
  );

  it.effect("maps every active Helix action category to the documented method and path", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly method: string; readonly url: string }> = [];
      const httpClient = HttpClient.makeWith<
        HttpClientError.HttpClientError,
        never,
        HttpClientError.HttpClientError,
        never
      >(
        (requestEffect) =>
          Effect.map(requestEffect, (request) => {
            calls.push({ method: request.method, url: request.url });
            const response = request.url.endsWith("/chat/settings")
              ? {
                  data: [
                    {
                      emote_mode: true,
                      follower_mode: false,
                      slow_mode: true,
                      subscriber_mode: false,
                    },
                  ],
                }
              : request.url.endsWith("/chat/messages")
                ? { data: [{ message_id: "message-1", is_sent: true }] }
                : request.url.endsWith("/channels/followers")
                  ? { data: [], total: 5, pagination: {} }
                  : request.url.endsWith("/channels") && request.method === "GET"
                    ? {
                        data: [
                          {
                            broadcaster_id: "account-1",
                            broadcaster_login: "streamer",
                            broadcaster_name: "Streamer",
                            broadcaster_language: "en",
                            game_id: "game-1",
                            game_name: "Game",
                            title: "Title",
                          },
                        ],
                      }
                    : request.url.endsWith("/streams")
                      ? {
                          data: [
                            {
                              id: "stream-1",
                              user_id: "account-1",
                              game_name: "Game",
                              title: "Title",
                              viewer_count: 5,
                            },
                          ],
                        }
                      : request.url.endsWith("/clips")
                        ? { data: [{ id: "clip-1", edit_url: "https://clips.example/edit" }] }
                        : request.url.endsWith("/polls")
                          ? { data: [{ id: "poll-1" }] }
                          : request.url.endsWith("/predictions")
                            ? { data: [{ id: "prediction-1" }] }
                            : request.url.endsWith("/users")
                              ? {
                                  data: [
                                    {
                                      id: "account-1",
                                      display_name: "Streamer",
                                      broadcaster_type: "affiliate",
                                      description: "Description",
                                    },
                                  ],
                                }
                              : undefined;
            const status = request.url.endsWith("/clips")
              ? 202
              : request.url.endsWith("/channels") && request.method === "PATCH"
                ? 204
                : 200;
            return HttpClientResponse.fromWeb(
              request,
              new Response(response === undefined ? undefined : JSON.stringify(response), {
                status,
                ...(response === undefined
                  ? {}
                  : { headers: { "content-type": "application/json" } }),
              }),
            );
          }),
        Effect.succeed,
      );
      const client = yield* Helix.makeClient("credential", Effect.succeed("refreshed")).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );

      yield* client.chat.sendMessage({
        payload: { broadcaster_id: "account-1", sender_id: "account-1", message: "hello" },
      });
      yield* client.chat.getSettings({ query: { broadcaster_id: "account-1" } });
      yield* client.chat.updateSettings({
        query: { broadcaster_id: "account-1", moderator_id: "account-1" },
        payload: { slow_mode: true },
      });
      yield* client.channels.getInformation({ query: { broadcaster_id: "account-1" } });
      yield* client.channels.modifyInformation({
        query: { broadcaster_id: "account-1" },
        payload: { title: "Title" },
      });
      yield* client.streams.getStreams({ query: { user_id: "account-1" } });
      yield* client.clips.createClip({ query: { broadcaster_id: "account-1" } });
      yield* client.polls.createPoll({
        payload: {
          broadcaster_id: "account-1",
          title: "Poll",
          choices: [{ title: "One" }, { title: "Two" }],
          duration: 60,
        },
      });
      yield* client.polls.endPoll({
        payload: { broadcaster_id: "account-1", id: "poll-1", status: "TERMINATED" },
      });
      yield* client.predictions.createPrediction({
        payload: {
          broadcaster_id: "account-1",
          title: "Prediction",
          outcomes: [{ title: "One" }, { title: "Two" }],
          prediction_window: 60,
        },
      });
      yield* client.predictions.endPrediction({
        payload: { broadcaster_id: "account-1", id: "prediction-1", status: "CANCELED" },
      });
      yield* client.users.getUsers({ query: { id: "account-1" } });
      yield* client.followers.getFollowers({ query: { broadcaster_id: "account-1" } });

      assert.deepStrictEqual(calls, [
        { method: "POST", url: "https://api.twitch.tv/helix/chat/messages" },
        { method: "GET", url: "https://api.twitch.tv/helix/chat/settings" },
        { method: "PATCH", url: "https://api.twitch.tv/helix/chat/settings" },
        { method: "GET", url: "https://api.twitch.tv/helix/channels" },
        { method: "PATCH", url: "https://api.twitch.tv/helix/channels" },
        { method: "GET", url: "https://api.twitch.tv/helix/streams" },
        { method: "POST", url: "https://api.twitch.tv/helix/clips" },
        { method: "POST", url: "https://api.twitch.tv/helix/polls" },
        { method: "PATCH", url: "https://api.twitch.tv/helix/polls" },
        { method: "POST", url: "https://api.twitch.tv/helix/predictions" },
        { method: "PATCH", url: "https://api.twitch.tv/helix/predictions" },
        { method: "GET", url: "https://api.twitch.tv/helix/users" },
        { method: "GET", url: "https://api.twitch.tv/helix/channels/followers" },
      ]);
    }),
  );
});
