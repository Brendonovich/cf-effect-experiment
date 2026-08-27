import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import {
  ClientRpcs as BaseClientRpcs,
  WebSocketClientEngine,
} from "@macrograph/plugin-websocket-client/Definition";
import { Deferred, Effect, Fiber, Function, Layer, Result, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import { Socket } from "effect/unstable/socket";
import { vi } from "vitest";

import { ClientRpcs, ConnectionId, GoXLREngine, type GoXLREvent } from "../src/Definition.ts";
import layer from "../src/Engine.ts";
import { statusRequest } from "../src/Protocol.ts";
import { broadcastPatch } from "./Fixtures.ts";

// Copy the ESM namespaces so tests can inject scheduling barriers without production hooks.
vi.mock("effect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("effect")>();
  return { ...actual, SubscriptionRef: { ...actual.SubscriptionRef } };
});
vi.mock("effect/unstable/socket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("effect/unstable/socket")>();
  return { ...actual, Socket: { ...actual.Socket } };
});

class MockWebSocket extends EventTarget {
  readyState = 0;
  closed = false;
  failSend = false;
  acknowledge = true;
  daemonError: string | undefined;
  readonly sent: string[] = [];
  constructor(
    readonly mixers: Record<string, { levels: { volumes: Record<string, number> } }>,
    readonly status = true,
    autoOpen = true,
  ) {
    super();
    if (autoOpen) queueMicrotask(() => this.open());
  }
  open() {
    if (this.closed) return;
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  message(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  send(data: string) {
    if (this.failSend) throw new Error("writer failed");
    this.sent.push(data);
    if (data === '{"id":0,"data":"GetStatus"}') {
      if (this.status)
        queueMicrotask(() =>
          this.message(JSON.stringify({ id: 0, data: { Status: { mixers: this.mixers } } })),
        );
    } else if (this.acknowledge)
      queueMicrotask(() =>
        this.message(
          JSON.stringify({ id: 0, data: this.daemonError ? { Error: this.daemonError } : "Ok" }),
        ),
      );
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

const harness = Effect.fnUntraced(function* (options?: {
  readonly empty?: boolean;
  readonly status?: boolean;
  readonly startup?: boolean;
  readonly initialEmpty?: boolean;
  readonly url?: string;
  readonly autoOpen?: boolean;
}) {
  const id = ConnectionId.make("primary");
  let storage: typeof GoXLREngine.Storage.Type = {
    connections: options?.initialEmpty
      ? []
      : [
          {
            id,
            name: "GoXLR",
            url: options?.url ?? "ws://localhost:14564/api/websocket",
            connectOnStartup: options?.startup ?? false,
          },
        ],
  };
  const sockets: MockWebSocket[] = [];
  const events: GoXLREvent[] = [];
  const emitted = yield* Deferred.make<void>();
  const created = yield* Deferred.make<void>();
  const dependencies = Layer.mergeAll(
    Layer.succeed(Socket.WebSocketConstructor)(() => {
      const socket = new MockWebSocket(
        options?.empty
          ? {}
          : { serial: { levels: { volumes: { Music: 10 } } }, other: { levels: { volumes: {} } } },
        options?.status ?? true,
        options?.autoOpen ?? true,
      );
      sockets.push(socket);
      Deferred.doneUnsafe(created, Effect.void);
      return socket as unknown as globalThis.WebSocket;
    }),
    Layer.succeed(GoXLREngine.EngineContext)({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) =>
          Effect.sync(() => {
            storage = value;
          }),
        update: (update) =>
          Effect.sync(() => {
            storage = update(storage);
          }),
      },
      resource: { refresh: () => Effect.void },
      client: { refresh: Effect.void },
      credentials: {
        get: Effect.succeed([]),
        refresh: () => Effect.die("No credentials"),
        subscribe: () => Effect.void,
      },
      emit: (event) =>
        Effect.sync(() => {
          events.push(event);
          Deferred.doneUnsafe(emitted, Effect.void);
        }),
    }),
  );
  const built = yield* Layer.build(layer.pipe(Layer.provide(dependencies)));
  const clients = yield* EngineTest.makeClients(GoXLREngine).pipe(Effect.provideContext(built));
  return { ...clients, id, sockets, events, emitted, created, storage: () => storage };
});

describe("GoXLR engine", () => {
  it.effect(
    "processes raw broadcast patches, all event families and mixer changes without reader defects",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          yield* h.client.GoXLRWebSocketConnect({ id: h.id });
          h.sockets[0]!.message(broadcastPatch);
          while (h.events.length < 4) yield* Effect.yieldNow;
          assert.deepStrictEqual(
            h.events.map((event) => event._tag),
            ["GoXLRLevelChange", "GoXLRButtonState", "GoXLRDialState", "GoXLRChannelMuteState"],
          );
          yield* h.runtime.GoXLRCommand({ connectionId: h.id, command: { SetFXEnabled: true } });
          assert.strictEqual(
            h.sockets[0]!.sent[1],
            '{"id":0,"data":{"Command":["other",{"SetFXEnabled":true}]}}',
          );
          assert.strictEqual((yield* h.engine.client.state).connections[0]!.status, "connected");
        }),
      ),
  );
  it.effect(
    "finishes engine-owned setup after a cancelled RPC and late open/status, then reconnects",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness({ autoOpen: false, status: false });
          const caller = yield* h.client.GoXLRWebSocketConnect({ id: h.id }).pipe(Effect.forkChild);
          yield* Deferred.await(h.created);
          yield* Fiber.interrupt(caller);
          const socket = h.sockets[0]!;
          socket.open();
          while (socket.sent.length < 1) yield* Effect.yieldNow;
          socket.message(JSON.stringify({ id: 0, data: { Status: { mixers: socket.mixers } } }));
          while ((yield* h.engine.client.state).connections[0]!.status === "connecting")
            yield* Effect.yieldNow;
          assert.strictEqual((yield* h.engine.client.state).connections[0]!.status, "connected");
          yield* h.runtime.GoXLRCommand({ connectionId: h.id, command: { SetFXEnabled: true } });
          yield* h.client.GoXLRWebSocketDisconnect({ id: h.id });
          const recovery = yield* h.client
            .GoXLRWebSocketConnect({ id: h.id })
            .pipe(Effect.forkChild);
          while (h.sockets.length < 2) yield* Effect.yieldNow;
          h.sockets[1]!.open();
          while (h.sockets[1]!.sent.length < 1) yield* Effect.yieldNow;
          h.sockets[1]!.message(
            JSON.stringify({ id: 0, data: { Status: { mixers: socket.mixers } } }),
          );
          yield* Fiber.join(recovery);
          assert.isTrue(socket.closed);
          assert.strictEqual((yield* h.engine.client.state).connections[0]!.status, "connected");
        }),
      ),
  );
  it.effect("cancelling either shared handshake waiter does not cancel the other", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const cancelFirst of [true, false]) {
          const h = yield* harness({ autoOpen: false });
          const first = yield* h.client.GoXLRWebSocketConnect({ id: h.id }).pipe(Effect.forkChild);
          yield* Deferred.await(h.created);
          const second = yield* h.client.GoXLRWebSocketConnect({ id: h.id }).pipe(Effect.forkChild);
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(cancelFirst ? first : second);
          h.sockets[0]!.open();
          yield* Fiber.join(cancelFirst ? second : first);
          assert.strictEqual(h.sockets.length, 1);
          assert.strictEqual((yield* h.engine.client.state).connections[0]!.status, "connected");
        }
      }),
    ),
  );
  it.effect("a cancelled handshake still times out instead of remaining connecting", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ status: false });
        const caller = yield* h.client.GoXLRWebSocketConnect({ id: h.id }).pipe(Effect.forkChild);
        yield* Deferred.await(h.created);
        yield* Fiber.interrupt(caller);
        yield* TestClock.adjust("11 seconds");
        assert.isTrue(h.sockets[0]!.closed);
        assert.strictEqual((yield* h.engine.client.state).connections[0]!.status, "error");
      }),
    ),
  );
  it.effect(
    "bounds a blocked writer and interrupts it on peer closure or the whole-exchange timeout",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const closePeer of [true, false]) {
            const started = yield* Deferred.make<void>();
            const interrupted = yield* Deferred.make<void>();
            const makeSocket = Socket.makeWebSocket;
            const spy = vi.spyOn(Socket, "makeWebSocket").mockImplementation((...args) =>
              makeSocket(...args).pipe(
                Effect.map((socket) => ({
                  ...socket,
                  writer: socket.writer.pipe(
                    Effect.map(
                      (write) => (data) =>
                        data === statusRequest
                          ? write(data)
                          : Deferred.succeed(started, undefined).pipe(
                              Effect.andThen(Effect.never),
                              Effect.onInterrupt(() =>
                                Deferred.succeed(interrupted, undefined).pipe(Effect.asVoid),
                              ),
                            ),
                    ),
                  ),
                })),
              ),
            );
            yield* Effect.gen(function* () {
              const h = yield* harness();
              yield* h.client.GoXLRWebSocketConnect({ id: h.id });
              const command = yield* h.runtime
                .GoXLRCommand({ connectionId: h.id, command: { SetFXEnabled: true } })
                .pipe(Effect.result, Effect.forkChild);
              yield* Deferred.await(started);
              if (closePeer) h.sockets[0]!.close();
              else yield* TestClock.adjust("11 seconds");
              const result = yield* Fiber.join(command);
              assert.isTrue(Result.isFailure(result));
              yield* Deferred.await(interrupted);
              assert.isTrue(h.sockets[0]!.closed);
            }).pipe(Effect.ensuring(Effect.sync(() => spy.mockRestore())));
          }
        }),
      ),
  );
  it.effect(
    "finalization cannot resurrect an entry removed or disconnected during its state transition",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const remove of [true, false]) {
            const h = yield* harness();
            yield* h.client.GoXLRWebSocketConnect({ id: h.id });
            const reached = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            let paused = false;
            const pause = (value: unknown) =>
              Effect.suspend(() => {
                if (paused || !(value instanceof Map) || !value.has(h.id)) return Effect.void;
                paused = true;
                return Deferred.succeed(reached, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                );
              });
            const get = SubscriptionRef.get;
            const update = SubscriptionRef.update;
            // Pause old code after its read, or atomic code before its update callback runs.
            const getSpy = vi
              .spyOn(SubscriptionRef, "get")
              .mockImplementation(<A>(ref: SubscriptionRef.SubscriptionRef<A>) =>
                get(ref).pipe(Effect.tap(pause)),
              );
            const interceptedUpdate: typeof SubscriptionRef.update = Function.dual(
              2,
              <A>(ref: SubscriptionRef.SubscriptionRef<A>, f: (value: A) => A) =>
                get(ref).pipe(Effect.flatMap(pause), Effect.andThen(update(ref, f))),
            );
            const updateSpy = vi
              .spyOn(SubscriptionRef, "update")
              .mockImplementation(interceptedUpdate);
            yield* Effect.gen(function* () {
              h.sockets[0]!.close();
              yield* Deferred.await(reached);
              const mutation = yield* (
                remove
                  ? h.client.GoXLRWebSocketRemoveConnection({ id: h.id })
                  : h.client.GoXLRWebSocketDisconnect({ id: h.id })
              ).pipe(Effect.forkChild);
              while ((yield* h.engine.client.state).connections[0]?.status === "connected")
                yield* Effect.yieldNow;
              yield* Deferred.succeed(release, undefined);
              yield* Fiber.join(mutation);
              const connections = (yield* h.engine.client.state).connections;
              if (remove) {
                assert.deepStrictEqual(connections, []);
                assert.deepStrictEqual(h.storage().connections, []);
              } else {
                assert.strictEqual(connections[0]!.status, "disconnected");
                assert.isFalse(h.storage().connections[0]!.connectOnStartup);
              }
            }).pipe(
              Effect.ensuring(
                Deferred.succeed(release, undefined).pipe(
                  Effect.andThen(
                    Effect.sync(() => {
                      getSpy.mockRestore();
                      updateSpy.mockRestore();
                    }),
                  ),
                ),
              ),
            );
          }
        }),
      ),
  );
  it.effect("serializes id-zero commands and ignores acknowledgments for other request IDs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.client.GoXLRWebSocketConnect({ id: h.id });
        const socket = h.sockets[0]!;
        socket.acknowledge = false;
        let firstDone = false;
        const first = yield* h.runtime
          .GoXLRCommand({ connectionId: h.id, command: { SetEchoAmount: 10 } })
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                firstDone = true;
              }),
            ),
            Effect.forkChild,
          );
        while (socket.sent.length < 2) yield* Effect.yieldNow;
        const second = yield* h.runtime
          .GoXLRCommand({ connectionId: h.id, command: { SetEchoAmount: 20 } })
          .pipe(Effect.forkChild);
        socket.message('{"id":123,"data":"Ok"}');
        socket.message('{"id":18446744073709551615,"data":"Ok"}');
        yield* Effect.yieldNow;
        assert.isFalse(firstDone);
        assert.strictEqual(socket.sent.length, 2);
        socket.message('{"id":0,"data":"Ok"}');
        yield* Fiber.join(first);
        while (socket.sent.length < 3) yield* Effect.yieldNow;
        assert.strictEqual(
          socket.sent[2],
          '{"id":0,"data":{"Command":["serial",{"SetEchoAmount":20}]}}',
        );
        socket.message('{"id":0,"data":"Ok"}');
        yield* Fiber.join(second);
      }),
    ),
  );
  it.effect("fails a pending command when the peer closes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.client.GoXLRWebSocketConnect({ id: h.id });
        const socket = h.sockets[0]!;
        socket.acknowledge = false;
        const command = yield* h.runtime
          .GoXLRCommand({ connectionId: h.id, command: { SetFXEnabled: true } })
          .pipe(Effect.result, Effect.forkChild);
        while (socket.sent.length < 2) yield* Effect.yieldNow;
        socket.close();
        assert.isTrue(Result.isFailure(yield* Fiber.join(command)));
        assert.strictEqual((yield* h.engine.client.state).connections[0]!.status, "error");
      }),
    ),
  );
  it.effect(
    "does not attempt connections with initial storage and honors saved startup intent",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const empty = yield* harness({ initialEmpty: true });
          yield* Effect.yieldNow;
          assert.strictEqual(empty.sockets.length, 0);
          assert.deepStrictEqual(yield* empty.engine.client.state, { connections: [] });
          const startup = yield* harness({ startup: true });
          yield* Deferred.await(startup.created);
          while ((yield* startup.engine.client.state).connections[0]!.status !== "connected")
            yield* Effect.yieldNow;
          assert.deepStrictEqual(startup.sockets[0]!.sent, ['{"id":0,"data":"GetStatus"}']);
        }),
      ),
  );
  it.effect(
    "discovers the first mixer, sends/acknowledges commands, filters patches and reconnects",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          assert.notStrictEqual(GoXLREngine.key, WebSocketClientEngine.key);
          for (const tag of ClientRpcs.requests.keys())
            assert.isFalse(BaseClientRpcs.requests.has(tag));
          yield* h.client.GoXLRWebSocketConnect({ id: h.id });
          const socket = h.sockets[0]!;
          assert.deepStrictEqual(socket.sent, ['{"id":0,"data":"GetStatus"}']);
          yield* h.runtime.GoXLRCommand({ connectionId: h.id, command: { SetFXEnabled: true } });
          assert.strictEqual(
            socket.sent[1],
            '{"id":0,"data":{"Command":["serial",{"SetFXEnabled":true}]}}',
          );
          socket.message("not-json");
          socket.message(new Uint8Array([1, 2]));
          socket.message(
            JSON.stringify({
              id: 0,
              data: {
                Patch: [
                  { op: "replace", path: "/mixers/other/levels/volumes/Music", value: 30 },
                  { op: "remove", path: "/irrelevant" },
                  { op: "replace", path: "/mixers/serial/levels/volumes/Music", value: 12.6 },
                ],
              },
            }),
          );
          yield* Deferred.await(h.emitted);
          assert.deepStrictEqual(
            h.events.map((event) => ({ ...event })),
            [{ _tag: "GoXLRLevelChange", connectionId: h.id, channel: "Music", value: 13 }],
          );
          assert.isTrue(h.storage().connections[0]!.connectOnStartup);
          yield* h.client.GoXLRWebSocketDisconnect({ id: h.id });
          assert.isTrue(socket.closed);
          assert.isFalse(h.storage().connections[0]!.connectOnStartup);
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(
                h.runtime.GoXLRCommand({ connectionId: h.id, command: { SetFXEnabled: false } }),
              ),
            ),
          );
          yield* h.client.GoXLRWebSocketConnect({ id: h.id });
          assert.strictEqual(h.sockets.length, 2);
          assert.strictEqual((yield* h.engine.client.state).connections[0]!.status, "connected");
        }),
      ),
  );
  it.effect(
    "fails unknown/disconnected connections and missing mixers without sending commands",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness({ empty: true });
          for (const connectionId of [h.id, ConnectionId.make("missing")])
            assert.isTrue(
              Result.isFailure(
                yield* Effect.result(
                  h.runtime.GoXLRCommand({ connectionId, command: { SetFXEnabled: true } }),
                ),
              ),
            );
          yield* h.client.GoXLRWebSocketConnect({ id: h.id });
          const result = yield* Effect.result(
            h.runtime.GoXLRCommand({ connectionId: h.id, command: { SetFXEnabled: true } }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.strictEqual(result.failure._tag, "GoXLRFailure");
          assert.strictEqual(h.sockets[0]!.sent.length, 1);
        }),
      ),
  );
  it.effect("propagates daemon and writer failures instead of reporting success", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const failSend of [false, true]) {
          const h = yield* harness();
          yield* h.client.GoXLRWebSocketConnect({ id: h.id });
          const socket = h.sockets[0]!;
          socket.failSend = failSend;
          socket.daemonError = "Device rejected command";
          const result = yield* Effect.result(
            h.runtime.GoXLRCommand({ connectionId: h.id, command: { SetReverbAmount: 1000 } }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result) && result.failure._tag === "GoXLRFailure")
            assert.strictEqual(
              result.failure.reason,
              failSend ? "GoXLR command send failed" : "Device rejected command",
            );
          assert.isTrue(socket.closed);
        }
      }),
    ),
  );
  it.effect("times out missing status and closes the transport", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ status: false });
        const connecting = yield* h.client
          .GoXLRWebSocketConnect({ id: h.id })
          .pipe(Effect.result, Effect.forkChild);
        yield* Deferred.await(h.created);
        yield* TestClock.adjust("11 seconds");
        const result = yield* Fiber.join(connecting);
        assert.isTrue(Result.isFailure(result));
        assert.isTrue(h.sockets[0]!.closed);
        assert.strictEqual((yield* h.engine.client.state).connections[0]!.status, "error");
      }),
    ),
  );
  it.effect(
    "times out missing acknowledgments and closes to avoid id-zero response ambiguity",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          yield* h.client.GoXLRWebSocketConnect({ id: h.id });
          h.sockets[0]!.acknowledge = false;
          const command = yield* h.runtime
            .GoXLRCommand({ connectionId: h.id, command: { SetFXEnabled: true } })
            .pipe(Effect.result, Effect.forkChild);
          yield* TestClock.adjust("11 seconds");
          assert.isTrue(Result.isFailure(yield* Fiber.join(command)));
          assert.isTrue(h.sockets[0]!.closed);
        }),
      ),
  );
  it.effect("validates configured URLs and retains independent connection settings", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        for (const url of [
          "https://localhost",
          "ws://user:secret@localhost",
          "ws://localhost#fragment",
          "invalid",
        ])
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(h.client.GoXLRWebSocketAddConnection({ name: "Invalid", url })),
            ),
          );
        const added = yield* h.client.GoXLRWebSocketAddConnection({
          name: "Second",
          url: "ws://192.168.1.2:14564/api/websocket",
        });
        assert.strictEqual(h.storage().connections.length, 2);
        yield* h.client.GoXLRWebSocketRemoveConnection({ id: added });
        assert.strictEqual(h.storage().connections.length, 1);
        const invalidStored = yield* harness({ url: "https://localhost" });
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(
              invalidStored.client.GoXLRWebSocketConnect({ id: invalidStored.id }),
            ),
          ),
        );
        assert.strictEqual(invalidStored.sockets.length, 0);
      }),
    ),
  );
  it.effect("updates mixer selection when status patches remove or replace the roster", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.client.GoXLRWebSocketConnect({ id: h.id });
        const socket = h.sockets[0]!;
        socket.message(
          JSON.stringify({
            id: 0,
            data: {
              Patch: [
                { op: "remove", path: "/mixers/serial" },
                { op: "replace", path: "/mixers/other/button_down/Fader1Mute", value: true },
              ],
            },
          }),
        );
        yield* Deferred.await(h.emitted);
        yield* h.runtime.GoXLRCommand({ connectionId: h.id, command: { SetFXEnabled: true } });
        assert.strictEqual(
          socket.sent[1],
          '{"id":0,"data":{"Command":["other",{"SetFXEnabled":true}]}}',
        );
        socket.message(
          JSON.stringify({
            id: 0,
            data: { Patch: [{ op: "replace", path: "/mixers", value: {} }] },
          }),
        );
        yield* Effect.yieldNow;
        const result = yield* Effect.result(
          h.runtime.GoXLRCommand({ connectionId: h.id, command: { SetFXEnabled: false } }),
        );
        assert.isTrue(Result.isFailure(result));
        assert.strictEqual(socket.sent.length, 2);
      }),
    ),
  );
});
