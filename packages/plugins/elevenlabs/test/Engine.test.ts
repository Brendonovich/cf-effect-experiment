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

import { ElevenLabsEngine } from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";

const speech = {
  text: "Hello",
  modelId: "eleven_multilingual_v2",
  voiceId: "voice_123",
  body: "{}",
};
const mock = (respond: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request))),
  );

const setup = Effect.fnUntraced(function* (httpClient: HttpClient.HttpClient) {
  let storage: typeof ElevenLabsEngine.Storage.Type = { apiKey: null };
  let refreshes = 0;
  const context = Layer.succeed(ElevenLabsEngine.EngineContext)(
    ElevenLabsEngine.EngineContext.of({
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
  const clients = yield* EngineTest.makeClients(ElevenLabsEngine).pipe(
    Effect.provide(deployment.layer),
    Effect.provide(context),
    Effect.provide(Layer.succeed(HttpClient.HttpClient)(httpClient)),
  );
  return { ...clients, storage: () => storage, refreshes: () => refreshes };
});

describe("ElevenLabs engine", () => {
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
            new Response(new ReadableStream(), { headers: { "content-type": "audio/mpeg" } }),
          );
        }),
      );
      const { runtime, client } = yield* setup(httpClient);
      yield* client.ElevenLabsUpdateKey({ apiKey: "secret" });
      const fiber = yield* runtime.ElevenLabsTTS(speech).pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("60 seconds");
      const result = yield* Fiber.join(fiber);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Request timed out");
      assert.isTrue(aborted);
    }),
  );

  it.effect("persists, replaces and clears keys without exposing them to the client", () =>
    Effect.gen(function* () {
      let calls = 0;
      const { engine, client, runtime, storage, refreshes } = yield* setup(
        mock(() => {
          calls++;
          return new Response("audio", { headers: { "content-type": "audio/mpeg" } });
        }),
      );
      assert.deepStrictEqual(yield* engine.client.state, { configured: false });
      const unconfigured = yield* Effect.result(runtime.ElevenLabsTTS(speech));
      assert.isTrue(Result.isFailure(unconfigured));
      if (Result.isFailure(unconfigured))
        assert.strictEqual(unconfigured.failure.reason, "API key is not configured");
      assert.strictEqual(calls, 0);
      yield* client.ElevenLabsUpdateKey({ apiKey: " secret " });
      assert.deepStrictEqual(storage(), { apiKey: "secret" });
      assert.deepStrictEqual(yield* engine.client.state, { configured: true });
      yield* client.ElevenLabsUpdateKey({ apiKey: "replacement" });
      assert.deepStrictEqual(storage(), { apiKey: "replacement" });
      for (const apiKey of ["", "  ", "secret\nheader", "secret key"]) {
        assert.isTrue(
          Result.isFailure(yield* Effect.result(client.ElevenLabsUpdateKey({ apiKey }))),
        );
      }
      assert.deepStrictEqual(storage(), { apiKey: "replacement" });
      yield* client.ElevenLabsClearKey();
      assert.deepStrictEqual(storage(), { apiKey: null });
      assert.deepStrictEqual(yield* engine.client.state, { configured: false });
      assert.isTrue(Result.isFailure(yield* Effect.result(runtime.ElevenLabsTTS(speech))));
      assert.strictEqual(calls, 0);
      assert.strictEqual(refreshes(), 3);
    }),
  );

  it.effect("sends validated options to the official origin and returns MP3 base64", () =>
    Effect.gen(function* () {
      let closed = 0;
      const options = {
        language_code: "en",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.7,
          style: 0,
          use_speaker_boost: false,
          speed: 1,
        },
        seed: 0,
        previous_text: "Before",
        next_text: "After",
      };
      const httpClient = HttpClient.make((request, url, signal) =>
        Effect.gen(function* () {
          const init = Option.getOrThrow(yield* Effect.serviceOption(FetchHttpClient.RequestInit));
          const redacted = Headers.redact(request.headers, yield* Headers.CurrentRedactedNames);
          assert.notInclude(String(redacted["xi-api-key"]), "secret");
          assert.strictEqual(init.redirect, "manual");
          assert.strictEqual(init.credentials, "omit");
          assert.strictEqual(
            url.href,
            "https://api.elevenlabs.io/v1/text-to-speech/voice_123?output_format=mp3_44100_128",
          );
          assert.strictEqual(request.method, "POST");
          assert.strictEqual(request.headers["xi-api-key"], "secret");
          assert.strictEqual(request.headers.accept, "audio/mpeg");
          assert.strictEqual(request.headers["content-type"], "application/json");
          assert.strictEqual(request.body._tag, "Uint8Array");
          if (request.body._tag === "Uint8Array") {
            assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(request.body.body)), {
              ...options,
              text: "Hello",
              model_id: "eleven_turbo_v2_5",
            });
          }
          signal.addEventListener("abort", () => closed++);
          return HttpClientResponse.fromWeb(
            request,
            new Response(new Uint8Array([73, 68, 51, 0, 255]), {
              headers: { "content-type": "audio/mpeg; charset=binary" },
            }),
          );
        }),
      );
      const { runtime, client } = yield* setup(httpClient);
      yield* client.ElevenLabsUpdateKey({ apiKey: "secret" });
      assert.deepStrictEqual(
        yield* runtime.ElevenLabsTTS({
          ...speech,
          modelId: "eleven_turbo_v2_5",
          body: JSON.stringify(options),
        }),
        { audio: "SUQzAP8=", mime: "audio/mpeg" },
      );
      assert.strictEqual(closed, 1);
    }),
  );

  it.effect("rejects invalid voice IDs, text, model and JSON options before provider calls", () =>
    Effect.gen(function* () {
      let calls = 0;
      const { runtime, client } = yield* setup(
        mock(() => {
          calls++;
          return new Response("audio");
        }),
      );
      yield* client.ElevenLabsUpdateKey({ apiKey: "secret" });
      for (const body of [
        "not json",
        "[]",
        "null",
        '{"text":"override"}',
        '{"model_id":"override"}',
        '{"url":"https://attacker.example"}',
        '{"voice_settings":{"stability":2}}',
        '{"voice_settings":{"similarity_boost":-1}}',
        '{"voice_settings":{"style":"0"}}',
        '{"voice_settings":{"use_speaker_boost":1}}',
        '{"voice_settings":{"speed":2}}',
        '{"voice_settings":{"extra":true}}',
        '{"seed":-1}',
        '{"seed":1.5}',
        '{"seed":4294967296}',
        '{"language_code":"english"}',
      ]) {
        const result = yield* Effect.result(runtime.ElevenLabsTTS({ ...speech, body }));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Invalid input");
      }
      for (const voiceId of [
        "",
        "../escape",
        "voice?x=1",
        "https://attacker.example/",
        "voice#fragment",
        "a%2fb",
      ]) {
        assert.isTrue(
          Result.isFailure(yield* Effect.result(runtime.ElevenLabsTTS({ ...speech, voiceId }))),
        );
      }
      assert.isTrue(
        Result.isFailure(yield* Effect.result(runtime.ElevenLabsTTS({ ...speech, text: " " }))),
      );
      assert.isTrue(
        Result.isFailure(yield* Effect.result(runtime.ElevenLabsTTS({ ...speech, modelId: " " }))),
      );
      assert.strictEqual(calls, 0);
    }),
  );

  it.effect("rejects missing/wrong MIME types and empty audio", () =>
    Effect.gen(function* () {
      for (const response of [
        new Response("secret provider body"),
        Response.json({ error: "secret" }),
        new Response("audio", { headers: { "content-type": "audio/wav" } }),
        new Response(null, { headers: { "content-type": "audio/mpeg" } }),
      ]) {
        const { runtime, client } = yield* setup(mock(() => response));
        yield* client.ElevenLabsUpdateKey({ apiKey: "secret" });
        const result = yield* Effect.result(runtime.ElevenLabsTTS(speech));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.strictEqual(result.failure._tag, "ElevenLabsRequestFailure");
          assert.strictEqual(result.failure.reason, "Invalid provider response");
          assert.notInclude(JSON.stringify(result.failure), "secret");
        }
      }
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
        yield* client.ElevenLabsUpdateKey({ apiKey: "secret" });
        const result = yield* Effect.result(runtime.ElevenLabsTTS(speech));
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
      yield* client.ElevenLabsUpdateKey({ apiKey: "secret" });
      const result = yield* Effect.result(runtime.ElevenLabsTTS(speech));
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
      yield* client.ElevenLabsUpdateKey({ apiKey: "secret" });
      const fiber = yield* runtime.ElevenLabsTTS(speech).pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("60 seconds");
      const result = yield* Fiber.join(fiber);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Request timed out");
      assert.isTrue(aborted);
    }),
  );
});
