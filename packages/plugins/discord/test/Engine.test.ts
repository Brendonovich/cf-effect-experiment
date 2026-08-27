import { assert, describe, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Effect, Layer, Result } from "effect";

import { Http, API_ORIGIN, checkStatus, httpLayer } from "../src/Api.ts";
import { DiscordEngine, DiscordFailure, type MessageReceived } from "../src/Definition.ts";
import { layer } from "../src/Engine.ts";
import { Gateway, makeGateway, type GatewayOptions, type GatewaySocket } from "../src/Gateway.ts";

function harness(
  initial: typeof DiscordEngine.Storage.Type = {
    token: "",
    gatewayEnabled: false,
    messageContent: false,
  },
  gateway?: ReturnType<typeof makeGateway>,
) {
  let storage = initial;
  let storageDefect: unknown;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const sessions: GatewayOptions[] = [];
  const emitted: MessageReceived[] = [];
  const closed = vi.fn();
  let response = () => Response.json({ id: "42" });
  const context = Layer.succeed(
    DiscordEngine.EngineContext,
    DiscordEngine.EngineContext.of({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) =>
          Effect.sync(() => {
            if (storageDefect !== undefined) throw storageDefect;
            storage = value;
          }),
        update: (f) =>
          Effect.sync(() => {
            storage = f(storage);
          }),
      },
      resource: { refresh: () => Effect.void },
      credentials: {
        get: Effect.succeed([]),
        refresh: () => Effect.die("Unused credentials"),
        subscribe: () => Effect.void,
      },
      client: { refresh: Effect.void },
      emit: (event) =>
        Effect.sync(() => {
          emitted.push(event);
        }),
    }),
  );
  const services = Layer.mergeAll(
    Layer.succeed(Http, {
      request: (url, init) =>
        Effect.sync(() => {
          requests.push({ url, init });
          return response();
        }),
    }),
    Layer.succeed(
      Gateway,
      gateway ?? {
        start: (options) => {
          sessions.push(options);
          options.onStatus("connecting");
          return closed;
        },
      },
    ),
    context,
  );
  return {
    make: Layer.build(layer.pipe(Layer.provide(services))).pipe(
      Effect.flatMap((context) =>
        EngineTest.makeClients(DiscordEngine).pipe(Effect.provideContext(context)),
      ),
    ),
    storage: () => storage,
    requests,
    sessions,
    emitted,
    closed,
    failStorage: (defect: unknown) => {
      storageDefect = defect;
    },
    respond: (f: () => Response) => {
      response = f;
    },
  };
}

