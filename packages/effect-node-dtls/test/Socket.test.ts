import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Result,
  Scheduler,
  Scope,
} from "effect";
import { UdpError, UdpSocket, type Datagram } from "effect-node-udp";
import { TestClock } from "effect/testing";

import { handshake, HandshakeType } from "../src/DTLS/Handshake.js";
import { ContentType, parseRecords } from "../src/DTLS/RecordLayer.js";
import { DtlsClient, layer, type Options } from "../src/index.js";
import { options, Peer } from "./Peer.js";

const harness = Effect.fnUntraced(function* (
  config: {
    readonly silence?: boolean;
    readonly hangOpen?: boolean;
    readonly failSend?: boolean;
    readonly interruptOnOpen?: boolean;
    readonly closeDelay?: Effect.Effect<void>;
    readonly scopeFinalizer?: Effect.Effect<void>;
    readonly peer?: ConstructorParameters<typeof Peer>[0];
  } = {},
) {
  const queue = yield* Queue.unbounded<Datagram, UdpError>();
  const opened = yield* Deferred.make<void>();
  const closed = yield* Deferred.make<never, UdpError>();
  const peer = new Peer(config.peer);
  let allocated = 0;
  let closeCalls = 0;
  let sends = 0;
  let received = 0;
  let hangSend = false;
  let failedSend = false;
  const sentPackets: Buffer[] = [];
  let terminal = false;
  let closeCompleted = false;
  const close = Effect.gen(function* () {
    const first = yield* Effect.sync(() => {
      if (terminal) return false;
      terminal = true;
      closeCalls++;
      const error = new UdpError({ reason: "Closed", cause: "test transport closed" });
      Queue.failCauseUnsafe(queue, Cause.fail(error));
      Deferred.doneUnsafe(closed, Effect.fail(error));
      return true;
    });
    if (!first) return;
    if (config.closeDelay) yield* config.closeDelay;
    closeCompleted = true;
  });
  const emit = (data: Buffer, address: string = options.address, port: number = options.port) => {
    Queue.offerUnsafe(queue, { data, peer: { address, port } });
  };
  const built = yield* Layer.build(
    layer.pipe(
      Layer.provide(
        Layer.succeed(UdpSocket)({
          open: Effect.fnUntraced(function* () {
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                allocated++;
                if (config.interruptOnOpen) Fiber.getCurrent()?.interruptUnsafe();
              }),
              () => close,
            );
            const scopeFinalizer = config.scopeFinalizer;
            if (scopeFinalizer) yield* Effect.addFinalizer(() => scopeFinalizer);
            yield* Deferred.succeed(opened, undefined);
            if (config.hangOpen) return yield* Deferred.await(closed);
            return {
              localAddress: { address: "127.0.0.1", port: 12345 },
              send: Effect.fnUntraced(function* (data: Uint8Array, destination: Datagram["peer"]) {
                sends++;
                sentPackets.push(Buffer.from(data));
                if (hangSend) return yield* Effect.never;
                if (failedSend || config.failSend)
                  return yield* new UdpError({ reason: "Send", cause: "test send failure" });
                if (!config.silence)
                  for (const response of peer.receive(Buffer.from(data)))
                    emit(response, destination.address, destination.port);
              }),
              receive: Queue.take(queue).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    received++;
                  }),
                ),
              ),
              close,
            };
          }),
        }),
      ),
    ),
  );
  const dtls = yield* DtlsClient.pipe(Effect.provideContext(built));
  return {
    dtls,
    peer,
    emit,
    opened,
    queue,
    sentPackets,
    get allocated() {
      return allocated;
    },
    get closeCalls() {
      return closeCalls;
    },
    get sends() {
      return sends;
    },
    get received() {
      return received;
    },
    get closeCompleted() {
      return closeCompleted;
    },
    hangSend: () => {
      hangSend = true;
    },
    resumeSend: () => {
      hangSend = false;
    },
    failSend: () => {
      failedSend = true;
    },
  };
});

