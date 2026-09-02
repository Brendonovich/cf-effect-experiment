import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Model, Provider } from "@opencode-ai/client/effect";
import { Effect, Fiber, FileSystem, Layer, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { afterEach, beforeEach, vi } from "vitest";

import { OpenCodeConnection, OpenCodeEngine, OpenCodeModel } from "../src/Definition.ts";
import layer from "../src/Engine.ts";

const password = "test-private-password";
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
const connection = { address: "https://opencode.example", name: "Remote", password };
const persisted = { connections: { remote: connection } };
const location = {
  directory: "/workspace",
  project: { id: "project", directory: "/workspace", canonical: "/workspace" },
};
const provider = { ...Provider.Info.empty(Provider.ID.openai), name: "OpenAI / API" };
const model = { ...Model.Info.default(provider.id, Model.ID.make("gpt-test")), name: "Test model" };
const catalog = {
  providers: [{ id: provider.id, name: provider.name }],
  models: [{ id: model.id, providerID: provider.id, name: model.name }],
  defaultModel: "openai/gpt-test",
};
const session = {
  id: "ses_test",
  projectID: "project",
  title: "Test session",
  location: { directory: "/session-workspace" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
};
const prompt = { connection: "remote", sessionID: session.id, text: "Hello", model: "" };
const admission = {
  id: "msg_admitted",
  sessionID: session.id,
  timeCreated: 0,
  type: "user",
  payload: { text: prompt.text },
  delivery: "queue",
};

const respond = (request: HttpClientRequest.HttpClientRequest): Response => {
  switch (new URL(request.url).pathname) {
    case "/api/provider":
      return Response.json({ location, data: [provider] });
    case "/api/model":
      return Response.json({ location, data: [model] });
    case "/api/model/default":
      return Response.json({ location, data: model });
    case "/api/event":
      return new Response(new ReadableStream(), {
        headers: { "content-type": "text/event-stream" },
      });
    case "/api/session":
      return Response.json(
        request.method === "POST" ? { data: session } : { data: [session], cursor: {} },
      );
    case `/api/session/${session.id}`:
      return Response.json({ data: session });
    case `/api/session/${session.id}/model`:
    case `/api/session/${session.id}/wait`:
      return new Response(null, { status: 204 });
    case `/api/session/${session.id}/prompt`:
      return Response.json({ data: admission });
    default:
      throw new Error(`Unexpected mock request: ${request.method} ${request.url}`);
  }
};
const mock = (response = respond) =>
  HttpClient.make((request) =>
    Effect.sync(() => HttpClientResponse.fromWeb(request, response(request))),
  );
const body = (request: HttpClientRequest.HttpClientRequest): unknown => {
  assert.strictEqual(request.body._tag, "Uint8Array");
  return request.body._tag === "Uint8Array"
    ? JSON.parse(new TextDecoder().decode(request.body.body))
    : undefined;
};

const setup = Effect.fnUntraced(function* (
  httpClient: HttpClient.HttpClient = mock(),
  initialStorage: typeof OpenCodeEngine.Storage.Type = { connections: {} },
  fs: Partial<FileSystem.FileSystem> = {},
) {
  let storage = initialStorage;
  let refreshes = 0;
  const resourceRefreshes: Array<string> = [];
  let reloadModels = Effect.void;
  const context = Layer.succeed(OpenCodeEngine.EngineContext)(
    OpenCodeEngine.EngineContext.of({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) => Effect.sync(() => void (storage = value)),
        update: (f) => Effect.sync(() => void (storage = f(storage))),
      },
      resource: {
        refresh: (resource) =>
          Effect.gen(function* () {
            resourceRefreshes.push(resource.key);
            if (resource.key === OpenCodeModel.key) yield* reloadModels;
          }),
      },
      credentials: {
        get: Effect.succeed([]),
        refresh: () => Effect.die("No credentials"),
        subscribe: () => Effect.void,
      },
      client: { refresh: Effect.sync(() => void refreshes++) },
      emit: () => Effect.void,
    }),
  );
  const services = yield* Layer.build(
    layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          context,
          Layer.succeed(HttpClient.HttpClient)(httpClient),
          FileSystem.layerNoop(fs),
        ),
      ),
    ),
  );
  const clients = yield* EngineTest.makeClients(OpenCodeEngine).pipe(
    Effect.provideContext(services),
  );
  const resources = yield* Layer.build(clients.engine.resources);
  const models = yield* OpenCodeModel.Handler.pipe(Effect.provideContext(resources));
  reloadModels = models.reload;
  yield* TestClock.adjust("1 millis");
  return {
    ...clients,
    storage: () => storage,
    refreshes: () => refreshes,
    resourceRefreshes: () =>
      resourceRefreshes.filter((key) => key === OpenCodeConnection.key).length,
    modelRefreshes: () => resourceRefreshes.filter((key) => key === OpenCodeModel.key).length,
    models: models.values,
  };
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Native network access is disabled in tests"))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("OpenCode engine", () => {
  it.effect("publishes deduplicated string model resources and removes unavailable choices", () =>
    Effect.gen(function* () {
      const { models, client } = yield* setup(mock(), {
        connections: {
          remote: connection,
          second: { ...connection, address: "https://second.example" },
        },
      });
      const automatic = { id: "", display: "Automatic (Server Default / Session Model)" };
      const expected = [
        automatic,
        { id: "openai/gpt-test", display: "Test model (OpenAI / API)" },
      ];
      assert.deepStrictEqual(yield* models, expected);
      yield* client.OpenCodeRemoveConnection({ id: "remote" });
      assert.deepStrictEqual(yield* models, expected);
      yield* client.OpenCodeRemoveConnection({ id: "second" });
      assert.deepStrictEqual(yield* models, [automatic]);
    }),
  );

  it.effect("does not block host initialization on a stalled connection", () =>
    Effect.gen(function* () {
      const { engine } = yield* setup(
        HttpClient.make(() => Effect.never),
        persisted,
      );
      assert.strictEqual((yield* engine.client.state).connections[0]?.state, "connecting");
    }),
  );

  it.effect("starts empty without discovering or contacting a real service", () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = [];
      const { engine, runtime } = yield* setup(
        mock((request) => {
          requests.push(request);
          return respond(request);
        }),
      );
      assert.deepStrictEqual(yield* engine.client.state, { connections: [] });
      assert.isTrue(
        Result.isFailure(yield* Effect.result(runtime.OpenCodeSessions({ connection: "missing" }))),
      );
      assert.isEmpty(requests);
      assert.strictEqual(vi.mocked(fetch).mock.calls.length, 0);
    }),
  );

  it.effect("saves, edits, clears and removes manual connections without exposing passwords", () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = [];
      const { client, engine, runtime, storage, resourceRefreshes } = yield* setup(
        mock((request) => {
          requests.push(request);
          return respond(request);
        }),
      );
      yield* client.OpenCodeSaveConnection({
        ...connection,
        address: " https://opencode.example/ ",
        name: " Remote ",
      });
      const [id] = Object.keys(storage().connections);
      assert.isDefined(id);
      if (id === undefined) return;
      assert.deepStrictEqual(storage().connections[id], connection);
      assert.deepStrictEqual(yield* engine.client.state, {
        connections: [
          {
            id,
            address: connection.address,
            name: connection.name,
            discovered: false,
            state: "connected",
            catalog,
          },
        ],
      });
      assert.isTrue(requests.every((request) => request.headers.authorization === authorization));

      requests.length = 0;
      yield* client.OpenCodeSaveConnection({
        id,
        address: "https://edited.example/",
        name: "Edited",
      });
      assert.deepStrictEqual(storage(), {
        connections: { [id]: { address: "https://edited.example", name: "Edited", password } },
      });
      assert.isTrue(requests.every((request) => request.headers.authorization === authorization));
      assert.isTrue(
        requests.every((request) => new URL(request.url).origin === "https://edited.example"),
      );
      const serialized = JSON.stringify(yield* engine.client.state);
      assert.notInclude(serialized, password);
      assert.notInclude(serialized, authorization);
      assert.notInclude(serialized, "password");

      requests.length = 0;
      yield* client.OpenCodeSaveConnection({
        id,
        address: "https://edited.example",
        name: "Edited",
        password: "",
      });
      assert.strictEqual(storage().connections[id]?.password, "");
      assert.isTrue(requests.every((request) => request.headers.authorization === undefined));
      yield* client.OpenCodeRemoveConnection({ id });
      assert.deepStrictEqual(storage(), { connections: {} });
      assert.deepStrictEqual(yield* engine.client.state, { connections: [] });
      assert.isTrue(
        Result.isFailure(yield* Effect.result(runtime.OpenCodeSessions({ connection: id }))),
      );
      assert.strictEqual(resourceRefreshes(), 4);
    }),
  );

  it.effect("restores persisted connections at startup and protects transport credentials", () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.gen(function* () {
          assert.strictEqual(request.headers.authorization, authorization);
          const init = Option.getOrThrow(yield* Effect.serviceOption(FetchHttpClient.RequestInit));
          assert.strictEqual(init.redirect, "manual");
          assert.strictEqual(init.credentials, "omit");
          const redacted = Headers.redact(request.headers, yield* Headers.CurrentRedactedNames);
          assert.notInclude(String(redacted.authorization), authorization);
          return HttpClientResponse.fromWeb(request, respond(request));
        }),
      );
      const { engine, storage } = yield* setup(http, persisted);
      assert.deepStrictEqual(storage(), persisted);
      assert.deepStrictEqual(yield* engine.client.state, {
        connections: [
          {
            id: "remote",
            address: connection.address,
            name: connection.name,
            discovered: false,
            state: "connected",
            catalog,
          },
        ],
      });
    }),
  );

  it.effect(
    "rejects unsafe addresses and invalid edits without changing storage or making requests",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const { client, storage } = yield* setup(
          mock((request) => {
            calls++;
            return respond(request);
          }),
        );
        for (const address of [
          "not a url",
          "file:///workspace",
          "ftp://example.com",
          "https://user:secret@example.com",
          "https://example.com?secret=value",
          "https://example.com#secret",
          `https://example.com/${"x".repeat(2048)}`,
        ]) {
          const result = yield* Effect.result(
            client.OpenCodeSaveConnection({ ...connection, address }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.notInclude(JSON.stringify(result.failure), "secret");
        }
        for (const input of [
          { ...connection, name: " " },
          { ...connection, name: "x".repeat(257) },
          { ...connection, password: "x".repeat(4097) },
          { ...connection, id: "missing" },
          { ...connection, id: "local" },
        ])
          assert.isTrue(
            Result.isFailure(yield* Effect.result(client.OpenCodeSaveConnection(input))),
          );
        assert.deepStrictEqual(storage(), { connections: {} });
        assert.strictEqual(calls, 0);
      }),
  );

  it.effect(
    "discovers a registered local service, refreshes its endpoint and removes stale discovery",
    () =>
      Effect.gen(function* () {
        let registered = { url: "http://127.0.0.1:4000", pid: 12345, version: "test", password };
        let healthy = true;
        const nativeFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
          assert.strictEqual(String(input), `${registered.url}/api/health`);
          assert.strictEqual(
            new globalThis.Headers(init?.headers).get("authorization"),
            authorization,
          );
          return Promise.resolve(
            Response.json({ healthy, version: registered.version, pid: registered.pid }),
          );
        });
        vi.stubGlobal("fetch", nativeFetch);
        const { engine, client, storage } = yield* setup(
          mock(),
          { connections: {} },
          {
            readFileString: (path) =>
              Effect.sync(() => {
                assert.isTrue(path.endsWith("opencode/service.json"));
                return JSON.stringify(registered);
              }),
          },
        );
        assert.deepStrictEqual(yield* engine.client.state, {
          connections: [
            {
              id: "local",
              address: registered.url,
              name: "Local OpenCode",
              discovered: true,
              state: "connected",
              catalog,
            },
          ],
        });
        assert.deepStrictEqual(storage(), { connections: {} });
        assert.isTrue(
          Result.isFailure(yield* Effect.result(client.OpenCodeRemoveConnection({ id: "local" }))),
        );
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(client.OpenCodeSaveConnection({ ...connection, id: "local" })),
          ),
        );
        registered = { ...registered, url: "http://127.0.0.1:5000" };
        yield* client.OpenCodeRefresh();
        assert.strictEqual((yield* engine.client.state).connections[0]?.address, registered.url);
        healthy = false;
        yield* client.OpenCodeRefresh();
        assert.deepStrictEqual(yield* engine.client.state, { connections: [] });
        assert.strictEqual(nativeFetch.mock.calls.length, 3);
      }),
  );

  it.effect("decodes catalog envelopes and filters disabled providers and models", () =>
    Effect.gen(function* () {
      const disabledProvider = {
        ...Provider.Info.empty(Provider.ID.anthropic),
        activation: "disabled",
      };
      const { engine, runtime } = yield* setup(
        mock((request) => {
          switch (new URL(request.url).pathname) {
            case "/api/provider":
              return Response.json({ location, data: [provider, disabledProvider] });
            case "/api/model":
              return Response.json({
                location,
                data: [
                  {
                    ...model,
                    headers: { authorization: password },
                    settings: { apiKey: password },
                  },
                  { ...model, id: "disabled-model", enabled: false },
                  { ...model, id: "disabled-provider-model", providerID: disabledProvider.id },
                  { ...model, id: "unknown-provider-model", providerID: "unknown" },
                ],
              });
            default:
              return respond(request);
          }
        }),
        persisted,
      );
      assert.deepStrictEqual((yield* engine.client.state).connections[0]?.catalog, catalog);
      assert.deepStrictEqual(
        yield* runtime.OpenCodeCatalog({ connection: "remote", directory: "" }),
        catalog,
      );
      assert.notInclude(JSON.stringify(yield* engine.client.state), password);
    }),
  );

  it.effect("uses the requested directory or the session location for catalog queries", () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = [];
      const { runtime } = yield* setup(
        mock((request) => {
          requests.push(request);
          return respond(request);
        }),
        persisted,
      );
      for (const input of [
        { connection: "remote", directory: " /selected-workspace " },
        { connection: "remote", directory: "/ignored", sessionID: ` ${session.id} ` },
      ]) {
        requests.length = 0;
        yield* runtime.OpenCodeCatalog(input);
        const catalogRequests = requests.filter((request) =>
          ["/api/provider", "/api/model", "/api/model/default"].includes(
            new URL(request.url).pathname,
          ),
        );
        assert.strictEqual(catalogRequests.length, 3);
        for (const request of catalogRequests) {
          assert.deepStrictEqual(request.urlParams.params, [
            [
              "location[directory]",
              "sessionID" in input ? session.location.directory : "/selected-workspace",
            ],
          ]);
        }
      }
    }),
  );

  it.effect("represents an absent default model as null", () =>
    Effect.gen(function* () {
      const { runtime } = yield* setup(
        mock((request) =>
          new URL(request.url).pathname === "/api/model/default"
            ? Response.json({ location, data: null })
            : respond(request),
        ),
        persisted,
      );
      assert.deepStrictEqual(
        yield* runtime.OpenCodeCatalog({ connection: "remote", directory: "" }),
        { ...catalog, defaultModel: null },
      );
    }),
  );

  it.effect("refreshes the catalog from catalog.updated SSE events", () =>
    Effect.gen(function* () {
      let currentModel = model;
      let events: ReadableStreamDefaultController<Uint8Array> | undefined;
      const { engine, refreshes, models, modelRefreshes } = yield* setup(
        mock((request) => {
          switch (new URL(request.url).pathname) {
            case "/api/model":
              return Response.json({ location, data: [currentModel] });
            case "/api/model/default":
              return Response.json({ location, data: currentModel });
            case "/api/event":
              return new Response(
                new ReadableStream<Uint8Array>({
                  start: (controller) => {
                    events = controller;
                  },
                }),
                {
                  headers: { "content-type": "text/event-stream" },
                },
              );
            default:
              return respond(request);
          }
        }),
        persisted,
      );
      yield* TestClock.adjust("1 millis");
      assert.isDefined(events);
      const before = refreshes();
      const modelRefreshesBefore = modelRefreshes();
      currentModel = { ...model, id: Model.ID.make("new-model"), name: "New model" };
      events?.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ id: "evt_catalog", created: 0, type: "catalog.updated", data: {} })}\n\n`,
        ),
      );
      yield* TestClock.adjust("1 millis");
      assert.deepStrictEqual((yield* engine.client.state).connections[0]?.catalog, {
        providers: catalog.providers,
        models: [{ id: "new-model", name: "New model", providerID: provider.id }],
        defaultModel: "openai/new-model",
      });
      assert.strictEqual(refreshes(), before + 1);
      assert.strictEqual(modelRefreshes(), modelRefreshesBefore + 1);
      assert.deepStrictEqual(yield* models, [
        { id: "", display: "Automatic (Server Default / Session Model)" },
        { id: "openai/new-model", display: "New model (OpenAI / API)" },
      ]);
    }),
  );

  it.effect("lists sessions and creates sessions with trimmed optional model and location", () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = [];
      const { runtime } = yield* setup(
        mock((request) => {
          requests.push(request);
          return respond(request);
        }),
        persisted,
      );
      assert.deepStrictEqual(yield* runtime.OpenCodeSessions({ connection: "remote" }), [
        { id: session.id, title: session.title },
      ]);
      assert.deepStrictEqual(
        requests.find((request) => new URL(request.url).pathname === "/api/session")?.urlParams
          .params,
        [["limit", "100"]],
      );
      for (const input of [
        {
          connection: "remote",
          directory: " /workspace ",
          title: " New session ",
          model: " openai/gpt-test#fast ",
        },
        { connection: "remote", directory: " ", title: " ", model: " " },
      ]) {
        assert.strictEqual(yield* runtime.OpenCodeCreateSession(input), session.id);
        const request = requests.findLast((request) => request.method === "POST");
        assert.isDefined(request);
        if (request)
          assert.deepStrictEqual(
            body(request),
            input.title.trim()
              ? {
                  id: null,
                  agent: null,
                  metadata: null,
                  location: { directory: "/workspace" },
                  title: "New session",
                  model: { providerID: "openai", id: "gpt-test", variant: "fast" },
                }
              : { id: null, title: null, agent: null, model: null, location: null, metadata: null },
          );
      }
    }),
  );

  it.effect("switches the model before prompt admission and returns the inbox id", () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = [];
      const { runtime } = yield* setup(
        mock((request) => {
          requests.push(request);
          return respond(request);
        }),
        persisted,
      );
      assert.strictEqual(
        yield* runtime.OpenCodePromptSession({
          ...prompt,
          sessionID: ` ${session.id} `,
          model: " openai/gpt-test#fast ",
        }),
        admission.id,
      );
      const posts = requests.filter((request) => request.method === "POST");
      assert.deepStrictEqual(
        posts.map((request) => new URL(request.url).pathname),
        [`/api/session/${session.id}/model`, `/api/session/${session.id}/prompt`],
      );
      assert.deepStrictEqual(posts.map(body), [
        { model: { providerID: "openai", id: "gpt-test", variant: "fast" } },
        { id: null, text: prompt.text, delivery: null, resume: null },
      ]);
      requests.length = 0;
      assert.strictEqual(
        yield* runtime.OpenCodePromptSession({ ...prompt, model: " " }),
        admission.id,
      );
      assert.deepStrictEqual(requests.filter((request) => request.method === "POST").map(body), [
        { id: null, text: prompt.text, delivery: null, resume: null },
      ]);
      yield* runtime.OpenCodeWaitForSession({ connection: "remote", sessionID: ` ${session.id} ` });
      assert.isTrue(
        requests.some(
          (request) => new URL(request.url).pathname.endsWith("/wait") && request.method === "POST",
        ),
      );
    }),
  );

  it.effect("rejects malformed models and empty prompts before sending session requests", () =>
    Effect.gen(function* () {
      const requests: HttpClientRequest.HttpClientRequest[] = [];
      const { runtime } = yield* setup(
        mock((request) => {
          requests.push(request);
          return respond(request);
        }),
        persisted,
      );
      requests.length = 0;
      for (const input of [
        { ...prompt, sessionID: " " },
        { ...prompt, text: " " },
        ...["no-provider", "openai/", "/model", "openai/model#"].map((model) => ({
          ...prompt,
          model,
        })),
      ])
        assert.isTrue(Result.isFailure(yield* Effect.result(runtime.OpenCodePromptSession(input))));
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(
            runtime.OpenCodeCreateSession({
              connection: "remote",
              directory: "",
              title: "",
              model: "invalid",
            }),
          ),
        ),
      );
      assert.isTrue(
        Result.isFailure(
          yield* Effect.result(
            runtime.OpenCodeWaitForSession({ connection: "remote", sessionID: " " }),
          ),
        ),
      );
      assert.isFalse(
        requests.some((request) => new URL(request.url).pathname.startsWith("/api/session")),
      );
    }),
  );

  it.effect(
    "sanitizes rejection and malformed response bodies and never prompts after a failed model switch",
    () =>
      Effect.gen(function* () {
        for (const status of [200, 302, 401, 500]) {
          const requests: HttpClientRequest.HttpClientRequest[] = [];
          const { runtime, engine } = yield* setup(
            mock((request) => {
              requests.push(request);
              return new Response(JSON.stringify({ secret: password }), {
                status,
                headers: {
                  "content-type": "application/json",
                  location: "https://attacker.example",
                },
              });
            }),
            persisted,
          );
          const state = yield* engine.client.state;
          assert.strictEqual(state.connections[0]?.state, "error");
          assert.deepStrictEqual(state.connections[0]?.catalog, {
            providers: [],
            models: [],
            defaultModel: null,
          });
          assert.notInclude(JSON.stringify(state), password);
          const result = yield* Effect.result(
            runtime.OpenCodePromptSession({ ...prompt, model: "openai/gpt-test" }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) {
            assert.strictEqual(result.failure._tag, "OpenCodeRequestFailure");
            assert.strictEqual(
              result.failure.reason,
              "OpenCode request failed. Check the connection and server status.",
            );
            assert.notInclude(JSON.stringify(result.failure), password);
            assert.notInclude(JSON.stringify(result.failure), authorization);
            assert.notProperty(result.failure, "cause");
          }
          assert.isFalse(
            requests.some((request) => new URL(request.url).pathname.endsWith("/prompt")),
          );
        }
      }),
  );

  it.effect("sanitizes transport failures containing credentials", () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              description: `Failure: ${password} ${authorization}`,
            }),
          }),
        ),
      );
      const { runtime, engine } = yield* setup(http, persisted);
      const result = yield* Effect.result(runtime.OpenCodePromptSession(prompt));
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.notInclude(JSON.stringify(result.failure), password);
        assert.notInclude(JSON.stringify(result.failure), authorization);
        assert.notProperty(result.failure, "cause");
      }
      assert.notInclude(JSON.stringify(yield* engine.client.state), password);
    }),
  );

  it.effect("times out and aborts a stalled prompt response body", () =>
    Effect.gen(function* () {
      let aborted = false;
      const http = HttpClient.make((request, _url, signal) =>
        Effect.sync(() => {
          if (new URL(request.url).pathname.endsWith("/prompt")) {
            signal.addEventListener("abort", () => {
              aborted = true;
            });
            return HttpClientResponse.fromWeb(
              request,
              new Response(new ReadableStream(), {
                headers: { "content-type": "application/json" },
              }),
            );
          }
          return HttpClientResponse.fromWeb(request, respond(request));
        }),
      );
      const { runtime } = yield* setup(http, persisted);
      const fiber = yield* runtime
        .OpenCodePromptSession(prompt)
        .pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("15 seconds");
      const result = yield* Fiber.join(fiber);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result))
        assert.strictEqual(result.failure.reason, "OpenCode request timed out.");
      assert.isTrue(aborted);
    }),
  );

  it.effect("cancels an in-flight wait when its caller is interrupted", () =>
    Effect.gen(function* () {
      let aborted = false;
      const http = HttpClient.make((request, _url, signal) => {
        if (new URL(request.url).pathname.endsWith("/wait")) {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return Effect.never;
        }
        return Effect.sync(() => HttpClientResponse.fromWeb(request, respond(request)));
      });
      const { runtime } = yield* setup(http, persisted);
      const fiber = yield* runtime
        .OpenCodeWaitForSession({ connection: "remote", sessionID: session.id })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("1 millis");
      yield* Fiber.interrupt(fiber);
      assert.isTrue(aborted);
    }),
  );
});
