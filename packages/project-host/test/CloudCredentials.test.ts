import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import { CloudCredentials } from "../src/CloudCredentials.ts";

describe("CloudCredentials", () => {
  it.effect("caches credentials and refreshes them through macrograph.app", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls: Array<{
          readonly method: string;
          readonly url: string;
          readonly headers: Record<string, string>;
        }> = [];
        let accessToken = "access-1";
        const responseCredential = () => ({
          provider: "twitch",
          id: "account/1",
          displayName: "Streamer",
          token: {
            access_token: accessToken,
            expires_in: 3600,
            refresh_token: "refresh-1",
            token_type: "Bearer",
            issuedAt: 1,
          },
        });
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
              });
              if (request.method === "POST") accessToken = "access-2";
              return HttpClientResponse.fromWeb(
                request,
                new Response(
                  JSON.stringify(
                    request.method === "GET" ? [responseCredential()] : responseCredential(),
                  ),
                  { status: 200, headers: { "content-type": "application/json" } },
                ),
              );
            }),
          Effect.succeed,
        );

        const credentials = yield* CloudCredentials.make({
          baseUrl: "https://macrograph.app/api/",
          token: Redacted.make("registration-token"),
        }).pipe(Effect.provide(Layer.succeed(HttpClient.HttpClient)(httpClient)));

        assert.deepStrictEqual(yield* credentials.get, [
          {
            provider: "twitch",
            id: "account/1",
            displayName: "Streamer",
            token: { access: "access-1" },
          },
        ]);
        yield* credentials.get;
        assert.strictEqual(calls.length, 1);

        assert.deepStrictEqual(yield* credentials.refresh("twitch", "account/1"), {
          provider: "twitch",
          id: "account/1",
          displayName: "Streamer",
          token: { access: "access-2" },
        });
        assert.deepStrictEqual(
          calls.map(({ method, url }) => ({ method, url })),
          [
            { method: "GET", url: "https://www.macrograph.app/api/credentials" },
            {
              method: "POST",
              url: "https://www.macrograph.app/api/credentials/twitch/account%2F1/refresh",
            },
            { method: "GET", url: "https://www.macrograph.app/api/credentials" },
          ],
        );
        for (const call of calls) {
          assert.strictEqual(call.headers.authorization, "Bearer registration-token");
          assert.strictEqual(call.headers["client-id"], "macrograph-server");
        }
      }),
    ),
  );
});