describe("Scoped DTLS sockets", () => {
  it.effect(
    "mounts inertly, establishes cookie/no-cookie handshakes, and exchanges authenticated data",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const cookie of [true, false]) {
            const h = yield* harness({ peer: { cookie } });
            assert.strictEqual(h.allocated, 0);
            const socket = yield* h.dtls.connect(options);
            assert.isTrue(socket.isOpen());
            assert.strictEqual(h.allocated, 1);
            yield* socket.send(Buffer.from("request"));
            assert.strictEqual(h.peer.application[0]?.toString(), "request");
            h.emit(h.peer.applicationData("response"));
            assert.strictEqual(Buffer.from(yield* socket.receive).toString(), "response");
            yield* socket.close;
            yield* socket.close;
            assert.isFalse(socket.isOpen());
            assert.strictEqual(h.closeCalls, 1);
          }
        }),
      ),
  );

  it.effect("validates before allocation and copies caller-owned binary PSKs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        for (const invalid of [
          { address: "localhost" },
          { port: 0 },
          { port: 1.5 },
          { identity: "" },
          { identity: "\u00ff" },
          { psk: "" },
          { psk: new Uint8Array(257) },
          { timeoutMs: 0 },
          { timeoutMs: Infinity },
        ] satisfies Partial<Options>[]) {
          const result = yield* Effect.result(h.dtls.connect({ ...options, ...invalid }));
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Options");
        }
        assert.strictEqual(h.allocated, 0);
        const psk = Buffer.from(options.psk);
        yield* h.dtls.connect({ ...options, psk });
        assert.strictEqual(psk.toString(), options.psk);
      }),
    ),
  );

  it.effect("bounds allocation/handshake with one timeout and closes immediately on failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const config of [{ silence: true }, { hangOpen: true }, { failSend: true }]) {
          const h = yield* harness(config);
          const request = yield* h.dtls.connect(options).pipe(Effect.result, Effect.forkChild);
          yield* Deferred.await(h.opened);
          if (!config.failSend) yield* TestClock.adjust(1000);
          const result = yield* Fiber.join(request);
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result))
            assert.strictEqual(result.failure.reason, config.failSend ? "Transport" : "Timeout");
          assert.strictEqual(h.closeCalls, 1);
          if (config.silence) assert.strictEqual(h.sends, 1); // No fictitious flight retransmission.
        }
      }),
    ),
  );

  it.effect("interrupts allocation and handshake without waiting for the caller scope", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const config of [{ silence: true }, { hangOpen: true }]) {
          const h = yield* harness(config);
          const request = yield* h.dtls.connect(options).pipe(Effect.forkChild);
          yield* Deferred.await(h.opened);
          yield* Fiber.interrupt(request);
          assert.strictEqual(h.closeCalls, 1);
          const sends = h.sends;
          h.emit(Buffer.from("late"));
          yield* Effect.yieldNow;
          assert.strictEqual(h.sends, sends);
        }
      }),
    ),
  );

  it.effect("scope disposal closes established sockets and wakes every receiver", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        const scope = yield* Scope.make();
        const socket = yield* h.dtls.connect(options).pipe(Scope.provide(scope));
        const receiver1 = yield* socket.receive.pipe(Effect.result, Effect.forkChild);
        const receiver2 = yield* socket.receive.pipe(Effect.result, Effect.forkChild);
        yield* Scope.close(scope, Exit.void);
        assert.isFalse(socket.isOpen());
        for (const result of [
          yield* Fiber.join(receiver1),
          yield* Fiber.join(receiver2),
          yield* Effect.result(socket.receive),
        ]) {
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Closed");
        }
        assert.strictEqual(h.closeCalls, 1);
      }),
    ),
  );

  it.effect(
    "cleans interruption during acquisition and scheduler yields through handshake return",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const immediate = yield* harness({ interruptOnOpen: true });
          const request = yield* immediate.dtls.connect(options).pipe(Effect.forkChild);
          assert.isTrue(Exit.isFailure(yield* Fiber.await(request)));
          assert.strictEqual(immediate.closeCalls, 1);
          assert.isTrue(immediate.closeCompleted);
          const defaultScheduler = yield* Scheduler.Scheduler;
          for (const stage of ["allocated", "finished"] as const) {
            for (let target = 1; target <= 250; target++) {
              const h = yield* harness();
              let operations = 0;
              let interrupted = false;
              let testing = true;
              const scheduler: Scheduler.Scheduler = {
                executionMode: defaultScheduler.executionMode,
                makeDispatcher: () => defaultScheduler.makeDispatcher(),
                shouldYield: (fiber) => {
                  const active =
                    stage === "allocated" ? h.allocated > 0 : h.peer.finished !== undefined;
                  if (testing && active && !interrupted && ++operations === target) {
                    interrupted = true;
                    queueMicrotask(() => fiber.interruptUnsafe());
                    return true;
                  }
                  return false;
                },
              };
              const pending = yield* h.dtls
                .connect(options)
                .pipe(Effect.provideService(Scheduler.Scheduler, scheduler), Effect.forkChild);
              yield* TestClock.adjust(1000);
              const result = yield* Fiber.await(pending);
              testing = false;
              if (Exit.isFailure(result)) {
                assert.strictEqual(h.closeCalls, 1, `${stage} operation ${target}`);
                assert.isTrue(h.closeCompleted, `${stage} operation ${target}`);
              } else {
                yield* result.value.close;
              }
            }
          }
        }),
      ),
  );

  it.effect("concurrent close calls all await actual asynchronous cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>();
        const h = yield* harness({ closeDelay: Deferred.await(release) });
        const socket = yield* h.dtls.connect(options);
        let completions = 0;
        const closing = socket.close.pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              completions++;
            }),
          ),
        );
        const first = yield* closing.pipe(Effect.forkChild);
        while (!h.closeCalls) yield* Effect.yieldNow;
        const second = yield* closing.pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        assert.isFalse(socket.isOpen());
        assert.strictEqual(completions, 0);
        assert.isFalse(h.closeCompleted);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        assert.strictEqual(completions, 2);
        assert.isTrue(h.closeCompleted);
        assert.strictEqual(h.closeCalls, 1);
      }),
    ),
  );

  it.effect(
    "interrupted close completes gated scope finalizers before subsequent close returns",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const gate = yield* Deferred.make<void>();
          let finalized = false;
          const h = yield* harness({
            scopeFinalizer: Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(gate);
              finalized = true;
            }),
          });
          const socket = yield* h.dtls.connect(options);
          const first = yield* socket.close.pipe(Effect.forkChild);
          yield* Deferred.await(entered);
          assert.isFalse(socket.isOpen());
          assert.isTrue(h.closeCompleted);
          first.interruptUnsafe();
          yield* Effect.yieldNow;
          yield* Deferred.succeed(gate, undefined);
          assert.isTrue(Exit.isFailure(yield* Fiber.await(first)));
          assert.isTrue(finalized);
          yield* socket.close;
          assert.strictEqual(h.closeCalls, 1);
        }),
      ),
  );

  it.effect("scheduler interruption after transport close cannot strand scope completion", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const defaultScheduler = yield* Scheduler.Scheduler;
        let interruptions = 0;
        for (let target = 1; target <= 60; target++) {
          let finalized = false;
          const h = yield* harness({
            scopeFinalizer: Effect.sync(() => {
              finalized = true;
            }),
          });
          const socket = yield* h.dtls.connect(options);
          let operations = 0;
          let interrupted = false;
          let testing = true;
          const scheduler: Scheduler.Scheduler = {
            executionMode: defaultScheduler.executionMode,
            makeDispatcher: () => defaultScheduler.makeDispatcher(),
            shouldYield: (fiber) => {
              if (testing && h.closeCompleted && !interrupted && ++operations === target) {
                interrupted = true;
                interruptions++;
                queueMicrotask(() => fiber.interruptUnsafe());
                return true;
              }
              return false;
            },
          };
          const first = yield* socket.close.pipe(
            Effect.provideService(Scheduler.Scheduler, scheduler),
            Effect.forkChild,
          );
          yield* Fiber.await(first);
          testing = false;
          assert.isTrue(h.closeCompleted, `close operation ${target}`);
          assert.isTrue(finalized, `close operation ${target}`);
          const again = yield* socket.close.pipe(
            Effect.timeoutOrElse({
              duration: 1000,
              orElse: () => Effect.fail(new Error(`Stranded close at operation ${target}`)),
            }),
            Effect.forkChild,
          );
          yield* TestClock.adjust(1000);
          yield* Fiber.join(again);
          assert.strictEqual(h.closeCalls, 1);
        }
        assert.isAbove(interruptions, 0);
      }),
    ),
  );

  it.effect(
    "failed connect awaits in-progress child scope finalization despite a concurrent parent close",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const release = yield* Deferred.make<void>();
          const h = yield* harness({ silence: true, closeDelay: Deferred.await(release) });
          const scope = yield* Scope.make();
          let returned = false;
          const request = yield* h.dtls.connect(options).pipe(
            Scope.provide(scope),
            Effect.result,
            Effect.tap(() =>
              Effect.sync(() => {
                returned = true;
              }),
            ),
            Effect.forkChild,
          );
          while (!h.sends) yield* Effect.yieldNow;
          const disposing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild);
          while (!h.closeCalls) yield* Effect.yieldNow;
          yield* Effect.yieldNow;
          assert.isFalse(returned);
          assert.isFalse(h.closeCompleted);
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(disposing);
          assert.isTrue(Result.isFailure(yield* Fiber.join(request)));
          assert.isTrue(h.closeCompleted);
        }),
      ),
  );

  it.effect("close wakes blocked sends, mutex waiters and receives with one persistent error", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        const socket = yield* h.dtls.connect(options);
        h.hangSend();
        const before = h.sends;
        const sending1 = yield* socket
          .send(Buffer.from("one"))
          .pipe(Effect.result, Effect.forkChild);
        const sending2 = yield* socket
          .send(Buffer.from("two"))
          .pipe(Effect.result, Effect.forkChild);
        const receiving1 = yield* socket.receive.pipe(Effect.result, Effect.forkChild);
        const receiving2 = yield* socket.receive.pipe(Effect.result, Effect.forkChild);
        while (h.sends === before) yield* Effect.yieldNow;
        yield* socket.close;
        const results = [
          yield* Fiber.join(sending1),
          yield* Fiber.join(sending2),
          yield* Fiber.join(receiving1),
          yield* Fiber.join(receiving2),
          yield* Effect.result(socket.receive),
          yield* Effect.result(socket.send(Buffer.from("later"))),
        ];
        let first: unknown;
        for (const result of results) {
          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.strictEqual(result.failure.reason, "Closed");
            if (!first) first = result.failure;
            assert.strictEqual(result.failure, first);
          }
        }
        assert.strictEqual(h.sends, before + 1);
        assert.strictEqual(h.closeCalls, 1);
      }),
    ),
  );

  it.effect("transport send/receive errors terminate and persist between operations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const sendFailure of [true, false]) {
          const h = yield* harness();
          const socket = yield* h.dtls.connect(options);
          const waiting = yield* socket.receive.pipe(Effect.result, Effect.forkChild);
          if (sendFailure) {
            h.failSend();
            assert.isTrue(Result.isFailure(yield* Effect.result(socket.send(Buffer.from("fail")))));
          } else {
            Queue.failCauseUnsafe(
              h.queue,
              Cause.fail(new UdpError({ reason: "Receive", cause: "test receive failure" })),
            );
          }
          const first = yield* Fiber.join(waiting);
          const second = yield* Effect.result(socket.send(Buffer.from("later")));
          assert.isTrue(Result.isFailure(first));
          assert.isTrue(Result.isFailure(second));
          if (Result.isFailure(first) && Result.isFailure(second)) {
            assert.strictEqual(first.failure.reason, "Transport");
            assert.strictEqual(first.failure, second.failure);
          }
          assert.isFalse(socket.isOpen());
          assert.strictEqual(h.closeCalls, 1);
        }
      }),
    ),
  );

  it.effect(
    "drops bad MACs, same-datagram replays and foreign peers without poisoning replay state",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          const socket = yield* h.dtls.connect(options);
          const packet = h.peer.applicationData("valid");
          h.emit(packet, "127.0.0.2");
          h.emit(packet, options.address, 9999);
          h.emit(Buffer.concat([packet, Buffer.from([1])])); // A truncated suffix invalidates the entire datagram.
          const bad = Buffer.from(packet);
          bad[bad.length - 1] = bad.readUInt8(bad.length - 1) ^ 1;
          h.emit(bad);
          h.emit(Buffer.concat([packet, packet]));
          h.emit(packet);
          h.emit(h.peer.applicationData("next"));
          assert.strictEqual(Buffer.from(yield* socket.receive).toString(), "valid");
          assert.strictEqual(Buffer.from(yield* socket.receive).toString(), "next");
          assert.isTrue(socket.isOpen());
          yield* socket.close;
          assert.isTrue(Result.isFailure(yield* Effect.result(socket.receive)));
        }),
      ),
  );

  it.effect(
    "ignores foreign zoned and invalid IPv6 peers without terminating an established session",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          const socket = yield* h.dtls.connect({ ...options, address: "::1" });
          for (const address of ["fe80::1%lo0", "fe80::1%en0", "fe80::1%", "not-an-ip", "[::1]"])
            h.emit(Buffer.from("not even DTLS"), address);
          h.emit(h.peer.applicationData("valid-after-foreign"), "::1");
          assert.strictEqual(Buffer.from(yield* socket.receive).toString(), "valid-after-foreign");
          assert.isTrue(socket.isOpen());
          yield* socket.close;
        }),
      ),
  );

  it.effect("canonicalizes IPv6 address bits while preserving exact configured zone identity", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const [address, canonical] of [
          ["2001:0DB8:0:0:0:0:0:1", "2001:db8::1"],
          ["fe80:0:0:0:0:0:0:1%lo0", "fe80::1%lo0"],
          ["fe80:0:0:0:0:0:0:1%1", "fe80::1%1"],
        ] as const) {
          const h = yield* harness();
          const socket = yield* h.dtls.connect({ ...options, address });
          const packet = h.peer.applicationData("same-interface");
          if (canonical.includes("%")) {
            for (const foreign of ["fe80::1", "fe80::1%en0", "fe80::1%LO0", "fe80::1%2"])
              h.emit(packet, foreign);
          }
          h.emit(packet, canonical);
          h.emit(h.peer.applicationData("next"), canonical);
          assert.strictEqual(Buffer.from(yield* socket.receive).toString(), "same-interface");
          assert.strictEqual(Buffer.from(yield* socket.receive).toString(), "next");
          assert.isTrue(socket.isOpen());
          yield* socket.close;
        }
      }),
    ),
  );

  it.effect(
    "does not establish or deliver plaintext/application data before authenticated Finished",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness({ peer: { holdFinished: true } });
          let connected = false;
          const request = yield* h.dtls.connect(options).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                connected = true;
              }),
            ),
            Effect.forkChild,
          );
          while (!h.peer.finished) yield* Effect.yieldNow;
          const before = h.received;
          h.emit(h.peer.plaintext(ContentType.applicationData, Buffer.from("cleartext")));
          h.emit(h.peer.applicationData("early-authenticated"));
          while (h.received < before + 2) yield* Effect.yieldNow;
          assert.isFalse(connected);
          const bad = Buffer.from(h.peer.finished);
          bad[bad.length - 1] = bad.readUInt8(bad.length - 1) ^ 1;
          h.emit(bad);
          h.emit(h.peer.finished);
          const socket = yield* Fiber.join(request);
          h.emit(h.peer.applicationData("after-finished"));
          assert.strictEqual(Buffer.from(yield* socket.receive).toString(), "after-finished");
          assert.isTrue(socket.isOpen());
        }),
      ),
  );

  it.effect("rejects authenticated but incorrect Finished and injected cleartext Finished", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bad = yield* harness({ peer: { badFinished: true } });
        const result = yield* Effect.result(bad.dtls.connect(options));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Protocol");
        assert.strictEqual(bad.closeCalls, 1);
        const clear = yield* harness({ silence: true });
        const request = yield* clear.dtls.connect(options).pipe(Effect.result, Effect.forkChild);
        while (!clear.sends) yield* Effect.yieldNow;
        clear.emit(
          clear.peer.plaintext(
            ContentType.handshake,
            handshake(HandshakeType.finished, 0, Buffer.alloc(12)),
          ),
        );
        const injected = yield* Fiber.join(request);
        assert.isTrue(Result.isFailure(injected));
        if (Result.isFailure(injected)) assert.strictEqual(injected.failure.reason, "Protocol");
        assert.strictEqual(clear.closeCalls, 1);
      }),
    ),
  );

  it.effect("retains the one-time epoch-zero IKEA replay workaround only when requested", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ peer: { firmwareReplay: true } });
        const socket = yield* h.dtls.connect({
          ...options,
          resetAntiReplayWindowBeforeServerHello: true,
        });
        assert.isTrue(socket.isOpen());
        const strict = yield* harness({ peer: { firmwareReplay: true } });
        const waiting = yield* strict.dtls.connect(options).pipe(Effect.result, Effect.forkChild);
        while (strict.sends < 2) yield* Effect.yieldNow;
        yield* TestClock.adjust(1000);
        const result = yield* Fiber.join(waiting);
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Timeout");
      }),
    ),
  );

  it.effect(
    "fails bounded application queue overflow, discards buffered data and preserves failure",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          const socket = yield* h.dtls.connect(options);
          for (let i = 0; i < 65; i++) h.emit(h.peer.applicationData(`packet-${i}`));
          while (socket.isOpen()) yield* Effect.yieldNow;
          const first = yield* Effect.result(socket.receive);
          const second = yield* Effect.result(socket.send(Buffer.alloc(0)));
          assert.isTrue(Result.isFailure(first));
          assert.isTrue(Result.isFailure(second));
          if (Result.isFailure(first) && Result.isFailure(second)) {
            assert.strictEqual(first.failure.reason, "Overflow");
            assert.strictEqual(first.failure, second.failure);
          }
          assert.strictEqual(h.closeCalls, 1);
        }),
      ),
  );

  it.effect("serializes concurrent sends and does not promise application retransmission", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness();
        const socket = yield* h.dtls.connect(options);
        const before = h.sends;
        yield* Effect.forEach(
          Array.from({ length: 20 }, (_, i) => i),
          (i) => socket.send(Buffer.from(String(i))),
          { concurrency: "unbounded" },
        );
        assert.strictEqual(h.sends, before + 20);
        assert.strictEqual(h.peer.application.length, 20);
        yield* TestClock.adjust(10000);
        assert.strictEqual(h.sends, before + 20);
        assert.isTrue(socket.isOpen());
        assert.strictEqual(parseRecords(h.peer.applicationData("check"))[0]?.epoch, 1);
      }),
    ),
  );

  it.effect(
    "interrupted sends reserve their sequence/nonces and leave the established session usable",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          const socket = yield* h.dtls.connect(options);
          const before = h.sends;
          h.hangSend();
          const pending = yield* socket.send(Buffer.from("cancelled")).pipe(Effect.forkChild);
          while (h.sends === before) yield* Effect.yieldNow;
          yield* Fiber.interrupt(pending);
          assert.isTrue(socket.isOpen());
          h.resumeSend();
          yield* socket.send(Buffer.from("next"));
          const cancelled = parseRecords(h.sentPackets[before]!)[0]!;
          const next = parseRecords(h.sentPackets[before + 1]!)[0]!;
          assert.strictEqual(next.sequence, cancelled.sequence + 1);
          assert.notDeepEqual(next.fragment.subarray(0, 8), cancelled.fragment.subarray(0, 8));
          assert.strictEqual(h.peer.application[0]?.toString(), "next");
        }),
      ),
  );

  it.effect(
    "accepts authenticated peer close_notify but ignores epoch-zero alerts after establishment",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          const socket = yield* h.dtls.connect(options);
          h.emit(h.peer.plaintext(ContentType.alert, Buffer.from([1, 0])));
          h.emit(h.peer.applicationData("still-open"));
          assert.strictEqual(Buffer.from(yield* socket.receive).toString(), "still-open");
          h.emit(h.peer.encrypted(ContentType.alert, Buffer.from([1, 0])));
          const result = yield* Effect.result(socket.receive);
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "Closed");
          assert.isFalse(socket.isOpen());
          yield* socket.close;
          assert.strictEqual(h.closeCalls, 1);
        }),
      ),
  );
});
