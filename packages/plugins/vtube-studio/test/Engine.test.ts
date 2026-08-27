import { assert, describe, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { Socket } from "effect/unstable/socket";

import { VTubeStudioEngine, initialStorage } from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";
import * as Protocol from "../src/Protocol.ts";

type Packet = { requestID: string; messageType: string; data: Record<string, unknown> };
class MockWebSocket extends EventTarget {
  readonly readyState = 1;
  readonly sent: Packet[] = [];
  closed = false;
  ignore = false;
  authenticate = true;
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
    const type = packet.messageType.replace(/Request$/, "");
    const rejected = packet.data.modelID === "fail";
    const response =
      type === "AuthenticationToken"
        ? { authenticationToken: "server-only-token" }
        : type === "Authentication"
          ? { authenticated: this.authenticate }
          : rejected
            ? { errorID: 50, message: "secret server-only-token" }
            : type === "AvailableModels"
              ? { availableModels: [{ modelID: "model-1" }] }
              : {};
    queueMicrotask(() =>
      this.message({
        apiName: "VTubeStudioPublicAPI",
        apiVersion: "1.0",
        requestID: packet.requestID,
        messageType: rejected ? "APIError" : `${type}Response`,
        data: response,
      }),
    );
  }
  message(packet: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(packet) }));
  }
}
const setup = (
  initial: typeof VTubeStudioEngine.Storage.Type = initialStorage,
  authenticate = true,
  ignore = false,
) => {
  let storage = initial;
  const sockets: MockWebSocket[] = [];
  let refreshes = 0;
  const dependencies = Layer.mergeAll(
    Layer.succeed(Socket.WebSocketConstructor)((url) => {
      const socket = new MockWebSocket(url);
      socket.authenticate = authenticate;
      socket.ignore = ignore;
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }),
    Layer.succeed(VTubeStudioEngine.EngineContext)({
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
      client: {
        refresh: Effect.sync(() => {
          refreshes++;
        }),
      },
      emit: () => Effect.void,
    }),
  );
  return {
    sockets,
    storage: () => storage,
    refreshes: () => refreshes,
    layer: deployment.layer.pipe(Layer.provide(dependencies)),
  };
};

