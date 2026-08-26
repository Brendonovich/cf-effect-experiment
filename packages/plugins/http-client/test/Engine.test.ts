import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import type { RequestMethod } from "../src/Definition.ts";

import { makeRuntimeClient } from "../src/Engine.ts";
import { localLayer, secureLayer } from "../src/UrlPolicy.ts";

const clientLayer = (client: HttpClient.HttpClient) => Layer.succeed(HttpClient.HttpClient)(client);

const runtime = (client: HttpClient.HttpClient, policy: typeof localLayer | typeof secureLayer) =>
  makeRuntimeClient().pipe(Effect.provide(policy), Effect.provide(clientLayer(client)));

describe("HTTP client engine", () => {
  it.effect("performs every method and returns all HTTP status codes as data", () =>
    Effect.gen(function* () {
      const calls: Array<RequestMethod> = [];
      const statuses = new Map<RequestMethod, number>([
        ["GET", 200],
        ["POST", 201],
        ["PUT", 204],
        ["PATCH", 404],
        ["DELETE", 503],
      ]);
      const httpClient = HttpClient.makeWith<
        HttpClientError.HttpClientError,
        never,
        HttpClientError.HttpClientError,
        never
      >(
        (requestEffect) =>
          Effect.map(requestEffect, (request) => {
            const method = request.method as RequestMethod;
            calls.push(method);
            return HttpClientResponse.fromWeb(
              request,
              new Response(undefined, { status: statuses.get(method)! }),
            );
          }),
        Effect.succeed,
      );
      const rpc = yield* runtime(httpClient, localLayer);

      for (const method of statuses.keys()) {
        assert.strictEqual(
          yield* rpc.HttpClientRequest({ method, url: "http://localhost/example" }),
          statuses.get(method)!,
        );
      }
      assert.deepStrictEqual(calls, ["GET", "POST", "PUT", "PATCH", "DELETE"]);
    }),
  );

  it.effect("rejects malformed, non-HTTP, credentialed, and production-private URLs", () =>
    Effect.gen(function* () {
      let calls = 0;
      const httpClient = HttpClient.makeWith<
        HttpClientError.HttpClientError,
        never,
        HttpClientError.HttpClientError,
        never
      >(
        (requestEffect) =>
          Effect.map(requestEffect, (request) => {
            calls++;
            return HttpClientResponse.fromWeb(request, new Response(undefined, { status: 200 }));
          }),
        Effect.succeed,
      );
      const local = yield* runtime(httpClient, localLayer);
      const production = yield* runtime(httpClient, secureLayer);
      const rejected = [
        yield* Effect.result(local.HttpClientRequest({ method: "GET", url: "not a url" })),
        yield* Effect.result(local.HttpClientRequest({ method: "GET", url: "file:///etc/passwd" })),
        yield* Effect.result(
          local.HttpClientRequest({ method: "GET", url: "https://user:secret@example.com" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "http://example.com" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://127.0.0.1" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://0177.0.0.1" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://0x7f000001" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://2130706433" }),
        ),
        yield* Effect.result(production.HttpClientRequest({ method: "GET", url: "https://[::1]" })),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://[fc00::1]" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://[fe80::1]" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://[::ffff:127.0.0.1]" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://api.localhost." }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://localhost.localdomain" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://device.home.arpa" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://example.com:8443" }),
        ),
        yield* Effect.result(
          production.HttpClientRequest({ method: "GET", url: "https://metadata.google.internal" }),
        ),
      ];

      assert.isTrue(rejected.every(Result.isFailure));
      for (const result of rejected) {
        if (Result.isFailure(result)) {
          assert.strictEqual(result.failure._tag, "HttpClientRequestFailure");
          assert.strictEqual(result.failure.method, "GET");
          assert.isNotEmpty(result.failure.url);
          assert.isNotEmpty(result.failure.reason);
        }
      }
      assert.strictEqual(calls, 0);

      assert.strictEqual(
        yield* production.HttpClientRequest({ method: "GET", url: "https://[2606:4700::1111]" }),
        200,
      );

      assert.strictEqual(
        yield* local.HttpClientRequest({ method: "GET", url: "http://127.0.0.1:3000" }),
        200,
      );
      assert.strictEqual(calls, 2);

      const credentialed = rejected[2];
      if (credentialed !== undefined && Result.isFailure(credentialed)) {
        assert.notInclude(credentialed.failure.url, "user");
        assert.notInclude(credentialed.failure.url, "secret");
      }
    }),
  );

  it.effect("turns transport failures into typed request failures with context", () =>
    Effect.gen(function* () {
      const httpClient = HttpClient.makeWith<
        HttpClientError.HttpClientError,
        never,
        HttpClientError.HttpClientError,
        never
      >(
        (requestEffect) =>
          Effect.flatMap(requestEffect, (request) =>
            Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  request,
                  description: "connection refused",
                }),
              }),
            ),
          ),
        Effect.succeed,
      );
      const rpc = yield* runtime(httpClient, localLayer);
      const result = yield* Effect.result(
        rpc.HttpClientRequest({ method: "PATCH", url: "http://localhost:9/fail" }),
      );

      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.strictEqual(result.failure.method, "PATCH");
        assert.strictEqual(result.failure.url, "http://localhost:9/fail");
        assert.include(result.failure.reason, "connection refused");
      }
    }),
  );

  it.effect("follows validated redirects with standard method semantics", () =>
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
            return request.url.endsWith("/start")
              ? HttpClientResponse.fromWeb(
                  request,
                  new Response(undefined, { status: 302, headers: { location: "/complete" } }),
                )
              : HttpClientResponse.fromWeb(request, new Response(undefined, { status: 202 }));
          }),
        Effect.succeed,
      );
      const rpc = yield* runtime(httpClient, secureLayer);

      assert.strictEqual(
        yield* rpc.HttpClientRequest({ method: "POST", url: "https://example.com/start" }),
        202,
      );
      assert.deepStrictEqual(calls, [
        { method: "POST", url: "https://example.com/start" },
        { method: "GET", url: "https://example.com/complete" },
      ]);

      for (const [status, method, redirectedMethod] of [
        [301, "POST", "GET"],
        [302, "POST", "GET"],
        [303, "DELETE", "GET"],
        [301, "PUT", "PUT"],
        [307, "POST", "POST"],
        [308, "PATCH", "PATCH"],
      ] as const) {
        calls.length = 0;
        const redirectClient = HttpClient.makeWith<
          HttpClientError.HttpClientError,
          never,
          HttpClientError.HttpClientError,
          never
        >(
          (requestEffect) =>
            Effect.map(requestEffect, (request) => {
              calls.push({ method: request.method, url: request.url });
              assert.strictEqual(request.body._tag, "Empty");
              assert.isUndefined(request.headers.authorization);
              assert.isUndefined(request.headers.cookie);
              return request.url.endsWith("/start")
                ? HttpClientResponse.fromWeb(
                    request,
                    new Response(undefined, {
                      status,
                      headers: { location: "https://other.example/complete" },
                    }),
                  )
                : HttpClientResponse.fromWeb(request, new Response(undefined, { status: 204 }));
            }),
          Effect.succeed,
        );
        const redirectRpc = yield* runtime(redirectClient, secureLayer);
        assert.strictEqual(
          yield* redirectRpc.HttpClientRequest({ method, url: "https://example.com/start" }),
          204,
        );
        assert.deepStrictEqual(
          calls.map(({ method }) => method),
          [method, redirectedMethod],
        );
      }

      calls.length = 0;
      const privateRedirect = HttpClient.makeWith<
        HttpClientError.HttpClientError,
        never,
        HttpClientError.HttpClientError,
        never
      >(
        (requestEffect) =>
          Effect.map(requestEffect, (request) => {
            calls.push({ method: request.method, url: request.url });
            return HttpClientResponse.fromWeb(
              request,
              new Response(undefined, {
                status: 307,
                headers: { location: "https://127.0.0.1/private" },
              }),
            );
          }),
        Effect.succeed,
      );
      const privateRpc = yield* runtime(privateRedirect, secureLayer);
      const result = yield* Effect.result(
        privateRpc.HttpClientRequest({ method: "GET", url: "https://example.com/start" }),
      );
      assert.isTrue(Result.isFailure(result));
      assert.deepStrictEqual(calls, [{ method: "GET", url: "https://example.com/start" }]);

      calls.length = 0;
      const redirectLoop = yield* runtime(privateRedirect, localLayer);
      const loopResult = yield* Effect.result(
        redirectLoop.HttpClientRequest({ method: "GET", url: "https://example.com/start" }),
      );
      assert.isTrue(Result.isFailure(loopResult));
      if (Result.isFailure(loopResult)) assert.include(loopResult.failure.reason, "Redirect loop");
      assert.strictEqual(calls.length, 2);

      let limitCalls = 0;
      const redirectChain = HttpClient.makeWith<
        HttpClientError.HttpClientError,
        never,
        HttpClientError.HttpClientError,
        never
      >(
        (requestEffect) =>
          Effect.map(requestEffect, (request) => {
            limitCalls++;
            return HttpClientResponse.fromWeb(
              request,
              new Response(undefined, {
                status: 302,
                headers: { location: `/hop/${limitCalls}` },
              }),
            );
          }),
        Effect.succeed,
      );
      const limitRpc = yield* runtime(redirectChain, localLayer);
      const limitResult = yield* Effect.result(
        limitRpc.HttpClientRequest({ method: "GET", url: "https://example.com/start" }),
      );
      assert.isTrue(Result.isFailure(limitResult));
      if (Result.isFailure(limitResult))
        assert.include(limitResult.failure.reason, "Redirect limit");
      assert.strictEqual(limitCalls, 6);
    }),
  );

  it.effect("releases every status-only response", () =>
    Effect.gen(function* () {
      let aborted = 0;
      const httpClient = HttpClient.make((request, _url, signal) =>
        Effect.sync(() => {
          signal.addEventListener("abort", () => aborted++);
          return HttpClientResponse.fromWeb(
            request,
            request.url.endsWith("/start")
              ? new Response(undefined, { status: 302, headers: { location: "/complete" } })
              : new Response(undefined, { status: 200 }),
          );
        }),
      );
      const rpc = yield* runtime(httpClient, localLayer);

      assert.strictEqual(
        yield* rpc.HttpClientRequest({ method: "GET", url: "http://localhost/start" }),
        200,
      );
      assert.strictEqual(aborted, 2);
    }),
  );

  it.effect("times out with a typed failure and cancels the request", () =>
    Effect.gen(function* () {
      let aborted = false;
      const httpClient = HttpClient.make((_request, _url, signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return Effect.never;
      });
      const rpc = yield* runtime(httpClient, localLayer);
      const fiber = yield* rpc
        .HttpClientRequest({ method: "GET", url: "http://localhost/slow" })
        .pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("30 seconds");
      const result = yield* Fiber.join(fiber);

      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.strictEqual(result.failure._tag, "HttpClientRequestFailure");
        assert.include(result.failure.reason, "timed out");
      }
      assert.isTrue(aborted);
    }),
  );
});
