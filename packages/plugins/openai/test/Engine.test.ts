import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Effect, Fiber, Layer, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import { OpenAIEngine } from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";

const chat = { message: "Hello", model: "gpt-4o-mini", historyIn: "[]" };
const image = { prompt: "A tree", model: "gpt-image-1" };
const mock = (respond: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request))),
  );

const setup = Effect.fnUntraced(function* (httpClient: HttpClient.HttpClient) {
  let storage: typeof OpenAIEngine.Storage.Type = { apiKey: null };
  let refreshes = 0;
  const context = Layer.succeed(OpenAIEngine.EngineContext)(
    OpenAIEngine.EngineContext.of({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) => Effect.sync(() => void (storage = value)),
        update: (f) => Effect.sync(() => void (storage = f(storage))),
      },
      resource: { refresh: () => Effect.void },
      credentials: {
        get: Effect.succeed([]),
        refresh: () => Effect.die("No credentials"),
        subscribe: () => Effect.void,
      },
      client: { refresh: Effect.sync(() => void refreshes++) },
      emit: () => Effect.void,
    }),
  );
  const clients = yield* EngineTest.makeClients(OpenAIEngine).pipe(
    Effect.provide(deployment.layer),
    Effect.provide(context),
    Effect.provide(Layer.succeed(HttpClient.HttpClient)(httpClient)),
  );
  return { ...clients, storage: () => storage, refreshes: () => refreshes };
});

