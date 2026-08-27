import type * as Executor from "@macrograph/execution/Executor";

import { assert, describe, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Engine } from "@macrograph/plugin";
import { ElevenLabsEngine } from "@macrograph/plugin-elevenlabs/Definition";
import { HttpClientEngine } from "@macrograph/plugin-http-client/Definition";
import { OpenAIEngine } from "@macrograph/plugin-openai/Definition";
import { unavailableRuntimeClient as unavailableTwitchRuntime } from "@macrograph/plugin-twitch/Engine";
import { ProjectExecutor } from "@macrograph/project-host";
import { Cause, Effect, Option } from "effect";
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import * as ExecutorPlugins from "../src/execution/ExecutorPlugins.ts";
import * as WorkflowRuntime from "../src/execution/WorkflowRuntime.ts";

const chat = { message: "Hello", model: "gpt-4o-mini", historyIn: "[]" };
const speech = {
  text: "Hello",
  modelId: "eleven_multilingual_v2",
  voiceId: "voice_123",
  body: "{}",
};
const projectWithKeys = (openAI: string, elevenLabs: string): Project.Model => ({
  ...Project.empty(),
  engines: { openai: { apiKey: openAI }, elevenlabs: { apiKey: elevenLabs } },
});
const mock = (respond: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request))),
  );
const setup = Effect.fnUntraced(function* (
  project: Project.Model,
  httpClient: HttpClient.HttpClient,
) {
  const engineClient = yield* WorkflowRuntime.make(project).pipe(
    Effect.provideService(HttpClient.HttpClient, httpClient),
  );
  return {
    engineClient,
    openAI: (yield* engineClient("openai")) as Engine.RuntimeClientOf<typeof OpenAIEngine>,
    elevenLabs: (yield* engineClient("elevenlabs")) as Engine.RuntimeClientOf<
      typeof ElevenLabsEngine
    >,
    http: (yield* engineClient("http-client")) as Engine.RuntimeClientOf<typeof HttpClientEngine>,
  };
});

