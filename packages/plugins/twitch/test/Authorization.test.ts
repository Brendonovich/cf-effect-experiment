import type { Credential } from "@macrograph/plugin/Engine";
import type { HttpClientRequest } from "effect/unstable/http";

import { assert, describe, expect, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Deferred, Effect, HashMap, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import type { Context, Make } from "../src/EventSubImplementation.ts";

import { AccountId, TwitchEngine } from "../src/Definition.ts";
import { make } from "../src/Engine.ts";
import { Helix } from "../src/Helix.ts";

const accountId = AccountId.make("account-1");
const validateUrl = "https://id.twitch.tv/oauth2/validate";
const chatUrl = "https://api.twitch.tv/helix/chat/messages";
const validToken = {
  user_id: accountId,
  client_id: Helix.DEFAULT_CLIENT_ID,
  login: "streamer",
  scopes: ["user:write:chat", "clips:edit"],
  expires_in: 3600,
};

type ValidationResponse = "transport" | { status?: number; body?: unknown; rawBody?: string };

const setup = Effect.fnUntraced(function* (
  responses: ReadonlyArray<ValidationResponse> = [{}],
  clientId?: string,
  options: { credentialAvailable?: boolean; transport?: "websocket" | "webhook" } = {},
) {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const timeline: Array<string> = [];
  const subscriber = yield* Deferred.make<() => Effect.Effect<void>>();
  const eventSubContext = yield* Deferred.make<Context>();
  let validationAttempts = 0;
  let credentialAvailable = options.credentialAvailable ?? true;
  const initialStorage: typeof TwitchEngine.Storage.Type = {
    accounts:
      options.transport === "webhook"
        ? { [accountId]: { enabled: false, subscriptions: ["channel.follow"] } }
        : {},
  };
  let storage = initialStorage;
  const writeStorage = vi.fn((value: typeof TwitchEngine.Storage.Type) => {
    storage = value;
    timeline.push("storage");
  });
  let credential: Credential = {
    id: accountId,
    provider: "twitch",
    ...(clientId === undefined ? {} : { clientId }),
    token: { access: Redacted.make("credential-secret") },
  };
  const refresh = vi.fn((_provider: string, _id: string) => {
    credential = { ...credential, token: { access: Redacted.make("refreshed-secret") } };
    return credential;
  });
  const httpClient = HttpClient.make((request) =>
    Effect.suspend(() => {
      requests.push(request);
      timeline.push(request.url);
      if (request.url === validateUrl) {
        assert.strictEqual(request.method, "GET");
        const response = responses[Math.min(validationAttempts++, responses.length - 1)]!;
        if (response === "transport")
          return Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request,
                description: "CORS/network failure credential-secret",
              }),
            }),
          );
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(
              response.rawBody ??
                JSON.stringify(
                  response.body ?? {
                    ...validToken,
                    client_id: clientId ?? Helix.DEFAULT_CLIENT_ID,
                  },
                ),
              {
                status: response.status ?? 200,
                headers: { "content-type": "application/json" },
              },
            ),
          ),
        );
      }
      assert.include([chatUrl, "https://api.twitch.tv/helix/clips"], request.url);
      assert.strictEqual(request.method, "POST");
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            JSON.stringify({
              data:
                request.url === chatUrl
                  ? [{ message_id: "message-1", is_sent: true }]
                  : [{ id: "clip-1", edit_url: "https://clips.example/edit" }],
            }),
            {
              status: request.url === chatUrl ? 200 : 202,
              headers: { "content-type": "application/json" },
            },
          ),
        ),
      );
    }),
  );
  const connect = vi.fn((_id: AccountId) => timeline.push("connect"));
  const fakeMakeEventSub: Make = (context) =>
    Deferred.succeed(eventSubContext, context).pipe(
      Effect.as({
        transport: options.transport ?? "websocket",
        state: Effect.succeed(HashMap.empty()),
        connect: (id) =>
          Effect.sync(() => {
            connect(id);
          }),
        disconnect: () => Effect.void,
      }),
    );
  const dependencies = Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient)(httpClient),
    Layer.succeed(TwitchEngine.EngineContext)({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) => Effect.sync(() => writeStorage(value)),
        update: (f) => Effect.sync(() => writeStorage(f(storage))),
      },
      resource: { refresh: () => Effect.void },
      client: { refresh: Effect.void },
      emit: () => Effect.void,
      credentials: {
        get: Effect.sync(() => (credentialAvailable ? [credential] : [])),
        refresh: (provider, id) =>
          Effect.sync(() => refresh(provider, id)).pipe(
            Effect.tap(() => Effect.flatMap(Deferred.await(subscriber), (callback) => callback())),
          ),
        subscribe: (callback) => Deferred.succeed(subscriber, callback).pipe(Effect.asVoid),
      },
    }),
  );
  const { client, runtime } = yield* EngineTest.makeClients(TwitchEngine).pipe(
    Effect.provide(make(fakeMakeEventSub).pipe(Layer.provide(dependencies))),
  );
  return {
    requests,
    timeline,
    refresh,
    connect,
    writeStorage,
    initialStorage,
    storage: () => storage,
    provideCredential: Effect.sync(() => {
      credentialAvailable = true;
    }),
    getHelix: Effect.flatMap(Deferred.await(eventSubContext), (context) =>
      context.getHelix(accountId),
    ),
    validations: () => requests.filter((request) => request.url === validateUrl),
    actions: () => requests.filter((request) => request.url !== validateUrl),
    notify: Effect.flatMap(Deferred.await(subscriber), (callback) => callback()),
    connectEventSub: client.ConnectEventSub({ accountId }),
    sendChat: runtime
      .SendChatMessage({
        account_id: accountId,
        broadcaster_id: "broadcaster-1",
        sender_id: accountId,
        message: "hello",
      })
      .pipe(Effect.asVoid),
    createClip: runtime
      .CreateClip({ account_id: accountId, broadcaster_id: "broadcaster-1" })
      .pipe(Effect.asVoid),
  };
});