describe("OpenAI engine", () => {
  it.effect("validates large base64 image payloads", () =>
    Effect.gen(function* () {
      const base64 = "AAAA".repeat(262144);
      const { runtime, client } = yield* setup(
        mock(() => Response.json({ data: [{ b64_json: base64 }] })),
      );
      yield* client.OpenAIUpdateKey({ apiKey: "secret" });
      const result = yield* runtime.OpenAIImage(image);
      assert.strictEqual(result.base64, base64);
      assert.isNull(result.url);
      assert.isNull(result.revised);
    }),
  );

  it.effect("times out while consuming a stalled response body", () =>
    Effect.gen(function* () {
      let aborted = false;
      const httpClient = HttpClient.make((request, _url, signal) =>
        Effect.sync(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return HttpClientResponse.fromWeb(
            request,
            new Response(new ReadableStream(), { headers: { "content-type": "application/json" } }),
          );
        }),
      );
      const { runtime, client } = yield* setup(httpClient);
      yield* client.OpenAIUpdateKey({ apiKey: "secret" });
      const fiber = yield* runtime.OpenAIImage(image).pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("60 seconds");
      const result = yield* Fiber.join(fiber);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.strictEqual(result.failure.reason, "Request timed out");
        assert.strictEqual(result.failure.operation, "image");
      }
      assert.isTrue(aborted);
    }),
  );

  it.effect("persists, replaces and clears keys without exposing them to the client", () =>
    Effect.gen(function* () {
      let calls = 0;
      const { engine, client, runtime, storage, refreshes } = yield* setup(
        mock(() => {
          calls++;
          return Response.json({ choices: [{ message: { content: "Hi" } }] });
        }),
      );
      assert.deepStrictEqual(yield* engine.client.state, { configured: false });
      const unconfigured = yield* Effect.result(runtime.OpenAIChat(chat));
      assert.isTrue(Result.isFailure(unconfigured));
      if (Result.isFailure(unconfigured))
        assert.strictEqual(unconfigured.failure.reason, "API key is not configured");
      assert.strictEqual(calls, 0);
      yield* client.OpenAIUpdateKey({ apiKey: " secret " });
      assert.deepStrictEqual(storage(), { apiKey: "secret" });
      assert.deepStrictEqual(yield* engine.client.state, { configured: true });
      yield* client.OpenAIUpdateKey({ apiKey: "replacement" });
      assert.deepStrictEqual(storage(), { apiKey: "replacement" });
      for (const apiKey of ["", "  ", "secret\nheader", "secret key"]) {
        assert.isTrue(Result.isFailure(yield* Effect.result(client.OpenAIUpdateKey({ apiKey }))));
      }
      assert.deepStrictEqual(storage(), { apiKey: "replacement" });
      yield* client.OpenAIClearKey();
      assert.deepStrictEqual(storage(), { apiKey: null });
      assert.deepStrictEqual(yield* engine.client.state, { configured: false });
      assert.isTrue(Result.isFailure(yield* Effect.result(runtime.OpenAIImage(image))));
      assert.strictEqual(calls, 0);
      assert.strictEqual(refreshes(), 3);
    }),
  );

  it.effect("sends non-streaming chat with validated history to the official origin", () =>
    Effect.gen(function* () {
      let closed = 0;
      const httpClient = HttpClient.make((request, url, signal) =>
        Effect.gen(function* () {
          const init = Option.getOrThrow(yield* Effect.serviceOption(FetchHttpClient.RequestInit));
          const redacted = Headers.redact(request.headers, yield* Headers.CurrentRedactedNames);
          assert.notInclude(String(redacted.authorization), "secret");
          assert.strictEqual(init.redirect, "manual");
          assert.strictEqual(init.credentials, "omit");
          assert.strictEqual(url.href, "https://api.openai.com/v1/chat/completions");
          assert.strictEqual(request.method, "POST");
          assert.strictEqual(request.headers.authorization, "Bearer secret");
          assert.strictEqual(request.headers["content-type"], "application/json");
          assert.strictEqual(request.body._tag, "Uint8Array");
          if (request.body._tag === "Uint8Array") {
            assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(request.body.body)), {
              model: "gpt-4o-mini",
              stream: false,
              messages: [
                { role: "system", content: "Be brief" },
                { role: "user", content: "Hello" },
              ],
            });
          }
          signal.addEventListener("abort", () => closed++);
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ choices: [{ message: { content: "Hi" } }] }),
          );
        }),
      );
      const { runtime, client } = yield* setup(httpClient);
      yield* client.OpenAIUpdateKey({ apiKey: "secret" });
      const result = yield* runtime.OpenAIChat({
        ...chat,
        historyIn: '[{"role":"system","content":"Be brief"}]',
      });
      assert.strictEqual(result.response, "Hi");
      assert.deepStrictEqual(JSON.parse(result.historyOut), [
        { role: "system", content: "Be brief" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ]);
      assert.strictEqual(closed, 1);
    }),
  );

  it.effect(
    "generates modern base64 images and legacy DALL-E URLs with model-specific parameters",
    () =>
      Effect.gen(function* () {
        const requests: Array<unknown> = [];
        const { runtime, client } = yield* setup(
          mock((request) => {
            assert.strictEqual(request.url, "https://api.openai.com/v1/images/generations");
            assert.strictEqual(request.headers.authorization, "Bearer secret");
            assert.strictEqual(request.body._tag, "Uint8Array");
            if (request.body._tag === "Uint8Array")
              requests.push(JSON.parse(new TextDecoder().decode(request.body.body)));
            return Response.json({
              data: [
                {
                  url: "https://images.example/image.png",
                  b64_json: "aW1hZ2U=",
                  revised_prompt: "A green tree",
                },
              ],
            });
          }),
        );
        yield* client.OpenAIUpdateKey({ apiKey: "secret" });
        for (const model of [
          "gpt-image-1",
          "gpt-image-1-mini",
          "gpt-image-1.5",
          "dall-e-2",
          "dall-e-3",
        ]) {
          const legacy = model.startsWith("dall-e");
          const result = yield* runtime.OpenAIImage({ ...image, model });
          assert.deepStrictEqual(result, {
            url: legacy ? "https://images.example/image.png" : null,
            base64: legacy ? null : "aW1hZ2U=",
            mime: "image/png",
            revised: "A green tree",
          });
          assert.deepStrictEqual(requests.at(-1), {
            model,
            prompt: "A tree",
            n: 1,
            size: "1024x1024",
            ...(legacy ? { response_format: "url" } : { output_format: "png" }),
            ...(model === "dall-e-3" ? { style: "vivid" } : {}),
          });
        }
        assert.strictEqual(requests.length, 5);
      }),
  );

  it.effect("rejects malformed inputs before making provider calls", () =>
    Effect.gen(function* () {
      let calls = 0;
      const { runtime, client } = yield* setup(
        mock(() => {
          calls++;
          return Response.json({});
        }),
      );
      yield* client.OpenAIUpdateKey({ apiKey: "secret" });
      for (const historyIn of [
        "not json",
        "{}",
        "null",
        '[{"role":"tool","content":"x"}]',
        '[{"role":"user"}]',
        '[{"role":"user","content":"x","extra":1}]',
      ]) {
        const result = yield* Effect.result(runtime.OpenAIChat({ ...chat, historyIn }));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Invalid input");
      }
      assert.isTrue(
        Result.isFailure(yield* Effect.result(runtime.OpenAIChat({ ...chat, message: " " }))),
      );
      assert.isTrue(
        Result.isFailure(yield* Effect.result(runtime.OpenAIChat({ ...chat, model: " " }))),
      );
      assert.isTrue(
        Result.isFailure(yield* Effect.result(runtime.OpenAIImage({ ...image, prompt: " " }))),
      );
      assert.isTrue(
        Result.isFailure(yield* Effect.result(runtime.OpenAIImage({ ...image, model: "unknown" }))),
      );
      assert.strictEqual(calls, 0);
    }),
  );

  it.effect("rejects malformed chat and image responses with safe typed failures", () =>
    Effect.gen(function* () {
      for (const json of [{}, { choices: [] }, { choices: [{ message: { content: null } }] }]) {
        const { runtime, client } = yield* setup(mock(() => Response.json(json)));
        yield* client.OpenAIUpdateKey({ apiKey: "secret" });
        const result = yield* Effect.result(runtime.OpenAIChat(chat));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.strictEqual(result.failure._tag, "OpenAIRequestFailure");
          assert.strictEqual(result.failure.reason, "Invalid provider response");
        }
      }
      for (const [model, json] of [
        ["gpt-image-1", { data: [] }],
        ["gpt-image-1", { data: [{}] }],
        ["gpt-image-1", { data: [{ b64_json: "%%%" }] }],
        ["gpt-image-1", { data: [{ b64_json: "" }] }],
        ["dall-e-3", { data: [{ url: "not a url" }] }],
        ["dall-e-3", { data: [{ url: "http://example.com" }] }],
        ["dall-e-3", { data: [{ url: "https://user:secret@example.com" }] }],
      ] as const) {
        const { runtime, client } = yield* setup(mock(() => Response.json(json)));
        yield* client.OpenAIUpdateKey({ apiKey: "secret" });
        const result = yield* Effect.result(runtime.OpenAIImage({ ...image, model }));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result))
          assert.strictEqual(result.failure.reason, "Invalid provider response");
      }
      const { runtime, client } = yield* setup(mock(() => new Response("secret provider body")));
      yield* client.OpenAIUpdateKey({ apiKey: "secret" });
      const invalidJson = yield* Effect.result(runtime.OpenAIChat(chat));
      assert.isTrue(Result.isFailure(invalidJson));
      if (Result.isFailure(invalidJson))
        assert.notInclude(JSON.stringify(invalidJson.failure), "secret");
    }),
  );

  it.effect("never follows redirects or exposes provider rejection bodies", () =>
    Effect.gen(function* () {
      for (const status of [302, 401, 429, 500]) {
        let calls = 0;
        const { runtime, client } = yield* setup(
          mock(() => {
            calls++;
            return new Response("secret provider error", {
              status,
              headers: { location: "https://attacker.example/" },
            });
          }),
        );
        yield* client.OpenAIUpdateKey({ apiKey: "secret" });
        const result = yield* Effect.result(runtime.OpenAIChat(chat));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.strictEqual(result.failure.reason, "Provider rejected request");
          assert.strictEqual(result.failure.status, status);
          assert.notInclude(JSON.stringify(result.failure), "secret");
          assert.notProperty(result.failure, "cause");
        }
        assert.strictEqual(calls, 1);
      }
    }),
  );

  it.effect("redacts transport errors", () =>
    Effect.gen(function* () {
      const httpClient = HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              description: "secret credential and provider error",
            }),
          }),
        ),
      );
      const { runtime, client } = yield* setup(httpClient);
      yield* client.OpenAIUpdateKey({ apiKey: "secret" });
      const result = yield* Effect.result(runtime.OpenAIChat(chat));
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.strictEqual(result.failure.reason, "Request failed");
        assert.notInclude(JSON.stringify(result.failure), "secret");
        assert.notProperty(result.failure, "cause");
      }
    }),
  );

  it.effect("times out and cancels provider requests", () =>
    Effect.gen(function* () {
      let aborted = false;
      const httpClient = HttpClient.make((_request, _url, signal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return Effect.never;
      });
      const { runtime, client } = yield* setup(httpClient);
      yield* client.OpenAIUpdateKey({ apiKey: "secret" });
      const fiber = yield* runtime.OpenAIChat(chat).pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("60 seconds");
      const result = yield* Fiber.join(fiber);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Request timed out");
      assert.isTrue(aborted);
    }),
  );
});
