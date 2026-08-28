import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Result, Scheduler, Scope } from "effect";
import { TestClock } from "effect/testing";
import { createSocket } from "node:dgram";
import { EventEmitter } from "node:events";

import { layer, nodeLayer, SocketFactory, UdpSocket, type RawSocket } from "../src/index.ts";

const peer = { address: "127.0.0.1", port: 56700 };
const bytes = new Uint8Array([1, 2, 3]);

class MockSocket extends EventEmitter implements RawSocket {
  bound = false;
  closed = false;
  closeCalls = 0;
  bindFailed = false;
  sent = 0;
  sendCallback: ((error: Error | null) => void) | undefined;
  constructor(
    readonly options: {
      readonly bind?: "throw" | "error" | "hang";
      readonly send?: "throw" | "callback" | "hang";
      readonly deferClose?: boolean;
      readonly immediateReply?: boolean;
    } = {},
  ) {
    super();
  }
  bind() {
    if (this.options.bind === "throw") throw new Error("bind failed");
    this.bound = true;
    queueMicrotask(() => {
      if (this.closed) return;
      if (this.options.bind === "error") this.emit("error", new Error("bind failed"));
      else if (this.options.bind !== "hang") this.emit("listening");
    });
  }
  address() {
    return { address: "127.0.0.1", port: 12345 };
  }
  send(
    _data: Uint8Array,
    _port: number,
    _address: string,
    callback: (error: Error | null) => void,
  ) {
    if (this.options.send === "throw") throw new Error("send failed");
    this.sent++;
    this.sendCallback = callback;
    if (this.options.immediateReply) this.emit("message", bytes, peer);
    if (this.options.send !== "hang")
      callback(this.options.send === "callback" ? new Error("send failed") : null);
  }
  close() {
    this.closeCalls++;
    if (this.closed) {
      if (this.bindFailed) throw new Error("Socket is not running");
      return;
    }
    this.closed = true;
    if (this.options.deferClose) this.once("listening", () => this.emit("close"));
    else this.emit("close");
  }
}

const harness = Effect.fnUntraced(function* (
  options?: ConstructorParameters<typeof MockSocket>[0],
) {
  const raws: MockSocket[] = [];
  const created = yield* Deferred.make<void>();
  const built = yield* Layer.build(
    layer.pipe(
      Layer.provide(
        Layer.succeed(SocketFactory)(() => {
          const raw = new MockSocket(options);
          raws.push(raw);
          Deferred.doneUnsafe(created, Effect.void);
          return raw;
        }),
      ),
    ),
  );
  const udp = yield* UdpSocket.pipe(Effect.provideContext(built));
  return { udp, raws, created };
});