const cacheCases: ReadonlyArray<{
  name: string;
  response: ValidationResponse;
  clientId?: string;
}> = [
  { name: "successful validation with the default client", response: {} },
  { name: "successful validation with a custom client", response: {}, clientId: "custom-client" },
  { name: "unavailable validation after a transport failure", response: "transport" },
  { name: "unavailable validation after HTTP 503", response: { status: 503 } },
];

describe("Twitch best-effort token validation", () => {
  for (const transport of ["websocket", "webhook"] as const) {
    it.effect(
      `does not enable or provision ${transport} without credentials and retries immediately`,
      () =>
        Effect.gen(function* () {
          const test = yield* setup([{}], undefined, { transport, credentialAvailable: false });
          for (const action of [test.connectEventSub, test.sendChat]) {
            const error = yield* Effect.flip(action);
            assert.strictEqual(error._tag, "MissingCredential");
          }
          assert.deepStrictEqual(test.storage(), test.initialStorage);
          expect(test.writeStorage).not.toHaveBeenCalled();
          expect(test.connect).not.toHaveBeenCalled();
          assert.isEmpty(test.requests);

          yield* test.provideCredential;
          yield* test.connectEventSub;
          yield* test.sendChat;
          assert.strictEqual(test.storage().accounts[accountId]?.enabled, true);
          expect(test.writeStorage).toHaveBeenCalledTimes(1);
          expect(test.connect).toHaveBeenCalledExactlyOnceWith(accountId);
          assert.deepStrictEqual(test.timeline, [validateUrl, "storage", "connect", chatUrl]);
        }),
    );
  }

  it.effect(
    "retries a missing Helix credential without waiting for a notification or cache expiry",
    () =>
      Effect.gen(function* () {
        const test = yield* setup([{}], undefined, { credentialAvailable: false });
        const error = yield* Effect.flip(test.getHelix);
        assert.strictEqual(error._tag, "MissingCredential");
        yield* test.provideCredential;
        yield* test.getHelix;
        yield* test.sendChat;
        assert.lengthOf(test.actions(), 1);
      }),
  );

  it.effect("sends only CORS-safe headers at the transport boundary", () =>
    Effect.gen(function* () {
      const test = yield* setup();
      yield* test.sendChat;
      assert.deepStrictEqual(Object.keys(test.validations()[0]!.headers), ["authorization"]);
      assert.deepStrictEqual(Object.keys(test.actions()[0]!.headers).sort(), [
        "authorization",
        "client-id",
        "content-type",
      ]);
    }),
  );

  for (const { name, response, clientId } of cacheCases) {
    it.effect(`caches ${name} for five minutes`, () =>
      Effect.gen(function* () {
        const test = yield* setup([response], clientId);
        yield* test.sendChat;
        yield* test.sendChat;
        yield* TestClock.adjust("299 seconds");
        yield* test.sendChat;
        assert.lengthOf(test.validations(), 1);
        yield* TestClock.adjust("2 seconds");
        yield* test.sendChat;
        assert.lengthOf(test.validations(), 2);
        assert.lengthOf(test.actions(), 4);
        assert.deepStrictEqual(test.timeline.slice(0, 2), [validateUrl, chatUrl]);
        for (const request of test.actions()) {
          assert.strictEqual(request.headers.authorization, "Bearer credential-secret");
          assert.strictEqual(request.headers["client-id"], clientId ?? Helix.DEFAULT_CLIENT_ID);
        }
        expect(test.refresh).not.toHaveBeenCalled();
      }),
    );

    it.effect(`allows EventSub after ${name} and shares the cached result with actions`, () =>
      Effect.gen(function* () {
        const test = yield* setup([response], clientId);
        yield* test.connectEventSub;
        yield* test.sendChat;
        assert.deepStrictEqual(test.timeline, [validateUrl, "storage", "connect", chatUrl]);
        expect(test.connect).toHaveBeenCalledExactlyOnceWith(accountId);
        expect(test.refresh).not.toHaveBeenCalled();
      }),
    );

    it.effect(`invalidates ${name} on credential notifications`, () =>
      Effect.gen(function* () {
        const test = yield* setup([response], clientId);
        yield* test.sendChat;
        test.refresh("twitch", accountId);
        yield* test.notify;
        yield* test.sendChat;
        assert.lengthOf(test.validations(), 2);
        assert.include(test.validations()[1]!.headers.authorization!, "refreshed-secret");
        assert.strictEqual(test.actions()[1]!.headers.authorization, "Bearer refreshed-secret");
      }),
    );
  }

  for (const [name, body] of [
    ["account identity", { ...validToken, user_id: "different-account" }],
    ["client identity", { ...validToken, client_id: "different-client" }],
  ] as const) {
    it.effect(`blocks actions and EventSub on a mismatched ${name}`, () =>
      Effect.gen(function* () {
        const test = yield* setup([{ body }]);
        for (const action of [test.sendChat, test.connectEventSub]) {
          const error = yield* Effect.flip(action);
          assert.strictEqual(error._tag, "TwitchCredentialAuthorizationError");
        }
        assert.isEmpty(test.actions());
        expect(test.writeStorage).not.toHaveBeenCalled();
        expect(test.connect).not.toHaveBeenCalled();
        expect(test.refresh).not.toHaveBeenCalled();
      }),
    );
  }

  for (const requiredScope of ["user:write:chat", "clips:edit"]) {
    it.effect(`enforces ${requiredScope} even when validation is cached`, () =>
      Effect.gen(function* () {
        const test = yield* setup([
          {
            body: {
              ...validToken,
              scopes: validToken.scopes.filter((scope) => scope !== requiredScope),
            },
          },
        ]);
        yield* requiredScope === "user:write:chat" ? test.createClip : test.sendChat;
        const error = yield* Effect.flip(
          requiredScope === "user:write:chat" ? test.sendChat : test.createClip,
        );
        assert.strictEqual(error._tag, "TwitchCredentialAuthorizationError");
        if (error._tag === "TwitchCredentialAuthorizationError") {
          assert.strictEqual(error.accountId, accountId);
          assert.deepStrictEqual(error.requiredScopes, [requiredScope]);
        }
        assert.lengthOf(test.validations(), 1);
        assert.lengthOf(test.actions(), 1);
      }),
    );
  }

  for (const { name, response } of cacheCases.filter((test) => test.clientId === undefined)) {
    it.effect(`refreshes once after HTTP 401 and permits ${name} on retry`, () =>
      Effect.gen(function* () {
        const test = yield* setup([{ status: 401 }, response]);
        yield* test.sendChat;
        yield* test.sendChat;
        expect(test.refresh).toHaveBeenCalledExactlyOnceWith("twitch", accountId);
        assert.lengthOf(test.validations(), 2);
        assert.include(test.validations()[0]!.headers.authorization!, "credential-secret");
        assert.include(test.validations()[1]!.headers.authorization!, "refreshed-secret");
        assert.deepStrictEqual(test.timeline, [validateUrl, validateUrl, chatUrl, chatUrl]);
        for (const request of test.actions())
          assert.strictEqual(request.headers.authorization, "Bearer refreshed-secret");
      }),
    );
  }

  const blockedCases: ReadonlyArray<{ name: string; response: ValidationResponse }> = [
    ...[400, 401, 403, 429].map((status) => ({
      name: status === 401 ? "repeated HTTP 401" : `HTTP ${status}`,
      response: { status, body: { message: "response-secret" } },
    })),
    { name: "malformed JSON", response: { rawBody: "response-secret invalid JSON" } },
    { name: "malformed schema", response: { body: { ...validToken, scopes: "response-secret" } } },
  ];
  for (const { name, response } of blockedCases) {
    for (const target of ["action", "EventSub"]) {
      it.effect(`blocks ${target} with a sanitized HelixError after ${name}`, () =>
        Effect.gen(function* () {
          const test = yield* setup([response]);
          const error = yield* Effect.flip(
            target === "action" ? test.sendChat : test.connectEventSub,
          );
          assert.strictEqual(error._tag, "HelixError");
          if (error._tag === "HelixError") {
            for (const secret of ["credential-secret", "refreshed-secret", "response-secret"])
              assert.notInclude(error.reason, secret);
            if (response !== "transport" && response.status !== undefined)
              assert.strictEqual(error.status, response.status);
          }
          const repeated401 = response !== "transport" && response.status === 401;
          assert.lengthOf(test.validations(), repeated401 ? 2 : 1);
          expect(test.refresh).toHaveBeenCalledTimes(repeated401 ? 1 : 0);
          assert.isEmpty(test.actions());
          expect(test.writeStorage).not.toHaveBeenCalled();
          expect(test.connect).not.toHaveBeenCalled();
        }),
      );
    }
  }
});
