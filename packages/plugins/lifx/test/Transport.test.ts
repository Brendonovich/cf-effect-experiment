import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Result, Scheduler, Scope } from "effect";
import { layer as udpLayer, SocketFactory, UdpSocket, type RawSocket } from "effect-node-udp";
import { TestClock } from "effect/testing";
import { Buffer } from "node:buffer";
import { createSocket } from "node:dgram";
import { EventEmitter } from "node:events";

import { LIFXFailure } from "../src/Definition.ts";
import { layer, nodeLayer, Transport } from "../src/Transport.ts";
import { device, response } from "./Fixtures.ts";

class MockSocket extends EventEmitter implements RawSocket {
  closed = false;
  bound = false;
  readonly sent: Buffer[] = [];
  constructor(
    readonly options: {
      bind?: "throw" | "error" | "hang";
      send?: "throw" | "callback" | "error" | "hang";
      deferClose?: boolean;
      onSend?: (packet: Buffer, socket: MockSocket) => void;
    } = {},
  ) {
    super();
  }
  bind() {
    if (this.options.bind === "throw") throw new Error("Bind failed");
    this.bound = true;
    queueMicrotask(() => {
      if (this.closed) return;
      if (this.options.bind === "error") this.emit("error", new Error("Bind failed"));
      else if (this.options.bind !== "hang") this.emit("listening");
    });
  }
  address() {
    return { address: "0.0.0.0", port: 12345 };
  }
  send(data: Uint8Array, _port: number, _address: string, callback: (error: Error | null) => void) {
    const packet = Buffer.from(data);
    if (this.options.send === "throw") throw new Error("Send failed");
    this.sent.push(packet);
    if (this.options.send !== "hang")
      callback(this.options.send === "callback" ? new Error("Send failed") : null);
    if (this.options.send === "error") this.emit("error", new Error("Socket failed"));
    this.options.onSend?.(packet, this);
  }
  reply(packet: Buffer, address = device.address, port = device.port) {
    this.emit("message", packet, { address, port });
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      if (this.options.deferClose) this.once("listening", () => this.emit("close"));
      else this.emit("close");
    }
  }
}

const harness = Effect.fnUntraced(function* (
  options?: ConstructorParameters<typeof MockSocket>[0],
) {
  const sockets: MockSocket[] = [];
  const created = yield* Deferred.make<void>();
  const dependencies = Layer.succeed(SocketFactory)(() => {
    const socket = new MockSocket(options);
    sockets.push(socket);
    Deferred.doneUnsafe(created, Effect.void);
    return socket;
  });
  const built = yield* Layer.build(
    layer.pipe(Layer.provide(udpLayer.pipe(Layer.provide(dependencies)))),
  );
  const transport = yield* Transport.pipe(Effect.provideContext(built));
  return { transport, sockets, created };
});