describe("WorkflowRuntime", () => {
  it.effect("uses snapshot keys, exposes only runtime RPCs and preserves provider outputs", () =>
    Effect.gen(function* () {
      const project: Project.Model = Object.freeze({
        ...Project.empty(),
        engines: Object.freeze({
          openai: Object.freeze({ apiKey: "snapshot-openai" }),
          elevenlabs: Object.freeze({ apiKey: "snapshot-elevenlabs" }),
        }),
      });
      const before = JSON.stringify(project);
      const urls: Array<string> = [];
      const httpClient = HttpClient.make((request, url) =>
        Effect.gen(function* () {
          urls.push(url.href);
          const init = Option.getOrThrow(yield* Effect.serviceOption(FetchHttpClient.RequestInit));
          assert.strictEqual(init.redirect, "manual");
          assert.strictEqual(init.credentials, "omit");
          assert.strictEqual(request.method, "POST");
          const redacted = Headers.redact(request.headers, yield* Headers.CurrentRedactedNames);
          if (url.origin === "https://api.openai.com") {
            assert.strictEqual(request.headers.authorization, "Bearer snapshot-openai");
            assert.notProperty(request.headers, "xi-api-key");
            assert.notInclude(String(redacted.authorization), "snapshot-openai");
            return HttpClientResponse.fromWeb(
              request,
              Response.json(
                url.pathname === "/v1/chat/completions"
                  ? { choices: [{ message: { content: "Hi" } }] }
                  : { data: [{ b64_json: "aW1hZ2U=", url: "https://images.example/image.png" }] },
              ),
            );
          }
          assert.strictEqual(url.origin, "https://api.elevenlabs.io");
          assert.strictEqual(request.headers["xi-api-key"], "snapshot-elevenlabs");
          assert.notProperty(request.headers, "authorization");
          assert.notInclude(String(redacted["xi-api-key"]), "snapshot-elevenlabs");
          return HttpClientResponse.fromWeb(
            request,
            new Response("audio", { headers: { "content-type": "audio/mpeg" } }),
          );
        }),
      );
      const { openAI, elevenLabs } = yield* setup(project, httpClient).pipe(
        Effect.provideService(Engine.Credentials, {
          get: Effect.die("Browser credentials must not be read"),
          refresh: () => Effect.die("Browser credentials must not be refreshed"),
          subscribe: () => Effect.die("Browser credentials must not be subscribed to"),
        }),
      );
      assert.sameMembers(Object.keys(openAI), ["OpenAIChat", "OpenAIImage"]);
      assert.sameMembers(Object.keys(elevenLabs), ["ElevenLabsTTS"]);
      assert.deepStrictEqual(yield* openAI.OpenAIChat(chat), {
        response: "Hi",
        historyOut: JSON.stringify([
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ]),
      });
      assert.deepStrictEqual(
        yield* openAI.OpenAIImage({ prompt: "A tree", model: "gpt-image-1" }),
        {
          url: null,
          base64: "aW1hZ2U=",
          mime: "image/png",
          revised: null,
        },
      );
      assert.deepStrictEqual(yield* openAI.OpenAIImage({ prompt: "A tree", model: "dall-e-3" }), {
        url: "https://images.example/image.png",
        base64: null,
        mime: "image/png",
        revised: null,
      });
      assert.deepStrictEqual(yield* elevenLabs.ElevenLabsTTS(speech), {
        audio: "YXVkaW8=",
        mime: "audio/mpeg",
      });
      assert.deepStrictEqual(urls, [
        "https://api.openai.com/v1/chat/completions",
        "https://api.openai.com/v1/images/generations",
        "https://api.openai.com/v1/images/generations",
        "https://api.elevenlabs.io/v1/text-to-speech/voice_123?output_format=mp3_44100_128",
      ]);
      assert.strictEqual(JSON.stringify(project), before);
    }),
  );

  it.effect("isolates interleaved project runtimes", () =>
    Effect.gen(function* () {
      const keys: Array<string> = [];
      const httpClient = mock((request) => {
        if (request.headers.authorization !== undefined) {
          keys.push(request.headers.authorization);
          return Response.json({ choices: [{ message: { content: "Hi" } }] });
        }
        keys.push(request.headers["xi-api-key"]!);
        return new Response("audio", { headers: { "content-type": "audio/mpeg" } });
      });
      const first = yield* setup(projectWithKeys("first-openai", "first-elevenlabs"), httpClient);
      const second = yield* setup(
        projectWithKeys("second-openai", "second-elevenlabs"),
        httpClient,
      );
      for (const runtime of [first, second, first]) {
        yield* runtime.openAI.OpenAIChat(chat);
        yield* runtime.elevenLabs.ElevenLabsTTS(speech);
      }
      assert.deepStrictEqual(keys, [
        "Bearer first-openai",
        "first-elevenlabs",
        "Bearer second-openai",
        "second-elevenlabs",
        "Bearer first-openai",
        "first-elevenlabs",
      ]);
    }),
  );

  it.effect("defaults absent storage and fails safely for missing or blank keys without HTTP", () =>
    Effect.gen(function* () {
      const httpClient = mock(() => assert.fail("Unconfigured engines must not send requests"));
      const storageCases: ReadonlyArray<Project.Model["engines"]> = [
        {},
        { openai: { apiKey: null }, elevenlabs: { apiKey: null } },
        { openai: { apiKey: " " }, elevenlabs: { apiKey: " " } },
      ];
      for (const engines of storageCases) {
        const { openAI, elevenLabs } = yield* setup({ ...Project.empty(), engines }, httpClient);
        const openAIFailure = yield* Effect.flip(openAI.OpenAIChat(chat));
        assert.strictEqual(openAIFailure._tag, "OpenAIRequestFailure");
        assert.strictEqual(openAIFailure.reason, "API key is not configured");
        const elevenLabsFailure = yield* Effect.flip(elevenLabs.ElevenLabsTTS(speech));
        assert.strictEqual(elevenLabsFailure._tag, "ElevenLabsRequestFailure");
        assert.strictEqual(elevenLabsFailure.reason, "API key is not configured");
      }
    }),
  );

  it.effect("registers malformed unused engines without requesting runtimes for pure IDs", () =>
    Effect.gen(function* () {
      const project: Project.Model = {
        ...Project.empty(),
        engines: { openai: { apiKey: 123 }, elevenlabs: { apiKey: false } },
      };
      const { engineClient, http } = yield* setup(
        project,
        mock(() => new Response(null, { status: 204 })),
      );
      const requested: Array<string> = [];
      yield* ProjectExecutor.make(project, {
        plugins: ExecutorPlugins.registry,
        engineClient: (id) => {
          requested.push(id);
          return engineClient(id);
        },
      });
      assert.include(requested, "openai");
      assert.include(requested, "elevenlabs");
      for (const id of ["json", "list", "logic", "math", "string"]) {
        assert.isTrue(ExecutorPlugins.registry.entries.some((entry) => entry.id === id));
        assert.notInclude(requested, id);
      }
      assert.strictEqual(
        yield* http.HttpClientRequest({ method: "GET", url: "https://example.com/" }),
        204,
      );
    }),
  );

  it.effect("validates each engine independently and hides malformed storage from failures", () =>
    Effect.gen(function* () {
      const httpClient = mock((request) =>
        request.headers.authorization !== undefined
          ? Response.json({ choices: [{ message: { content: "Hi" } }] })
          : new Response("audio", { headers: { "content-type": "audio/mpeg" } }),
      );
      const invalidOpenAI = yield* setup(
        {
          ...Project.empty(),
          engines: {
            openai: { apiKey: { secret: "must-not-leak" } },
            elevenlabs: { apiKey: "valid" },
          },
        },
        httpClient,
      );
      const openAICause = yield* invalidOpenAI.openAI
        .OpenAIChat(chat)
        .pipe(Effect.catchCause((cause) => Effect.succeed(String(Cause.squash(cause)))));
      assert.strictEqual(openAICause, "Invalid OpenAI deployment storage");
      yield* invalidOpenAI.elevenLabs.ElevenLabsTTS(speech);
      const invalidElevenLabs = yield* setup(
        {
          ...Project.empty(),
          engines: {
            openai: { apiKey: "valid" },
            elevenlabs: { apiKey: { secret: "must-not-leak" } },
          },
        },
        httpClient,
      );
      const elevenLabsCause = yield* invalidElevenLabs.elevenLabs
        .ElevenLabsTTS(speech)
        .pipe(Effect.catchCause((cause) => Effect.succeed(String(Cause.squash(cause)))));
      assert.strictEqual(elevenLabsCause, "Invalid ElevenLabs deployment storage");
      yield* invalidElevenLabs.openAI.OpenAIChat(chat);
    }),
  );

  it.effect("preserves secure HTTP policy, Twitch unavailability and the generic fallback", () =>
    Effect.gen(function* () {
      let calls = 0;
      const { engineClient, http } = yield* setup(
        Project.empty(),
        mock((request) => {
          calls++;
          assert.strictEqual(request.url, "https://example.com/");
          return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } });
        }),
      );
      const failure = yield* Effect.flip(
        http.HttpClientRequest({ method: "GET", url: "https://example.com/" }),
      );
      assert.strictEqual(failure._tag, "HttpClientRequestFailure");
      assert.strictEqual(calls, 1);
      const twitch = (yield* engineClient("twitch")) as typeof unavailableTwitchRuntime;
      assert.strictEqual(twitch, unavailableTwitchRuntime);
      const twitchFailure = yield* Effect.flip(twitch.SendChatMessage());
      assert.strictEqual(twitchFailure._tag, "TwitchExecutionUnavailable");
      assert.include(twitchFailure.reason, "no credential-scoped workflow RPC binding exists");
      const unknown = (yield* engineClient("unknown-plugin")) as Record<
        string,
        () => Effect.Effect<never, Executor.EngineClientUnavailable>
      >;
      const unavailable = yield* Effect.flip(unknown.SomeRuntimeRpc!());
      assert.strictEqual(unavailable._tag, "EngineClientUnavailable");
      assert.strictEqual(unavailable.pluginId, "unknown-plugin");
    }),
  );
});
