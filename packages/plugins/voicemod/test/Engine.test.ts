import { assert, describe, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { Socket } from "effect/unstable/socket";

import { VoicemodEngine, initialStorage } from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";
import * as Protocol from "../src/Protocol.ts";

type Packet = { id: string; action: string; payload: Record<string, unknown> };
class MockWebSocket extends EventTarget {
  readonly readyState = 1;
  readonly sent: Packet[] = [];
  closed = false;
  ignore = false;
  changer = false;
  hear = true;
  currentVoice = "nofx";
  invalidState = false;
  registrationCode = 200;
  constructor(readonly url: string) {
    super();
  }
  close() {
    this.closed = true;
  }
  send(data: string) {
    const packet = JSON.parse(data) as Packet;
    this.sent.push(packet);
    if (this.ignore) return;
    if (packet.action === "toggleVoiceChanger") {
      this.changer = !this.changer;
      const actionType = this.changer ? "voiceChangerEnabledEvent" : "voiceChangerDisabledEvent";
      queueMicrotask(() => this.message({ actionType, actionID: null }));
      return;
    }
    if (packet.action === "toggleHearMyVoice") {
      this.hear = !this.hear;
      const value = this.hear;
      queueMicrotask(() =>
        this.message({ actionType: "toggleHearMyVoice", actionID: null, actionObject: { value } }),
      );
      return;
    }
    if (packet.action === "loadVoice") {
      this.currentVoice = String(packet.payload.voiceID);
      return;
    }
    const response =
      packet.action === "registerClient"
        ? {
            action: "registerClient",
            id: packet.id,
            payload: { status: { code: this.registrationCode, description: "server-key" } },
          }
        : packet.action === "getVoiceChangerStatus"
          ? {
              actionType: "toggleVoiceChanger",
              actionID: null,
              actionObject: { value: this.invalidState ? "false" : this.changer },
            }
          : packet.action === "getHearMyselfStatus"
            ? {
                actionType: "toggleHearMyVoice",
                actionId: packet.id,
                payload: { value: this.hear },
              }
            : packet.action === "getVoices"
              ? {
                  actionType: "getVoices",
                  actionObject: {
                    voices: [
                      { id: "baby", friendlyName: "Baby", enabled: true },
                      { id: "disabled", friendlyName: "Disabled", enabled: false },
                    ],
                  },
                }
              : { actionType: "getCurrentVoice", actionObject: { voiceID: this.currentVoice } };
    queueMicrotask(() => this.message(response));
  }
  message(packet: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(packet) }));
  }
}
const setup = (
  initial: typeof VoicemodEngine.Storage.Type = { ...initialStorage, clientKey: "server-key" },
  registrationCode = 200,
  ignore = false,
) => {
  let storage = initial;
  const sockets: MockWebSocket[] = [];
  const dependencies = Layer.mergeAll(
    Layer.succeed(Socket.WebSocketConstructor)((url) => {
      const socket = new MockWebSocket(url);
      socket.registrationCode = registrationCode;
      socket.ignore = ignore;
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }),
    Layer.succeed(VoicemodEngine.EngineContext)({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) =>
          Effect.sync(() => {
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
        refresh: () => Effect.die("unused"),
        subscribe: () => Effect.void,
      },
      client: { refresh: Effect.void },
      emit: () => Effect.void,
    }),
  );
  return {
    sockets,
    storage: () => storage,
    layer: deployment.layer.pipe(Layer.provide(dependencies)),
  };
};
describe("Voicemod engine", () => {
  it.effect(
    "consumes ID-less hear-self toggle notifications before consecutive verification queries",
    () =>
      Effect.gen(function* () {
        const test = setup();
        yield* Effect.gen(function* () {
          const { client, runtime } = yield* EngineTest.makeClients(VoicemodEngine);
          yield* client.VoicemodConnect();
          const socket = test.sockets[0];
          assert.isDefined(socket);
          socket.ignore = true;
          socket.sent.length = 0;
          let current = true;
          const reply = (value: boolean) =>
            socket.message({
              actionType: "toggleHearMyVoice",
              actionID: null,
              actionObject: { value },
            });
          for (const desired of [false, true, false, false]) {
            const start = socket.sent.length;
            const finished = yield* Deferred.make<void>();
            const setter = yield* runtime.SetHearSelfState({ state: desired }).pipe(
              Effect.tap(() => Deferred.succeed(finished, undefined)),
              Effect.forkChild,
            );
            while (socket.sent.length < start + 1) yield* Effect.yieldNow;
            assert.strictEqual(socket.sent[start]?.action, "getHearMyselfStatus");
            reply(current);
            if (current !== desired) {
              while (socket.sent.length < start + 2) yield* Effect.yieldNow;
              yield* Effect.yieldNow;
              assert.strictEqual(socket.sent[start + 1]?.action, "toggleHearMyVoice");
              assert.strictEqual(
                socket.sent.length,
                start + 2,
                "verification must wait for the command notification",
              );
              current = desired;
              reply(current);
              while (socket.sent.length < start + 3) yield* Effect.yieldNow;
              assert.strictEqual(socket.sent[start + 2]?.action, "getHearMyselfStatus");
              assert.isFalse(yield* Deferred.isDone(finished));
              reply(current);
            }
            yield* Fiber.join(setter);
            assert.strictEqual(
              socket.sent.length,
              start + (socket.sent[start + 1]?.action === "toggleHearMyVoice" ? 3 : 1),
            );
          }
          assert.strictEqual(current, false);
        }).pipe(Effect.provide(test.layer));
      }),
  );

  it.effect("an older disconnect cannot overwrite a new connection after delayed cleanup", () =>
    Effect.gen(function* () {
      const test = setup();
      const closing = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const original = Protocol.make;
      let first = true;
      const spy = vi.spyOn(Protocol, "make").mockImplementation((url) =>
        original(url).pipe(
          Effect.tap(() => {
            if (!first) return Effect.void;
            first = false;
            return Effect.addFinalizer(() =>
              Deferred.succeed(closing, undefined).pipe(Effect.andThen(Deferred.await(release))),
            );
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const { client, runtime, engine } = yield* EngineTest.makeClients(VoicemodEngine);
        yield* client.VoicemodConnect();
        const disconnecting = yield* client.VoicemodDisconnect().pipe(Effect.forkChild);
        yield* Deferred.await(closing);
        yield* client.VoicemodConnect();
        assert.strictEqual((yield* engine.client.state).state, "connected");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(disconnecting);
        assert.strictEqual((yield* engine.client.state).state, "connected");
        assert.isTrue(test.sockets[0]?.closed);
        assert.isFalse(test.sockets[1]?.closed);
        yield* runtime.SetHearSelfState({ state: false });
      }).pipe(
        Effect.ensuring(Deferred.succeed(release, undefined)),
        Effect.provide(test.layer),
        Effect.ensuring(Effect.sync(() => spy.mockRestore())),
      );
    }),
  );

  it.effect("disconnect cancels a pending registration and releases its socket", () =>
    Effect.gen(function* () {
      const test = setup({ ...initialStorage, clientKey: "server-key" }, 200, true);
      yield* Effect.gen(function* () {
        const { client, engine } = yield* EngineTest.makeClients(VoicemodEngine);
        const connecting = yield* client.VoicemodConnect().pipe(Effect.forkChild);
        while (!test.sockets[0]?.sent.length) yield* Effect.yieldNow;
        assert.strictEqual((yield* engine.client.state).state, "connecting");
        yield* client.VoicemodDisconnect();
        assert.strictEqual(
          (yield* Effect.flip(Fiber.join(connecting)))._tag,
          "VoicemodConnectionFailed",
        );
        assert.isTrue(test.sockets[0]?.closed);
        assert.strictEqual((yield* engine.client.state).state, "disconnected");
      }).pipe(Effect.provide(test.layer));
    }),
  );
  it.effect("registers with the configured key and queries live state before every toggle", () =>
    Effect.gen(function* () {
      const test = setup();
      yield* Effect.gen(function* () {
        const { client, runtime, engine } = yield* EngineTest.makeClients(VoicemodEngine);
        assert.strictEqual(
          (yield* Effect.flip(runtime.SetVoice({ voice: "Baby" })))._tag,
          "VoicemodConnectionFailed",
        );
        yield* client.VoicemodConnect();
        const socket = test.sockets[0];
        assert.isDefined(socket);
        assert.deepStrictEqual(socket.sent[0]?.payload, { clientKey: "server-key" });
        assert.notInclude(JSON.stringify(yield* engine.client.state), "server-key");
        yield* runtime.SetVoiceChangerState({ state: true });
        assert.deepStrictEqual(
          socket.sent.slice(1).map((packet) => packet.action),
          ["getVoiceChangerStatus", "toggleVoiceChanger", "getVoiceChangerStatus"],
        );
        socket.sent.length = 0;
        yield* runtime.SetVoiceChangerState({ state: true });
        assert.deepStrictEqual(
          socket.sent.map((packet) => packet.action),
          ["getVoiceChangerStatus"],
        );
        // An external application interaction invalidates any previous state knowledge.
        socket.changer = false;
        socket.sent.length = 0;
        yield* Effect.all(
          [
            runtime.SetVoiceChangerState({ state: true }),
            runtime.SetVoiceChangerState({ state: true }),
          ],
          { concurrency: "unbounded" },
        );
        assert.deepStrictEqual(
          socket.sent.map((packet) => packet.action),
          [
            "getVoiceChangerStatus",
            "toggleVoiceChanger",
            "getVoiceChangerStatus",
            "getVoiceChangerStatus",
          ],
        );
        socket.sent.length = 0;
        yield* runtime.SetHearSelfState({ state: false });
        assert.deepStrictEqual(
          socket.sent.map((packet) => packet.action),
          ["getHearMyselfStatus", "toggleHearMyVoice", "getHearMyselfStatus"],
        );
        socket.sent.length = 0;
        yield* runtime.SetHearSelfState({ state: false });
        assert.deepStrictEqual(
          socket.sent.map((packet) => packet.action),
          ["getHearMyselfStatus"],
        );
        yield* runtime.SetVoice({ voice: "Baby" });
        assert.deepStrictEqual(
          socket.sent.find((packet) => packet.action === "loadVoice")?.payload,
          { voiceID: "baby" },
        );
        yield* runtime.SetVoice({ voice: "baby" });
        assert.strictEqual(
          (yield* Effect.flip(runtime.SetVoice({ voice: "missing" })))._tag,
          "VoicemodRequestFailed",
        );
        assert.strictEqual(
          (yield* Effect.flip(runtime.SetVoice({ voice: "disabled" })))._tag,
          "VoicemodRequestFailed",
        );
        socket.invalidState = true;
        const toggles = socket.sent.filter(
          (packet) => packet.action === "toggleVoiceChanger",
        ).length;
        assert.strictEqual(
          (yield* Effect.flip(runtime.SetVoiceChangerState({ state: true })))._tag,
          "VoicemodRequestFailed",
        );
        assert.strictEqual(
          socket.sent.filter((packet) => packet.action === "toggleVoiceChanger").length,
          toggles,
        );
        yield* client.VoicemodDisconnect();
        assert.isTrue(socket.closed);
        assert.strictEqual(
          (yield* Effect.flip(runtime.SetHearSelfState({ state: false })))._tag,
          "VoicemodConnectionFailed",
        );
        assert.strictEqual(
          (yield* Effect.flip(runtime.SetVoiceChangerState({ state: true })))._tag,
          "VoicemodConnectionFailed",
        );
        yield* client.VoicemodConnect();
      }).pipe(Effect.provide(test.layer));
      assert.isTrue(test.sockets.every((socket) => socket.closed));
    }),
  );

  it.effect("validates local URLs, requires a key and rejects unauthorized registration", () =>
    Effect.gen(function* () {
      const test = setup(initialStorage, 401);
      yield* Effect.gen(function* () {
        const { client, engine } = yield* EngineTest.makeClients(VoicemodEngine);
        assert.strictEqual(
          (yield* Effect.flip(client.VoicemodConnect()))._tag,
          "VoicemodConnectionFailed",
        );
        for (const url of [
          "ws://example.com/v1",
          "ws://secret:password@localhost/v1",
          "http://localhost/v1",
          "ws://localhost/v1?key=secret",
        ])
          assert.strictEqual(
            (yield* Effect.flip(client.VoicemodConfigure({ url, connectOnStartup: false })))._tag,
            "VoicemodConnectionFailed",
          );
        assert.strictEqual(test.sockets.length, 0);
        yield* client.VoicemodConfigure({
          url: "ws://localhost:20000/v1",
          clientKey: "server-key",
          connectOnStartup: true,
        });
        assert.strictEqual(test.storage().url, "ws://127.0.0.1:20000/v1");
        assert.strictEqual(
          (yield* Effect.flip(client.VoicemodConnect()))._tag,
          "VoicemodRequestFailed",
        );
        assert.isTrue(test.sockets[0]?.closed);
        assert.strictEqual((yield* engine.client.state).state, "error");
        assert.notInclude(JSON.stringify(yield* engine.client.state), "server-key");
        yield* client.VoicemodConfigure({ url: initialStorage.url, connectOnStartup: false });
        assert.strictEqual(test.storage().clientKey, "server-key");
      }).pipe(Effect.provide(test.layer));
    }),
  );

  it.effect("connects on startup and fails pending queries when the socket closes", () =>
    Effect.gen(function* () {
      const test = setup({ ...initialStorage, clientKey: "server-key", connectOnStartup: true });
      yield* Effect.gen(function* () {
        const { runtime, engine } = yield* EngineTest.makeClients(VoicemodEngine);
        while ((yield* engine.client.state).state !== "connected") yield* Effect.yieldNow;
        const socket = test.sockets[0];
        assert.isDefined(socket);
        socket.ignore = true;
        const request = yield* runtime.SetHearSelfState({ state: true }).pipe(Effect.forkChild);
        while (socket.sent.length < 2) yield* Effect.yieldNow;
        socket.dispatchEvent(new Event("close"));
        assert.strictEqual(
          (yield* Effect.flip(Fiber.join(request)))._tag,
          "VoicemodConnectionFailed",
        );
        while ((yield* engine.client.state).state !== "disconnected") yield* Effect.yieldNow;
        assert.strictEqual(
          (yield* Effect.flip(runtime.SetVoice({ voice: "Baby" })))._tag,
          "VoicemodConnectionFailed",
        );
      }).pipe(Effect.provide(test.layer));
    }),
  );

  it.effect(
    "times out ID-less queries and closes so stale replies cannot satisfy future queries",
    () =>
      Effect.gen(function* () {
        const test = setup();
        yield* Effect.gen(function* () {
          const { client, runtime, engine } = yield* EngineTest.makeClients(VoicemodEngine);
          yield* client.VoicemodConnect();
          const socket = test.sockets[0];
          assert.isDefined(socket);
          socket.ignore = true;
          const request = yield* runtime
            .SetVoiceChangerState({ state: true })
            .pipe(Effect.forkChild);
          while (socket.sent.length < 2) yield* Effect.yieldNow;
          yield* TestClock.adjust("11 seconds");
          assert.strictEqual(
            (yield* Effect.flip(Fiber.join(request)))._tag,
            "VoicemodRequestFailed",
          );
          assert.isTrue(socket.closed);
          socket.message({
            actionType: "toggleVoiceChanger",
            actionID: null,
            actionObject: { value: false },
          });
          assert.strictEqual(
            (yield* Effect.flip(runtime.SetVoiceChangerState({ state: true })))._tag,
            "VoicemodConnectionFailed",
          );
          assert.strictEqual((yield* engine.client.state).state, "disconnected");
          yield* client.VoicemodConnect();
          yield* runtime.SetVoiceChangerState({ state: true });
        }).pipe(Effect.provide(test.layer));
      }),
  );
});