describe("Discord engine", () => {
  it.effect("preserves IDENTIFY cooldown across token replacements and intent changes", () =>
    Effect.gen(function* () {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          random.mockRestore();
          vi.useRealTimers();
        }),
      );
      const sockets: GatewaySocket[] = [];
      const frames: Array<{ at: number; data: string }> = [];
      const gateway = makeGateway(() => {
        const socket: GatewaySocket = {
          onmessage: null,
          onclose: null,
          onerror: null,
          send: (data) => {
            frames.push({ at: performance.now(), data });
          },
          close: () => {},
        };
        sockets.push(socket);
        return socket;
      });
      const h = harness(undefined, gateway);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { client } = yield* h.make;
          const hello = () =>
            sockets
              .at(-1)!
              .onmessage?.({ data: JSON.stringify({ op: 10, d: { heartbeat_interval: 100000 } }) });
          yield* client.DiscordConfigure({
            token: "first-token",
            gatewayEnabled: true,
            messageContent: false,
          });
          hello();
          assert.strictEqual(frames.length, 1);
          yield* client.DiscordConfigure({
            token: "second-token",
            gatewayEnabled: true,
            messageContent: false,
          });
          hello();
          vi.advanceTimersByTime(1000);
          assert.strictEqual(frames.length, 1);
          // Cancel a pending identify: it must not consume or reset the shared deadline.
          yield* client.DiscordSetGateway({ enabled: true, messageContent: true });
          hello();
          vi.advanceTimersByTime(3999);
          assert.strictEqual(frames.length, 1);
          vi.advanceTimersByTime(1);
          assert.strictEqual(frames.length, 2);
          assert.strictEqual(frames[1]!.at - frames[0]!.at, 5000);
          assert.strictEqual(JSON.parse(frames[1]!.data).d.token, "second-token");
          assert.strictEqual(JSON.parse(frames[1]!.data).d.intents & (1 << 15), 1 << 15);
          yield* client.DiscordSetGateway({ enabled: true, messageContent: false });
          hello();
          vi.advanceTimersByTime(4999);
          assert.strictEqual(frames.length, 2);
          vi.advanceTimersByTime(1);
          assert.strictEqual(frames.length, 3);
          assert.strictEqual(frames[2]!.at - frames[1]!.at, 5000);
          yield* client.DiscordConfigure({
            token: "cancelled-token",
            gatewayEnabled: true,
            messageContent: false,
          });
          hello();
        }),
      );
      assert.strictEqual(vi.getTimerCount(), 0);
      vi.advanceTimersByTime(5000);
      assert.strictEqual(frames.length, 3);
    }),
  );

  it.effect("sanitizes secret-bearing storage defects for configure, gateway and clear RPCs", () =>
    Effect.gen(function* () {
      const initial = { token: "stored-secret-token", gatewayEnabled: true, messageContent: false };
      const h = harness(initial);
      const { engine, client } = yield* h.make;
      const state = yield* engine.client.state;
      h.failStorage(new Error("SQLite query params: stored-secret-token replacement-secret-token"));
      for (const operation of [
        client.DiscordConfigure({
          token: "replacement-secret-token",
          gatewayEnabled: true,
          messageContent: false,
        }),
        client.DiscordSetGateway({ enabled: false, messageContent: false }),
        client.DiscordClear(),
      ]) {
        const result = yield* Effect.result(operation);
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.instanceOf(result.failure, DiscordFailure);
          assert.strictEqual(result.failure.reason, "storage-failed");
          assert.isFalse(JSON.stringify(result.failure).includes("secret-token"));
          assert.isFalse(String(result.failure).includes("secret-token"));
        }
      }
      assert.deepStrictEqual(h.storage(), initial);
      assert.deepStrictEqual(yield* engine.client.state, state);
      assert.strictEqual(h.sessions.length, 1);
      assert.strictEqual(h.closed.mock.calls.length, 0);
    }),
  );

  it.effect("keeps tokens private and cleans up replacement, disconnect and shutdown", () =>
    Effect.gen(function* () {
      const h = harness();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { engine, client } = yield* h.make;
          yield* client.DiscordConfigure({
            token: "private-token",
            gatewayEnabled: true,
            messageContent: true,
          });
          assert.strictEqual(h.storage().token, "private-token");
          assert.deepStrictEqual(yield* engine.client.state, {
            configured: true,
            gatewayEnabled: true,
            messageContent: true,
            status: "connecting",
          });
          h.sessions[0]!.onStatus("connected");
          assert.strictEqual((yield* engine.client.state).status, "connected");
          yield* client.DiscordConfigure({
            token: "replacement-token",
            gatewayEnabled: true,
            messageContent: false,
          });
          assert.strictEqual(h.closed.mock.calls.length, 1);
          h.sessions[0]!.onStatus("error", "authentication-failed");
          assert.strictEqual((yield* engine.client.state).status, "connecting");
          assert.isFalse(JSON.stringify(yield* engine.client.state).includes("token"));
          yield* client.DiscordSetGateway({ enabled: false, messageContent: false });
          assert.strictEqual(h.closed.mock.calls.length, 2);
          assert.strictEqual(h.storage().gatewayEnabled, false);
          yield* client.DiscordClear();
          assert.strictEqual(h.storage().token, "");
          yield* client.DiscordConfigure({
            token: "shutdown-token",
            gatewayEnabled: true,
            messageContent: false,
          });
        }),
      );
      assert.strictEqual(h.closed.mock.calls.length, 3);
    }),
  );

  it.effect("restores stored gateway intent without exposing the token", () =>
    Effect.gen(function* () {
      const h = harness({ token: "stored-token", gatewayEnabled: true, messageContent: false });
      const { engine } = yield* h.make;
      assert.strictEqual(h.sessions.length, 1);
      assert.strictEqual(h.sessions[0]!.token, "stored-token");
      assert.isFalse("token" in (yield* engine.client.state));
    }),
  );

  it.effect("uses Bot auth for user and guild routes and returns correct banner data", () =>
    Effect.gen(function* () {
      const h = harness({ token: "private-token", gatewayEnabled: false, messageContent: false });
      const { runtime } = yield* h.make;
      h.respond(() =>
        Response.json({
          id: "1",
          username: "test",
          global_name: "Test",
          avatar: "avatar",
          banner: "banner",
        }),
      );
      const user = yield* runtime.DiscordGetUser({ userId: "1" });
      assert.strictEqual(user.bannerId, "banner");
      h.respond(() =>
        Response.json({
          user: { id: "1", username: "test", global_name: "Test", banner: "banner" },
          nick: null,
          roles: ["2"],
        }),
      );
      const member = yield* runtime.DiscordGetGuildMember({ guildId: "3", userId: "1" });
      assert.strictEqual(member.displayName, "Test");
      assert.strictEqual(member.nick, "");
      assert.strictEqual(member.rolesJson, '["2"]');
      h.respond(() =>
        Response.json([
          { id: "2", name: "Admin", position: 1, mentionable: true, permissions: "8", color: 123 },
        ]),
      );
      const role = yield* runtime.DiscordGetRole({ guildId: "3", roleId: "2" });
      assert.strictEqual(role.permissions, "8");
      assert.strictEqual(JSON.parse(role.payloadJson).color, 123);
      assert.deepStrictEqual(
        h.requests.map((request) => request.url),
        [
          `${API_ORIGIN}/users/1`,
          `${API_ORIGIN}/guilds/3/members/1`,
          `${API_ORIGIN}/guilds/3/roles`,
        ],
      );
      for (const request of h.requests) {
        assert.strictEqual(
          new Headers(request.init.headers).get("Authorization"),
          "Bot private-token",
        );
        assert.strictEqual(request.init.redirect, "error");
      }
    }),
  );

  it.effect("sends messages with explicit mention policy and webhooks without Bot auth", () =>
    Effect.gen(function* () {
      const h = harness({ token: "private-token", gatewayEnabled: false, messageContent: false });
      const { runtime } = yield* h.make;
      const sent = yield* runtime.DiscordSendMessage({
        channelId: "1",
        message: "hello",
        everyone: false,
      });
      assert.strictEqual(sent.messageId, "42");
      assert.deepStrictEqual(JSON.parse(String(h.requests[0]!.init.body)), {
        content: "hello",
        allowed_mentions: { parse: [] },
      });
      yield* runtime.DiscordSendMessage({ channelId: "1", message: "@everyone", everyone: true });
      assert.deepStrictEqual(JSON.parse(String(h.requests[1]!.init.body)), {
        content: "@everyone",
        allowed_mentions: { parse: ["everyone"] },
      });
      h.respond(() => new Response(null, { status: 204 }));
      const status = yield* runtime.DiscordSendWebhook({
        webhookUrl: "https://discordapp.com/api/webhooks/1/private-webhook",
        content: "hello",
        username: "Test",
        avatarUrl: "",
        tts: false,
      });
      assert.strictEqual(status, 204);
      assert.strictEqual(h.requests[2]!.url, `${API_ORIGIN}/webhooks/1/private-webhook`);
      assert.isNull(new Headers(h.requests[2]!.init.headers).get("Authorization"));
      assert.strictEqual(h.requests[2]!.init.redirect, "error");
    }),
  );

  it.effect(
    "rejects invalid IDs, tokens, message sizes and arbitrary webhook destinations before HTTP",
    () =>
      Effect.gen(function* () {
        const h = harness();
        const { client, runtime } = yield* h.make;
        const token = yield* Effect.result(
          client.DiscordConfigure({
            token: "secret\r\nHeader: leaked",
            gatewayEnabled: false,
            messageContent: false,
          }),
        );
        assert.isTrue(Result.isFailure(token));
        assert.strictEqual(h.storage().token, "");
        const id = yield* Effect.result(runtime.DiscordGetUser({ userId: "1/../../guilds/3" }));
        assert.isTrue(Result.isFailure(id));
        const message = yield* Effect.result(
          runtime.DiscordSendMessage({
            channelId: "1",
            message: "x".repeat(2001),
            everyone: false,
          }),
        );
        assert.isTrue(Result.isFailure(message));
        for (const url of [
          "https://evil.example/api/webhooks/1/secret",
          "https://discord.com.evil.example/api/webhooks/1/secret",
          "http://discord.com/api/webhooks/1/secret",
          "https://user:secret@discord.com/api/webhooks/1/secret",
          "https://discord.com:444/api/webhooks/1/secret",
          "https://discord.com/api/v10/users/@me",
          "https://discord.com/api/webhooks/1/secret?wait=true",
          "https://discord.com/api/webhooks/1/secret#fragment",
          "https://discord.com/api/webhooks/1/secret%2Fother",
          "https://discord.com/api/webhooks/1/secret/extra",
        ]) {
          const result = yield* Effect.result(
            runtime.DiscordSendWebhook({
              webhookUrl: url,
              content: "hello",
              username: "",
              avatarUrl: "",
              tts: false,
            }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) {
            assert.strictEqual(result.failure.reason, "invalid-webhook");
            assert.isFalse(JSON.stringify(result.failure).includes("secret"));
          }
        }
        assert.strictEqual(h.requests.length, 0);
      }),
  );

  it.effect(
    "provides typed missing configuration, response decoding, and role-not-found errors",
    () =>
      Effect.gen(function* () {
        const h = harness();
        const { client, runtime } = yield* h.make;
        const missing = yield* Effect.result(runtime.DiscordGetUser({ userId: "1" }));
        assert.isTrue(Result.isFailure(missing));
        if (Result.isFailure(missing)) assert.strictEqual(missing.failure.reason, "not-configured");
        yield* client.DiscordConfigure({
          token: "private-token",
          gatewayEnabled: false,
          messageContent: false,
        });
        h.respond(() => Response.json({ privateErrorBody: "do-not-echo" }));
        const invalid = yield* Effect.result(runtime.DiscordGetUser({ userId: "1" }));
        assert.isTrue(Result.isFailure(invalid));
        if (Result.isFailure(invalid)) {
          assert.strictEqual(invalid.failure.reason, "invalid-response");
          assert.isFalse(JSON.stringify(invalid.failure).includes("do-not-echo"));
        }
        h.respond(() => Response.json([]));
        const role = yield* Effect.result(runtime.DiscordGetRole({ guildId: "1", roleId: "2" }));
        assert.isTrue(Result.isFailure(role));
        if (Result.isFailure(role)) assert.strictEqual(role.failure.reason, "not-found");
      }),
  );

  it.effect("sanitizes HTTP status failures without decoding response bodies", () =>
    Effect.gen(function* () {
      const cases = [
        [401, "unauthorized"],
        [403, "forbidden"],
        [404, "not-found"],
        [429, "rate-limited"],
        [500, "http"],
        [302, "http"],
      ] as const;
      for (const [status, reason] of cases) {
        const result = yield* Effect.result(
          checkStatus(new Response("secret-error-body", { status })),
        );
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.instanceOf(result.failure, DiscordFailure);
          assert.strictEqual(result.failure.reason, reason);
          assert.isFalse(JSON.stringify(result.failure).includes("secret-error-body"));
        }
      }
    }),
  );

  it.effect("sanitizes fetch exceptions", () =>
    Effect.gen(function* () {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("secret-token-at-url"));
      yield* Effect.addFinalizer(() => Effect.sync(() => fetchMock.mockRestore()));
      const http = yield* Http.pipe(Effect.provide(httpLayer));
      const result = yield* Effect.result(
        http.request(`${API_ORIGIN}/users/1`, { redirect: "error" }),
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.strictEqual(result.failure.reason, "network");
        assert.isFalse(JSON.stringify(result.failure).includes("secret-token"));
      }
    }),
  );
});