describe("VTube Studio engine", () => {
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
        const { client, runtime, engine } = yield* EngineTest.makeClients(VTubeStudioEngine);
        yield* client.VTubeStudioConnect();
        const disconnecting = yield* client.VTubeStudioDisconnect().pipe(Effect.forkChild);
        yield* Deferred.await(closing);
        yield* client.VTubeStudioConnect();
        assert.strictEqual((yield* engine.client.state).state, "connected");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(disconnecting);
        assert.strictEqual((yield* engine.client.state).state, "connected");
        assert.isTrue(test.sockets[0]?.closed);
        assert.isFalse(test.sockets[1]?.closed);
        assert.deepStrictEqual(
          yield* runtime.Call({
            url: initialStorage.url,
            requestType: "AvailableModels",
            data: {},
          }),
          { availableModels: [{ modelID: "model-1" }] },
        );
      }).pipe(
        Effect.ensuring(Deferred.succeed(release, undefined)),
        Effect.provide(test.layer),
        Effect.ensuring(Effect.sync(() => spy.mockRestore())),
      );
    }),
  );

  it.effect("disconnect cancels an authentication prompt and releases its connection", () =>
    Effect.gen(function* () {
      const test = setup(initialStorage, true, true);
      yield* Effect.gen(function* () {
        const { client, engine } = yield* EngineTest.makeClients(VTubeStudioEngine);
        const connecting = yield* client.VTubeStudioConnect().pipe(Effect.forkChild);
        while (!test.sockets[0]?.sent.length) yield* Effect.yieldNow;
        assert.strictEqual((yield* engine.client.state).state, "connecting");
        yield* client.VTubeStudioDisconnect();
        assert.strictEqual(
          (yield* Effect.flip(Fiber.join(connecting)))._tag,
          "VTubeStudioConnectionFailed",
        );
        assert.isTrue(test.sockets[0]?.closed);
        assert.strictEqual((yield* engine.client.state).state, "disconnected");
      }).pipe(Effect.provide(test.layer));
    }),
  );
  it.effect(
    "authenticates, persists tokens only server-side, reconnects and releases sockets",
    () =>
      Effect.gen(function* () {
        const test = setup();
        yield* Effect.gen(function* () {
          const { client, runtime, engine } = yield* EngineTest.makeClients(VTubeStudioEngine);
          assert.strictEqual(
            (yield* Effect.flip(
              runtime.Call({ url: initialStorage.url, requestType: "AvailableModels", data: {} }),
            ))._tag,
            "VTubeStudioConnectionFailed",
          );
          yield* client.VTubeStudioConnect();
          const socket = test.sockets[0];
          assert.isDefined(socket);
          assert.deepStrictEqual(
            socket.sent.map((p) => p.messageType),
            ["AuthenticationTokenRequest", "AuthenticationRequest"],
          );
          assert.strictEqual(test.storage().authenticationToken, "server-only-token");
          assert.notInclude(JSON.stringify(yield* engine.client.state), "server-only-token");
          assert.strictEqual((yield* engine.client.state).state, "connected");
          assert.deepStrictEqual(
            yield* runtime.Call({
              url: initialStorage.url,
              requestType: "AvailableModels",
              data: {},
            }),
            { availableModels: [{ modelID: "model-1" }] },
          );
          const failure = yield* Effect.flip(
            runtime.Call({
              url: initialStorage.url,
              requestType: "ModelLoad",
              data: { modelID: "fail" },
            }),
          );
          assert.strictEqual(failure._tag, "VTubeStudioRequestFailed");
          assert.notInclude(JSON.stringify(failure), "server-only-token");
          if (failure._tag === "VTubeStudioRequestFailed") assert.strictEqual(failure.code, 50);
          yield* client.VTubeStudioDisconnect();
          assert.isTrue(socket.closed);
          yield* client.VTubeStudioConnect();
          assert.deepStrictEqual(
            test.sockets[1]?.sent.map((p) => p.messageType),
            ["AuthenticationRequest"],
          );
          yield* client.VTubeStudioConfigure({
            url: "ws://localhost:8002",
            connectOnStartup: false,
            resetAuthentication: false,
          });
          assert.isTrue(test.sockets[1]?.closed);
          assert.isUndefined(test.storage().authenticationToken);
          assert.strictEqual(test.storage().url, "ws://127.0.0.1:8002/");
          yield* client.VTubeStudioConnect();
          assert.strictEqual(test.sockets[2]?.sent[0]?.messageType, "AuthenticationTokenRequest");
          assert.isAbove(test.refreshes(), 0);
        }).pipe(Effect.provide(test.layer));
        assert.isTrue(test.sockets.every((socket) => socket.closed));
      }),
  );

  it.effect("uses persisted tokens at startup and supports resetting authentication", () =>
    Effect.gen(function* () {
      const test = setup({
        ...initialStorage,
        authenticationToken: "server-only-token",
        connectOnStartup: true,
      });
      yield* Effect.gen(function* () {
        const { client, engine } = yield* EngineTest.makeClients(VTubeStudioEngine);
        while ((yield* engine.client.state).state !== "connected") yield* Effect.yieldNow;
        assert.strictEqual(test.sockets[0]?.sent[0]?.messageType, "AuthenticationRequest");
        yield* client.VTubeStudioDisconnect();
        yield* client.VTubeStudioConfigure({
          url: initialStorage.url,
          connectOnStartup: false,
          resetAuthentication: true,
        });
        assert.isUndefined(test.storage().authenticationToken);
        yield* client.VTubeStudioConnect();
        assert.strictEqual(test.sockets[1]?.sent[0]?.messageType, "AuthenticationTokenRequest");
      }).pipe(Effect.provide(test.layer));
    }),
  );

  it.effect("returns typed authentication failures and closes the rejected connection", () =>
    Effect.gen(function* () {
      const test = setup(initialStorage, false);
      yield* Effect.gen(function* () {
        const { client, engine } = yield* EngineTest.makeClients(VTubeStudioEngine);
        const failure = yield* Effect.flip(client.VTubeStudioConnect());
        assert.strictEqual(failure._tag, "VTubeStudioRequestFailed");
        assert.strictEqual((yield* engine.client.state).state, "error");
        assert.isTrue(test.sockets[0]?.closed);
        assert.notInclude(JSON.stringify(yield* engine.client.state), "server-only-token");
      }).pipe(Effect.provide(test.layer));
    }),
  );

  it.effect("rejects nonlocal and credential-bearing URLs without opening a socket", () =>
    Effect.gen(function* () {
      const test = setup();
      yield* Effect.gen(function* () {
        const { client } = yield* EngineTest.makeClients(VTubeStudioEngine);
        for (const url of [
          "ws://example.com:8001",
          "ws://127.0.0.1.evil:8001",
          "ws://user:secret@localhost:8001",
          "https://localhost:8001",
          "ws://localhost:8001/?token=secret",
        ]) {
          const failure = yield* Effect.flip(
            client.VTubeStudioConfigure({
              url,
              connectOnStartup: false,
              resetAuthentication: false,
            }),
          );
          assert.strictEqual(failure._tag, "VTubeStudioConnectionFailed");
          assert.notInclude(failure.reason, "secret");
        }
        assert.strictEqual(test.sockets.length, 0);
      }).pipe(Effect.provide(test.layer));
    }),
  );

  it.effect("fails pending calls on close, malformed packets and request timeout", () =>
    Effect.gen(function* () {
      const test = setup();
      yield* Effect.gen(function* () {
        const { client, runtime, engine } = yield* EngineTest.makeClients(VTubeStudioEngine);
        yield* client.VTubeStudioConnect();
        const socket = test.sockets[0];
        assert.isDefined(socket);
        socket.ignore = true;
        const request = yield* runtime
          .Call({ url: initialStorage.url, requestType: "AvailableModels", data: {} })
          .pipe(Effect.forkChild);
        while (socket.sent.length < 3) yield* Effect.yieldNow;
        socket.dispatchEvent(new Event("close"));
        assert.strictEqual(
          (yield* Effect.flip(Fiber.join(request)))._tag,
          "VTubeStudioConnectionFailed",
        );
        while ((yield* engine.client.state).state !== "disconnected") yield* Effect.yieldNow;
        yield* client.VTubeStudioConnect();
        const second = test.sockets[1];
        assert.isDefined(second);
        second.ignore = true;
        const timed = yield* runtime
          .Call({ url: initialStorage.url, requestType: "AvailableModels", data: {} })
          .pipe(Effect.forkChild);
        while (second.sent.length < 2) yield* Effect.yieldNow;
        yield* TestClock.adjust("31 seconds");
        assert.strictEqual(
          (yield* Effect.flip(Fiber.join(timed)))._tag,
          "VTubeStudioRequestFailed",
        );
        second.message({ invalid: "server-only-token" });
        while ((yield* engine.client.state).state !== "disconnected") yield* Effect.yieldNow;
        assert.strictEqual(
          (yield* Effect.flip(
            runtime.Call({ url: initialStorage.url, requestType: "AvailableModels", data: {} }),
          ))._tag,
          "VTubeStudioConnectionFailed",
        );
      }).pipe(Effect.provide(test.layer));
    }),
  );
});
