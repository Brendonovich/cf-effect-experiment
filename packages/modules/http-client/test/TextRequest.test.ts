import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import { TextRequest, TextResponse } from "../src/Definition.ts";
import { makeRuntimeClient, maxBodyBytes, maxHeaderBytes } from "../src/Engine.ts";
import { localLayer, secureLayer } from "../src/UrlPolicy.ts";

const mock = (respond: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.makeWith<
    HttpClientError.HttpClientError,
    never,
    HttpClientError.HttpClientError,
    never
  >(
    (requestEffect) =>
      Effect.map(requestEffect, (request) => HttpClientResponse.fromWeb(request, respond(request))),
    Effect.succeed,
  );
const runtime = (client: HttpClient.HttpClient, policy = localLayer) =>
  makeRuntimeClient().pipe(
    Effect.provide(policy),
    Effect.provide(Layer.succeed(HttpClient.HttpClient)(client)),
  );
const bodyText = (request: HttpClientRequest.HttpClientRequest) => {
  if (request.body._tag === "Empty") return "";
  assert.strictEqual(request.body._tag, "Uint8Array");
  return request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
};

describe("HTTP text requests", () => {
  it.effect("sends every method correctly with explicit headers and text bodies", () =>
    Effect.gen(function* () {
      const calls: Array<HttpClientRequest.HttpClientRequest> = [];
      const rpc = yield* runtime(
        mock((request) => {
          calls.push(request);
          return new Response(' { "ok": true } ', {
            status: 422,
            headers: { "Content-Type": "application/json; charset=utf-8", "X-Reply": "yes" },
          });
        }),
      );
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
        const result = yield* rpc.HttpClientRequestText({
          method,
          url: "http://localhost/api#fragment",
          body: method === "GET" ? "" : '{"hello":"\u00e9"}',
          headers:
            '{"Authorization":"Bearer test","Content-Type":"application/json","X-Request":"yes"}',
        });
        assert.deepStrictEqual(result, {
          status: 422,
          body: ' { "ok": true } ',
          contentType: "application/json; charset=utf-8",
          headers: { "content-type": "application/json; charset=utf-8", "x-reply": "yes" },
        });
        const request = calls.at(-1)!;
        assert.strictEqual(request.method, method);
        assert.strictEqual(request.url, "http://localhost/api");
        assert.strictEqual(bodyText(request), method === "GET" ? "" : '{"hello":"\u00e9"}');
        assert.strictEqual(request.headers.authorization, "Bearer test");
        assert.strictEqual(request.headers["content-type"], "application/json");
        assert.strictEqual(request.headers["x-request"], "yes");
      }
    }),
  );

  it.effect("preserves empty-body defaults and adds a plaintext content type only for a body", () =>
    Effect.gen(function* () {
      const calls: Array<HttpClientRequest.HttpClientRequest> = [];
      const rpc = yield* runtime(
        mock((request) => {
          calls.push(request);
          return new Response(undefined, { status: 204 });
        }),
      );
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
        assert.deepStrictEqual(
          yield* rpc.HttpClientRequestText({ method, url: "http://localhost" }),
          { status: 204, body: "", contentType: "", headers: {} },
        );
        assert.strictEqual(calls.at(-1)!.body._tag, "Empty");
        assert.isUndefined(calls.at(-1)!.headers["content-type"]);
      }
      yield* rpc.HttpClientRequestText({ method: "POST", url: "http://localhost", body: "hello" });
      assert.strictEqual(bodyText(calls.at(-1)!), "hello");
      assert.strictEqual(calls.at(-1)!.headers["content-type"], "text/plain; charset=utf-8");
    }),
  );

  it.effect(
    "returns raw text for HTML, JSON, unknown or missing content types, and error statuses",
    () =>
      Effect.gen(function* () {
        for (const [status, contentType, body] of [
          [200, "text/html", "<h1>Hello</h1>"],
          [400, "application/json", "not actually JSON"],
          [500, "application/octet-stream", "unknown type"],
          [200, "", "no content type"],
          [302, "text/plain", "redirect without location"],
          [304, "", undefined],
        ] as const) {
          const rpc = yield* runtime(
            mock(
              () =>
                new Response(body === undefined ? undefined : new TextEncoder().encode(body), {
                  status,
                  headers: contentType === "" ? {} : { "content-type": contentType },
                }),
            ),
          );
          const result = yield* rpc.HttpClientRequestText({
            method: "GET",
            url: "http://localhost",
          });
          assert.strictEqual(result.status, status);
          assert.strictEqual(result.body, body ?? "");
          assert.strictEqual(result.contentType, contentType);
        }
      }),
  );

  it.effect(
    "validates JSON headers, transport-controlled headers, body limits, and GET bodies before sending",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const rpc = yield* runtime(
          mock(() => {
            calls++;
            return new Response();
          }),
        );
        for (const headers of [
          "",
          "{secret",
          "null",
          "[]",
          "true",
          '"string"',
          '{"x":1}',
          '{"x":null}',
          '{"x":[]}',
          '{"x":{}}',
          '{"Bad Name":"value"}',
          '{"x":"secret\\r\\ninjected: bad"}',
          '{"x":"\\u0100"}',
          '{"X":"a","x":"b"}',
          '{"Host":"localhost"}',
          '{"Content-Length":"1"}',
          '{"Transfer-Encoding":"chunked"}',
          '{"Connection":"keep-alive"}',
          '{"Proxy-Authorization":"secret"}',
          '{"Sec-Fetch-Site":"same-origin"}',
          JSON.stringify({ x: "x".repeat(maxHeaderBytes) }),
        ]) {
          const result = yield* Effect.result(
            rpc.HttpClientRequestText({ method: "POST", url: "https://example.com", headers }),
          );
          assert.isTrue(Result.isFailure(result), headers.slice(0, 60));
          if (Result.isFailure(result)) {
            assert.strictEqual(result.failure._tag, "HttpClientRequestFailure");
            assert.strictEqual(result.failure.method, "POST");
            assert.notInclude(result.failure.reason, "secret");
          }
        }
        for (const [method, body] of [
          ["GET", "body"],
          ["PUT", "x".repeat(maxBodyBytes + 1)],
          ["POST", "\u00e9".repeat(maxBodyBytes / 2 + 1)],
        ] as const) {
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(
                rpc.HttpClientRequestText({ method, url: "https://example.com", body }),
              ),
            ),
          );
        }
        assert.strictEqual(calls, 0);
        yield* rpc.HttpClientRequestText({
          method: "POST",
          url: "https://example.com",
          body: "x".repeat(maxBodyBytes),
          headers: '{"__proto__":"safe","X":" value "}',
        });
        assert.strictEqual(calls, 1);
      }),
  );

  it.effect("validates RPC method, body, headers, and response types", () =>
    Effect.gen(function* () {
      for (const input of [
        { method: "HEAD", url: "https://example.com" },
        { method: "GET", url: 1 },
        { method: "PUT", url: "https://example.com", body: {} },
        { method: "GET", url: "https://example.com", headers: {} },
      ]) {
        assert.isTrue(
          Result.isFailure(yield* Effect.result(Schema.decodeUnknownEffect(TextRequest)(input))),
        );
      }
      assert.deepStrictEqual(
        yield* Schema.decodeUnknownEffect(TextRequest)({
          method: "GET",
          url: "https://example.com",
        }),
        { method: "GET", url: "https://example.com" },
      );
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(
            Schema.decodeUnknownEffect(TextResponse)({
              status: 200,
              body: "",
              contentType: "",
              headers: { x: 1 },
            }),
          ),
        ),
      );
    }),
  );

  it.effect("bounds streamed response bytes even without or with dishonest content-length", () =>
    Effect.gen(function* () {
      for (const length of [undefined, "1", String(maxBodyBytes + 1)]) {
        let aborted = 0;
        const http = HttpClient.make((request, _url, signal) =>
          Effect.sync(() => {
            signal.addEventListener("abort", () => aborted++);
            return HttpClientResponse.fromWeb(
              request,
              new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(new Uint8Array(maxBodyBytes));
                    controller.enqueue(new Uint8Array(1));
                    controller.close();
                  },
                }),
                { headers: length === undefined ? {} : { "content-length": length } },
              ),
            );
          }),
        );
        const rpc = yield* runtime(http);
        const result = yield* Effect.result(
          rpc.HttpClientRequestText({ method: "GET", url: "http://localhost" }),
        );
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result))
          assert.include(result.failure.reason, "Response body exceeds");
        assert.strictEqual(aborted, 1);
      }
      const exact = yield* runtime(mock(() => new Response("x".repeat(maxBodyBytes))));
      assert.lengthOf(
        (yield* exact.HttpClientRequestText({ method: "GET", url: "http://localhost" })).body,
        maxBodyBytes,
      );
      const headers = yield* runtime(
        mock(() => new Response("", { headers: { x: "x".repeat(maxHeaderBytes) } })),
      );
      const result = yield* Effect.result(
        headers.HttpClientRequestText({ method: "GET", url: "http://localhost" }),
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result))
        assert.include(result.failure.reason, "Response headers exceed");
    }),
  );

  it.effect("decodes UTF-8 across chunk boundaries and replaces malformed bytes", () =>
    Effect.gen(function* () {
      const rpc = yield* runtime(
        mock(
          () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  for (const bytes of [
                    [0x61, 0xc3],
                    [0xa9, 0xf0, 0x9f],
                    [0x9a, 0x80],
                    [0xff, 0xe2],
                  ])
                    controller.enqueue(new Uint8Array(bytes));
                  controller.close();
                },
              }),
            ),
        ),
      );
      assert.strictEqual(
        (yield* rpc.HttpClientRequestText({ method: "GET", url: "http://localhost" })).body,
        "a\u00e9\ud83d\ude80\ufffd\ufffd",
      );
    }),
  );

  it.effect(
    "rewrites POST redirects to GET and replays PUT/PATCH bodies with standard semantics",
    () =>
      Effect.gen(function* () {
        for (const origin of ["https://example.com", "https://other.example"]) {
          for (const [status, method, nextMethod] of [
            [301, "POST", "GET"],
            [302, "POST", "GET"],
            [303, "PUT", "GET"],
            [301, "PUT", "PUT"],
            [302, "PATCH", "PATCH"],
            [307, "POST", "POST"],
            [308, "DELETE", "DELETE"],
          ] as const) {
            const calls: Array<HttpClientRequest.HttpClientRequest> = [];
            const rpc = yield* runtime(
              mock((request) => {
                calls.push(request);
                return calls.length === 1
                  ? new Response("discard redirect body", {
                      status,
                      headers: { location: `${origin}/end` },
                    })
                  : new Response("final", { status: 202 });
              }),
              secureLayer,
            );
            const result = yield* rpc.HttpClientRequestText({
              method,
              url: "https://example.com/start",
              body: '{"x":1}',
              headers:
                '{"Authorization":"Bearer secret","Cookie":"session=secret","X-Api-Key":"secret","Content-Type":"application/json","Content-Encoding":"identity"}',
            });
            assert.strictEqual(result.status, 202);
            assert.strictEqual(result.body, "final");
            assert.deepStrictEqual(
              calls.map((request) => request.method),
              [method, nextMethod],
            );
            assert.strictEqual(bodyText(calls[1]!), nextMethod === "GET" ? "" : '{"x":1}');
            assert.strictEqual(
              calls[1]!.headers["content-type"],
              nextMethod === "GET" ? undefined : "application/json",
            );
            if (nextMethod === "GET") assert.isUndefined(calls[1]!.headers["content-encoding"]);
            for (const header of ["authorization", "cookie", "x-api-key"]) {
              if (origin === "https://example.com") assert.isDefined(calls[1]!.headers[header]);
              else assert.isUndefined(calls[1]!.headers[header]);
            }
          }
        }
      }),
  );

  it.effect("retains hosted URL protections for detailed requests and every redirect", () =>
    Effect.gen(function* () {
      let calls = 0;
      const rpc = yield* runtime(
        mock(() => {
          calls++;
          return new Response(undefined, {
            status: 307,
            headers: { location: "https://127.0.0.1/private" },
          });
        }),
        secureLayer,
      );
      for (const url of [
        "not a URL",
        "file:///etc/passwd",
        "http://example.com",
        "https://localhost",
        "https://[::1]",
        "https://user:secret@example.com",
        "https://example.com:8443",
      ]) {
        const result = yield* Effect.result(
          rpc.HttpClientRequestText({ method: "PUT", url, body: "test" }),
        );
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.notInclude(result.failure.url, "secret");
      }
      assert.strictEqual(calls, 0);
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(
            rpc.HttpClientRequestText({
              method: "PUT",
              url: "https://example.com/start",
              body: "secret",
            }),
          ),
        ),
      );
      assert.strictEqual(calls, 1);
    }),
  );

  it.effect(
    "reports body-read errors as typed failures while the old RPC still discards bodies",
    () =>
      Effect.gen(function* () {
        const rpc = yield* runtime(
          mock(
            () =>
              new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.error(new Error("broken stream"));
                  },
                }),
              ),
          ),
        );
        assert.strictEqual(
          yield* rpc.HttpClientRequest({ method: "GET", url: "http://localhost" }),
          200,
        );
        const result = yield* Effect.result(
          rpc.HttpClientRequestText({ method: "GET", url: "http://localhost" }),
        );
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.strictEqual(result.failure._tag, "HttpClientRequestFailure");
          assert.include(result.failure.reason, "Request failed");
        }
      }),
  );

  it.effect(
    "discards redirect bodies and releases each response after consuming terminal text",
    () =>
      Effect.gen(function* () {
        let aborted = 0;
        const rpc = yield* runtime(
          HttpClient.make((request, _url, signal) =>
            Effect.sync(() => {
              signal.addEventListener("abort", () => aborted++);
              return HttpClientResponse.fromWeb(
                request,
                request.url.endsWith("/start")
                  ? new Response(
                      new ReadableStream<Uint8Array>({
                        start(controller) {
                          controller.error(new Error("redirect body must not be consumed"));
                        },
                      }),
                      { status: 302, headers: { location: "/end" } },
                    )
                  : new Response("terminal"),
              );
            }),
          ),
        );
        assert.strictEqual(
          (yield* rpc.HttpClientRequestText({ method: "GET", url: "http://localhost/start" })).body,
          "terminal",
        );
        assert.strictEqual(aborted, 2);
      }),
  );

  it.effect("includes body consumption in the 30-second timeout and closes response scopes", () =>
    Effect.gen(function* () {
      let aborted = 0;
      const rpc = yield* runtime(
        HttpClient.make((request, _url, signal) =>
          Effect.sync(() => {
            signal.addEventListener("abort", () => aborted++);
            return HttpClientResponse.fromWeb(
              request,
              new Response(new ReadableStream<Uint8Array>()),
            );
          }),
        ),
      );
      const fiber = yield* rpc
        .HttpClientRequestText({ method: "GET", url: "http://localhost/slow" })
        .pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("30 seconds");
      const result = yield* Fiber.join(fiber);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.include(result.failure.reason, "timed out");
      assert.strictEqual(aborted, 1);
    }),
  );

  it.effect("uses manual redirects and omitted ambient credentials with the Fetch runtime", () =>
    Effect.gen(function* () {
      const calls: Array<RequestInit> = [];
      const fetch: typeof globalThis.fetch = (_url, init) => {
        calls.push(init!);
        return Promise.resolve(
          calls.length === 1
            ? new Response(undefined, { status: 307, headers: { location: "/end" } })
            : new Response("done"),
        );
      };
      const rpc = yield* makeRuntimeClient().pipe(
        Effect.provide(secureLayer),
        Effect.provide(
          FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch))),
        ),
      );
      assert.strictEqual(
        (yield* rpc.HttpClientRequestText({
          method: "PUT",
          url: "https://example.com/start",
          body: "hello",
          headers: '{"X-Request":"yes"}',
        })).body,
        "done",
      );
      assert.lengthOf(calls, 2);
      for (const call of calls) {
        assert.strictEqual(call.method, "PUT");
        assert.strictEqual(call.redirect, "manual");
        assert.strictEqual(call.credentials, "omit");
        assert.strictEqual(new Headers(call.headers).get("x-request"), "yes");
        assert.isTrue(call.signal!.aborted);
        assert.isTrue(call.body instanceof Uint8Array);
        if (call.body instanceof Uint8Array)
          assert.strictEqual(new TextDecoder().decode(call.body), "hello");
      }
    }),
  );
});