describe("Effect Node UDP", () => {
  it.effect("mounts inertly and queues copied immediate replies before receive starts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ immediateReply: true });
        assert.strictEqual(h.raws.length, 0);
        const socket = yield* h.udp.open();
        assert.deepStrictEqual(socket.localAddress, { address: "127.0.0.1", port: 12345 });
        yield* socket.send(bytes, peer);
        assert.deepStrictEqual(yield* socket.receive, { data: bytes, peer });
        const data = new Uint8Array([4]);
        h.raws[0]!.emit("message", data, peer);
        data[0] = 9;
        assert.deepStrictEqual((yield* socket.receive).data, new Uint8Array([4]));
        yield* socket.close;
        yield* socket.close;
        assert.strictEqual(h.raws[0]!.closeCalls, 1);
        assert.strictEqual(h.raws[0]!.listenerCount("message"), 0);
        assert.strictEqual(h.raws[0]!.listenerCount("error"), 0);
      }),
    ),
  );

  it.effect("rejects invalid capacity before allocation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        for (const capacity of [0, -1, 0.5, Infinity, NaN]) {
          const result = yield* Effect.result(h.udp.open({ capacity }));
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Open");
        }
        assert.strictEqual(h.raws.length, 0);
      }),
    ),
  );

  it.effect("rejects invalid original bind ports and addresses before allocation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        for (const port of [-65536, -1, 65536, 0.5, NaN, Infinity, -Infinity]) {
          const result = yield* Effect.result(h.udp.open({ port }));
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Bind");
        }
        for (const address of ["", "localhost", " ", "::1"]) {
          const result = yield* Effect.result(h.udp.open({ type: "udp4", address }));
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Bind");
        }
        assert.strictEqual(h.raws.length, 0);
        yield* h.udp.open({ port: 0 });
        yield* h.udp.open({ port: 65535 });
        assert.strictEqual(h.raws.length, 2);
      }),
    ),
  );

  it.effect("rejects invalid original peer inputs without submitting any send", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        for (const invalid of [
          ...["", "localhost", " "].map((address) => ({ ...peer, address })),
          ...[0, -1, 65536, 0.5, NaN, Infinity, -Infinity].map((port) => ({ ...peer, port })),
        ]) {
          const socket = yield* h.udp.open();
          const sent = yield* Effect.result(socket.send(bytes, invalid));
          assert.isTrue(Result.isFailure(sent));
          const received = yield* Effect.result(socket.receive);
          assert.isTrue(Result.isFailure(received));
          if (Result.isFailure(sent) && Result.isFailure(received)) {
            assert.strictEqual(sent.failure.reason, "Send");
            assert.strictEqual(sent.failure, received.failure);
          }
        }
        assert.isTrue(h.raws.every((raw) => raw.closed && raw.sent === 0));
      }),
    ),
  );

  it.effect("cleans an interrupted allocation before the caller scope closes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const raw = new MockSocket();
        const built = yield* Layer.build(
          layer.pipe(
            Layer.provide(
              Layer.succeed(SocketFactory)(() => {
                Fiber.getCurrent()?.interruptUnsafe();
                return raw;
              }),
            ),
          ),
        );
        const udp = yield* UdpSocket.pipe(Effect.provideContext(built));
        const request = yield* udp.open().pipe(Effect.forkChild);
        assert.isTrue(Exit.isFailure(yield* Fiber.await(request)));
        assert.isTrue(raw.closed);
        assert.isFalse(raw.bound);
        assert.strictEqual(raw.listenerCount("message"), 0);
        assert.strictEqual(raw.listenerCount("error"), 0);
      }),
    ),
  );

  it.effect(
    "cleans a real bound socket interrupted between listening and returning from open",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (let target = 1; target <= 15; target++) {
            let listening = false,
              operations = 0,
              interrupted = false,
              armed = true;
            const raw = createSocket({
              type: "udp4",
              lookup: (address, _options, callback) => callback(null, address, 4),
            });
            // Keep the outer scope open through the assertions, but clean failed regressions too.
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                try {
                  raw.close();
                } catch {
                  /* Already closed. */
                }
              }),
            );
            raw.once("listening", () => {
              listening = true;
            });
            const defaultScheduler = yield* Scheduler.Scheduler;
            const scheduler: Scheduler.Scheduler = {
              executionMode: defaultScheduler.executionMode,
              makeDispatcher: () => defaultScheduler.makeDispatcher(),
              shouldYield: (fiber) => {
                if (listening && armed && !interrupted && ++operations === target) {
                  interrupted = true;
                  queueMicrotask(() => fiber.interruptUnsafe());
                  return true;
                }
                return false;
              },
            };
            const built = yield* Layer.build(
              layer.pipe(Layer.provide(Layer.succeed(SocketFactory)(() => raw))),
            );
            const udp = yield* UdpSocket.pipe(Effect.provideContext(built));
            const request = yield* udp
              .open({ address: "127.0.0.1" })
              .pipe(Effect.provideService(Scheduler.Scheduler, scheduler), Effect.forkChild);
            const result = yield* Fiber.await(request);
            armed = false;
            assert.isTrue(listening);
            if (interrupted) {
              assert.isTrue(Exit.isFailure(result));
              assert.throws(
                () => raw.address(),
                undefined,
                undefined,
                `Interrupted at operation ${target}`,
              );
            } else {
              assert.isTrue(Exit.isSuccess(result));
            }
          }
        }),
      ),
  );

  it.effect("closes a socket if listener installation throws before acquisition finishes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const raw = new MockSocket();
        const on = raw.on.bind(raw);
        raw.on = (event, listener) => {
          if (event === "listening") throw new Error("listener installation failed");
          return on(event, listener);
        };
        const built = yield* Layer.build(
          layer.pipe(Layer.provide(Layer.succeed(SocketFactory)(() => raw))),
        );
        const udp = yield* UdpSocket.pipe(Effect.provideContext(built));
        const result = yield* Effect.result(udp.open());
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Open");
        assert.isTrue(raw.closed);
        assert.isFalse(raw.bound);
        assert.strictEqual(raw.listenerCount("message"), 0);
        assert.strictEqual(raw.listenerCount("error"), 0);
      }),
    ),
  );

  it.effect(
    "overflow fails buffered and future receives and sends with the same terminal error",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          const socket = yield* h.udp.open({ capacity: 1 });
          h.raws[0]!.emit("message", bytes, peer);
          h.raws[0]!.emit("message", bytes, peer);
          const first = yield* Effect.result(socket.receive);
          const second = yield* Effect.result(socket.send(bytes, peer));
          assert.isTrue(Result.isFailure(first));
          assert.isTrue(Result.isFailure(second));
          if (Result.isFailure(first) && Result.isFailure(second)) {
            assert.strictEqual(first.failure.reason, "Overflow");
            assert.strictEqual(first.failure, second.failure);
          }
          assert.isTrue(h.raws[0]!.closed);
          assert.strictEqual(h.raws[0]!.sent, 0);
        }),
      ),
  );

  it.effect("close unblocks all pending receives and sends even without a Node close event", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ send: "hang", deferClose: true });
        const socket = yield* h.udp.open();
        const receive1 = yield* socket.receive.pipe(Effect.result, Effect.forkChild);
        const receive2 = yield* socket.receive.pipe(Effect.result, Effect.forkChild);
        const send = yield* socket.send(bytes, peer).pipe(Effect.result, Effect.forkChild);
        while (h.raws[0]!.sent === 0) yield* Effect.yieldNow;
        yield* socket.close;
        for (const result of [
          yield* Fiber.join(receive1),
          yield* Fiber.join(receive2),
          yield* Fiber.join(send),
          yield* Effect.result(socket.receive),
          yield* Effect.result(socket.send(bytes, peer)),
        ]) {
          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") assert.strictEqual(result.failure.reason, "Closed");
        }
        h.raws[0]!.sendCallback?.(null);
        assert.strictEqual(h.raws[0]!.sent, 1);
        h.raws[0]!.emit("close");
        assert.strictEqual(h.raws[0]!.listenerCount("error"), 0);
      }),
    ),
  );

  it.effect("errors between receives persist and unblock pending sends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ send: "hang" });
        const socket = yield* h.udp.open();
        const send = yield* socket.send(bytes, peer).pipe(Effect.result, Effect.forkChild);
        while (h.raws[0]!.sent === 0) yield* Effect.yieldNow;
        const cause = new Error("socket failed");
        h.raws[0]!.emit("error", cause);
        const first = yield* Fiber.join(send);
        const second = yield* Effect.result(socket.receive);
        assert.isTrue(Result.isFailure(first));
        assert.isTrue(Result.isFailure(second));
        if (Result.isFailure(first) && Result.isFailure(second)) {
          assert.strictEqual(first.failure.reason, "Receive");
          assert.strictEqual(first.failure.cause, cause);
          assert.strictEqual(first.failure, second.failure);
        }
        assert.isTrue(h.raws[0]!.closed);
      }),
    ),
  );

  it.effect("cleans failed bind and send paths immediately and allows fresh sockets", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const options of [
          { bind: "throw" },
          { bind: "error" },
          { send: "throw" },
          { send: "callback" },
        ] as const) {
          const h = yield* harness(options);
          for (let i = 0; i < 2; i++) {
            const result = yield* Effect.result(
              Effect.gen(function* () {
                const socket = yield* h.udp.open();
                yield* socket.send(bytes, peer);
              }),
            );
            assert.isTrue(Result.isFailure(result));
            assert.isTrue(h.raws[i]!.closed);
            assert.strictEqual(h.raws[i]!.listenerCount("message"), 0);
          }
        }
      }),
    ),
  );

  it.effect(
    "cancels a bind without waiting for the caller scope and never sends on late listening",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness({ bind: "hang", deferClose: true });
          const request = yield* h.udp.open().pipe(
            Effect.flatMap((socket) => socket.send(bytes, peer)),
            Effect.forkChild,
          );
          yield* Deferred.await(h.created);
          while (!h.raws[0]!.bound) yield* Effect.yieldNow;
          yield* Fiber.interrupt(request);
          assert.isTrue(h.raws[0]!.closed);
          h.raws[0]!.emit("listening");
          assert.strictEqual(h.raws[0]!.sent, 0);
          assert.strictEqual(h.raws[0]!.listenerCount("message"), 0);
        }),
      ),
  );

  it.effect("scope disposal unblocks an open that is still binding", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ bind: "hang" });
        const scope = yield* Scope.make();
        const request = yield* h.udp
          .open()
          .pipe(Effect.provideService(Scope.Scope, scope), Effect.result, Effect.forkChild);
        yield* Deferred.await(h.created);
        while (!h.raws[0]!.bound) yield* Effect.yieldNow;
        yield* Scope.close(scope, Exit.void);
        const result = yield* Fiber.join(request);
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Closed");
        assert.isTrue(h.raws[0]!.closed);
      }),
    ),
  );

  it.effect("cleans up when a cancelled pending bind later fails instead of listening", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ bind: "hang", deferClose: true });
        const request = yield* h.udp.open().pipe(Effect.forkChild);
        yield* Deferred.await(h.created);
        while (!h.raws[0]!.bound) yield* Effect.yieldNow;
        yield* Fiber.interrupt(request);
        h.raws[0]!.bindFailed = true;
        h.raws[0]!.emit("error", new Error("Late bind error"));
        assert.strictEqual(h.raws[0]!.closeCalls, 2);
        assert.strictEqual(h.raws[0]!.listenerCount("message"), 0);
        assert.strictEqual(h.raws[0]!.listenerCount("error"), 0);
        assert.strictEqual(h.raws[0]!.sent, 0);
      }),
    ),
  );

  it.effect("timeout closes a hung bind and interrupted send callbacks are detached", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ bind: "hang" });
        const request = yield* h.udp
          .open()
          .pipe(Effect.timeout("1 second"), Effect.result, Effect.forkChild);
        yield* Deferred.await(h.created);
        yield* TestClock.adjust("2 seconds");
        assert.isTrue(Result.isFailure(yield* Fiber.join(request)));
        assert.isTrue(h.raws[0]!.closed);
        const sending = yield* harness({ send: "hang" });
        const socket = yield* sending.udp.open();
        const send = yield* socket.send(bytes, peer).pipe(Effect.forkChild);
        while (sending.raws[0]!.sent === 0) yield* Effect.yieldNow;
        yield* Fiber.interrupt(send);
        sending.raws[0]!.sendCallback?.(new Error("late send failure"));
        sending.raws[0]!.emit("message", bytes, peer);
        assert.deepStrictEqual((yield* socket.receive).data, bytes);
        assert.strictEqual(sending.raws[0]!.sent, 1);
      }),
    ),
  );

  it.effect("exchanges real IPv4 and IPv6 loopback datagrams with ephemeral source ports", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const udp = yield* UdpSocket;
        for (const [type, address] of [
          ["udp4", "127.0.0.1"],
          ["udp6", "::1"],
        ] as const) {
          const server = yield* udp.open({ type, address });
          const client = yield* udp.open({ type, address });
          assert.isAbove(server.localAddress.port, 0);
          assert.notStrictEqual(server.localAddress.port, client.localAddress.port);
          yield* client.send(bytes, server.localAddress);
          const incoming = yield* server.receive;
          assert.deepStrictEqual(incoming, { data: bytes, peer: client.localAddress });
          yield* server.send(incoming.data, incoming.peer);
          assert.deepStrictEqual(yield* client.receive, { data: bytes, peer: server.localAddress });
          yield* client.close;
          assert.isTrue(Result.isFailure(yield* Effect.result(client.receive)));
        }
      }).pipe(Effect.provide(nodeLayer)),
    ),
  );

  it.effect("real failed binds release their resources and DNS peers are rejected", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const udp = yield* UdpSocket;
        const first = yield* udp.open({ address: "127.0.0.1" });
        const conflict = yield* Effect.result(udp.open(first.localAddress));
        assert.isTrue(Result.isFailure(conflict));
        if (Result.isFailure(conflict)) assert.strictEqual(conflict.failure.reason, "Bind");
        const fresh = yield* udp.open({ address: "127.0.0.1" });
        const dns = yield* Effect.result(
          fresh.send(bytes, { address: "localhost", port: first.localAddress.port }),
        );
        assert.isTrue(Result.isFailure(dns));
        if (Result.isFailure(dns)) assert.strictEqual(dns.failure.reason, "Send");
      }).pipe(Effect.provide(nodeLayer)),
    ),
  );
});