describe("LIFX UDP transport", () => {
  it.effect("does not send after cancellation while Node is still binding", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ bind: "hang", deferClose: true });
        const request = yield* h.transport
          .exchange(device, 101, Buffer.alloc(0), 107, 2000)
          .pipe(Effect.forkChild);
        yield* Deferred.await(h.created);
        while (!h.sockets[0]!.bound) yield* Effect.yieldNow;
        yield* Fiber.interrupt(request);
        h.sockets[0]!.emit("listening");
        assert.strictEqual(h.sockets[0]!.sent.length, 0);
        assert.isTrue(h.sockets[0]!.closed);
        assert.strictEqual(h.sockets[0]!.listenerCount("message"), 0);
      }),
    ),
  );
  it.effect("mounts inertly, correlates every response field and cleans successful sockets", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        assert.strictEqual(h.sockets.length, 0);
        let completed = false;
        const request = yield* h.transport.exchange(device, 101, Buffer.alloc(0), 107, 2000).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              completed = true;
            }),
          ),
          Effect.forkChild,
        );
        yield* Deferred.await(h.created);
        while (h.sockets[0]!.sent.length === 0) yield* Effect.yieldNow;
        const socket = h.sockets[0]!,
          valid = response(socket.sent[0]!);
        for (const [offset, value] of [
          [4, valid.readUInt32LE(4) ^ 1],
          [23, (valid[23]! + 1) % 256],
          [8, 0],
          [32, 45],
          [2, 0x1401],
          [14, 1],
          [0, 36],
        ] as const) {
          const bad = Buffer.from(valid);
          if (offset === 4) bad.writeUInt32LE(value >>> 0, offset);
          else if (offset === 8 || offset === 23) bad[offset] = value;
          else bad.writeUInt16LE(value, offset);
          socket.reply(bad);
        }
        socket.reply(Buffer.alloc(2));
        socket.reply(valid, "192.168.1.51");
        socket.reply(valid, device.address, device.port + 1);
        yield* Effect.yieldNow;
        assert.isFalse(completed);
        socket.reply(valid);
        assert.deepStrictEqual(yield* Fiber.join(request), valid.subarray(36));
        assert.isTrue(socket.closed);
        assert.strictEqual(socket.listenerCount("message"), 0);
        assert.strictEqual(socket.listenerCount("error"), 0);
      }),
    ),
  );
  it.effect("awaits ACKs and isolates concurrent exchanges and late responses", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        const first = yield* h.transport
          .exchange(device, 117, Buffer.alloc(6), 45, 2000)
          .pipe(Effect.forkChild);
        const second = yield* h.transport
          .exchange(device, 102, Buffer.alloc(13), 45, 2000)
          .pipe(Effect.forkChild);
        while (h.sockets.length < 2 || h.sockets.some((socket) => socket.sent.length === 0))
          yield* Effect.yieldNow;
        assert.strictEqual(h.sockets[0]!.sent[0]![22], 2);
        const ack1 = response(h.sockets[0]!.sent[0]!, 45, Buffer.alloc(0));
        const ack2 = response(h.sockets[1]!.sent[0]!, 45, Buffer.alloc(0));
        h.sockets[0]!.reply(ack2);
        h.sockets[1]!.reply(ack1);
        yield* Effect.yieldNow;
        assert.isFalse(h.sockets[0]!.closed);
        assert.isFalse(h.sockets[1]!.closed);
        h.sockets[1]!.reply(ack2);
        yield* Fiber.join(second);
        h.sockets[0]!.reply(ack1);
        yield* Fiber.join(first);
        const third = yield* h.transport
          .exchange(device, 117, Buffer.alloc(6), 45, 2000)
          .pipe(Effect.forkChild);
        while (h.sockets.length < 3 || h.sockets[2]!.sent.length === 0) yield* Effect.yieldNow;
        h.sockets[2]!.reply(ack1);
        yield* Effect.yieldNow;
        assert.isFalse(h.sockets[2]!.closed);
        h.sockets[2]!.reply(response(h.sockets[2]!.sent[0]!, 45, Buffer.alloc(0)));
        yield* Fiber.join(third);
      }),
    ),
  );
  it.effect("fails correlated invalid payloads and closes the socket", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const [type, length] of [
          [107, 51],
          [107, 53],
          [45, 1],
        ] as const) {
          const h = yield* harness({
            onSend: (packet, socket) => socket.reply(response(packet, type, Buffer.alloc(length))),
          });
          const result = yield* Effect.result(
            h.transport.exchange(device, 101, Buffer.alloc(0), type, 2000),
          );
          assert.isTrue(Result.isFailure(result));
          assert.isTrue(h.sockets[0]!.closed);
        }
      }),
    ),
  );
  it.effect("bounds bind and response waits and closes on timeout/interruption", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const options of [{}, { bind: "hang" }, { send: "hang" }] as const) {
          const h = yield* harness(options);
          const pending = yield* h.transport
            .exchange(device, 101, Buffer.alloc(0), 107, 2000)
            .pipe(Effect.result, Effect.forkChild);
          yield* Deferred.await(h.created);
          yield* TestClock.adjust("3 seconds");
          const result = yield* Fiber.join(pending);
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result))
            assert.strictEqual(result.failure.reason, "LIFX request timed out");
          assert.isTrue(h.sockets[0]!.closed);
        }
        const h = yield* harness();
        const pending = yield* h.transport
          .exchange(device, 101, Buffer.alloc(0), 107, 2000)
          .pipe(Effect.forkChild);
        yield* Deferred.await(h.created);
        yield* Fiber.interrupt(pending);
        assert.isTrue(h.sockets[0]!.closed);
      }),
    ),
  );
  it.effect("fails sync/async bind and send failures and can recover on a fresh socket", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const options of [
          { bind: "throw" },
          { bind: "error" },
          { send: "throw" },
          { send: "callback" },
          { send: "error" },
        ] as const) {
          const h = yield* harness(options);
          const result = yield* Effect.result(
            h.transport.exchange(device, 101, Buffer.alloc(0), 107, 2000),
          );
          assert.isTrue(Result.isFailure(result));
          assert.isTrue(h.sockets[0]!.closed);
        }
        const h = yield* harness({ onSend: (packet, socket) => socket.reply(response(packet)) });
        for (let i = 0; i < 2; i++)
          yield* h.transport.exchange(device, 101, Buffer.alloc(0), 107, 2000);
        assert.strictEqual(h.sockets.length, 2);
        assert.isTrue(h.sockets.every((socket) => socket.closed));
      }),
    ),
  );
  it.effect("validates target and timeout before creating sockets", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        for (const target of [
          { ...device, address: "localhost" },
          { ...device, port: 0 },
        ])
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(h.transport.exchange(target, 101, Buffer.alloc(0), 107, 2000)),
            ),
          );
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(h.transport.exchange(device, 101, Buffer.alloc(0), 107, 0)),
          ),
        );
        assert.strictEqual(h.sockets.length, 0);
      }),
    ),
  );
  it.effect("engine scope disposal terminates in-flight exchanges and prevents resurrection", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const options of [{}, { bind: "hang", deferClose: true }, { send: "hang" }] as const) {
          const scope = yield* Scope.make();
          const h = yield* harness(options).pipe(Effect.provideService(Scope.Scope, scope));
          const pending = yield* h.transport
            .exchange(device, 101, Buffer.alloc(0), 107, 2000)
            .pipe(Effect.result, Effect.forkChild);
          yield* Deferred.await(h.created);
          if ("bind" in options) {
            while (!h.sockets[0]!.bound) yield* Effect.yieldNow;
          } else {
            while (h.sockets[0]!.sent.length === 0) yield* Effect.yieldNow;
          }
          yield* Scope.close(scope, Exit.void);
          assert.isTrue(Result.isFailure(yield* Fiber.join(pending)));
          assert.isTrue(h.sockets[0]!.closed);
          if ("bind" in options) {
            h.sockets[0]!.emit("listening");
            assert.strictEqual(h.sockets[0]!.sent.length, 0);
            assert.strictEqual(h.sockets[0]!.listenerCount("message"), 0);
          }
          const error = yield* Effect.flip(
            h.transport.exchange(device, 101, Buffer.alloc(0), 107, 2000),
          );
          assert.instanceOf(error, LIFXFailure);
          assert.strictEqual(error.reason, "LIFX transport is closed");
          assert.strictEqual(h.sockets.length, 1);
        }
      }),
    ),
  );
  it.effect("engine disposal waits for a successful exchange already closing its scope", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const closing = yield* Deferred.make<void>(),
          release = yield* Deferred.make<void>();
        const raw = new MockSocket({ onSend: (packet, socket) => socket.reply(response(packet)) });
        const udpContext = yield* Layer.build(
          udpLayer.pipe(Layer.provide(Layer.succeed(SocketFactory)(() => raw))),
        );
        const udp = yield* UdpSocket.pipe(Effect.provideContext(udpContext));
        const instrumented = Layer.succeed(UdpSocket)({
          open: (options) =>
            udp
              .open(options)
              .pipe(
                Effect.tap(() =>
                  Effect.addFinalizer(() =>
                    Deferred.succeed(closing, undefined).pipe(
                      Effect.andThen(Deferred.await(release)),
                    ),
                  ),
                ),
              ),
        });
        const engineScope = yield* Scope.make();
        const built = yield* Layer.build(layer.pipe(Layer.provide(instrumented))).pipe(
          Effect.provideService(Scope.Scope, engineScope),
        );
        const transport = yield* Transport.pipe(Effect.provideContext(built));
        const request = yield* transport
          .exchange(device, 101, Buffer.alloc(0), 107, 2000)
          .pipe(Effect.forkChild);
        yield* Deferred.await(closing);
        assert.isFalse(raw.closed);
        let disposed = false;
        const disposal = yield* Scope.close(engineScope, Exit.void).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              disposed = true;
            }),
          ),
          Effect.forkChild,
        );
        for (let i = 0; i < 10; i++) yield* Effect.yieldNow;
        // Release before asserting so a failing regression cannot strand an uninterruptible finalizer.
        const returnedBeforeClose = disposed;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(request);
        yield* Fiber.join(disposal);
        assert.isFalse(returnedBeforeClose);
        assert.isTrue(disposed);
        assert.isTrue(raw.closed);
      }),
    ),
  );
  it.effect(
    "engine disposal awaits cleanup paused immediately after the exchange scope becomes Closed",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const paused = yield* Deferred.make<void>();
          const raw = new MockSocket({
            onSend: (packet, socket) => socket.reply(response(packet)),
          });
          const udpContext = yield* Layer.build(
            udpLayer.pipe(Layer.provide(Layer.succeed(SocketFactory)(() => raw))),
          );
          const udp = yield* UdpSocket.pipe(Effect.provideContext(udpContext));
          let exchangeScope: Scope.Scope | undefined;
          const instrumented = Layer.succeed(UdpSocket)({
            open: Effect.fnUntraced(function* (options) {
              exchangeScope = yield* Scope.Scope;
              return yield* udp.open(options);
            }),
          });
          const engineScope = yield* Scope.make();
          const built = yield* Layer.build(layer.pipe(Layer.provide(instrumented))).pipe(
            Effect.provideService(Scope.Scope, engineScope),
          );
          const transport = yield* Transport.pipe(Effect.provideContext(built));
          const scheduler = new Scheduler.MixedScheduler();
          let didPause = false;
          scheduler.shouldYield = () => {
            if (exchangeScope?.state._tag === "Closed" && !raw.closed && !didPause) {
              didPause = true;
              Deferred.doneUnsafe(paused, Effect.void);
              return true;
            }
            return false;
          };
          const request = yield* transport
            .exchange(device, 101, Buffer.alloc(0), 107, 2000)
            .pipe(Effect.provideService(Scheduler.Scheduler, scheduler), Effect.forkChild);
          yield* Effect.raceFirst(Deferred.await(paused), Fiber.await(request));
          yield* Scope.close(engineScope, Exit.void);
          const closedAtDisposal = raw.closed;
          yield* Fiber.join(request);
          assert.isTrue(closedAtDisposal);
        }),
      ),
  );
  it.effect("talks to a real loopback UDP bulb using the production Node transport", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bulb = yield* Effect.acquireRelease(
          Effect.sync(() => createSocket("udp4")),
          (socket) =>
            Effect.sync(() => {
              socket.close();
            }),
        );
        yield* Effect.callback<void, LIFXFailure>((resume) => {
          bulb.once("error", () => resume(new LIFXFailure({ reason: "Mock bulb bind failed" })));
          bulb.bind(0, "127.0.0.1", () => resume(Effect.void));
        });
        const packets: Buffer[] = [];
        bulb.on("message", (packet, peer) => {
          packets.push(packet);
          const type = packet.readUInt16LE(32);
          bulb.send(
            response(
              packet,
              type === 101 ? 107 : 45,
              type === 101 ? response(packet).subarray(36) : Buffer.alloc(0),
            ),
            peer.port,
            peer.address,
          );
        });
        const built = yield* Layer.build(nodeLayer);
        const transport = yield* Transport.pipe(Effect.provideContext(built));
        const target = { ...device, address: "127.0.0.1", port: bulb.address().port };
        const payload = yield* transport.exchange(target, 101, Buffer.alloc(0), 107, 2000);
        assert.strictEqual(payload.length, 52);
        yield* transport.exchange(target, 117, Buffer.from("ffff00000000", "hex"), 45, 2000);
        assert.deepStrictEqual(
          packets.map((packet) => packet.readUInt16LE(32)),
          [101, 117],
        );
        assert.deepStrictEqual(
          packets.map((packet) => packet[22]),
          [1, 2],
        );
      }),
    ),
  );
});
