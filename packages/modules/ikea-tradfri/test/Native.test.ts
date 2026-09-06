import { assert, describe, it } from "@effect/vitest";
import * as coap from "coap-packet";
import {
  Cause,
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Queue,
  References,
  Result,
  Scope,
} from "effect";
import { DtlsClient, DtlsError, type Options, type Socket } from "effect-node-dtls";
import { TestClock } from "effect/testing";

import { IkeaFailure } from "../src/Definition.ts";
import { connect, HostResolver, type Client } from "../src/Native.ts";
import { bulb } from "./fixtures.ts";

const options = { host: "192.168.1.20", timeoutMs: 10000, identity: "identity", psk: "secret" };
const transportError = () => new DtlsError({ reason: "Closed", cause: new Error("secret") });
const fixture = Effect.fnUntraced(function* (closeBarrier: Effect.Effect<void> = Effect.void) {
  const clock = yield* Clock.Clock;
  let sleeps = 0;
  const trackedClock: Clock.Clock = {
    ...clock,
    sleep: (duration) =>
      Effect.suspend(() => {
        sleeps++;
        return clock.sleep(duration).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              sleeps--;
            }),
          ),
        );
      }),
  };
  const incoming = yield* Queue.bounded<Uint8Array, DtlsError>(256);
  const outgoing = yield* Queue.bounded<Buffer>(256);
  const sent: Buffer[] = [];
  const connections: Options[] = [];
  let terminated = 0;
  let receives = 0;
  let sendError = false;
  const socket: Socket = {
    isOpen: () => terminated === 0,
    send: (data) =>
      Effect.gen(function* () {
        const buffer = Buffer.from(data);
        sent.push(buffer);
        yield* Queue.offer(outgoing, buffer);
        if (sendError) return yield* transportError();
      }),
    receive: Effect.suspend(() => {
      receives++;
      return Queue.take(incoming).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            receives--;
          }),
        ),
      );
    }),
    close: Effect.gen(function* () {
      if (terminated) return;
      terminated++;
      yield* Queue.failCause(incoming, Cause.fail(transportError()));
      yield* closeBarrier;
    }),
  };
  const service: typeof DtlsClient.Service = {
    connect: (config) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          connections.push(config);
          return socket;
        }),
        (socket) => socket.close,
      ),
  };
  const deliver = (data: Uint8Array) =>
    Queue.offer(incoming, data).pipe(Effect.andThen(Effect.yieldNow));
  return {
    socket,
    service,
    connections,
    sent,
    terminated: () => terminated,
    receives: () => receives,
    clock: trackedClock,
    sleeps: () => sleeps,
    failSend: () => {
      sendError = true;
    },
    failReceive: Queue.failCause(incoming, Cause.fail(transportError())),
    deliver,
    response: (packet: coap.Packet) => deliver(coap.generate(packet, 65535)),
    next: Queue.take(outgoing).pipe(Effect.map((buffer) => coap.parse(buffer))),
  };
});
const resolver: typeof HostResolver.Service = {
  resolve: () => Effect.die("Unexpected DNS lookup"),
};
const setup = Effect.fnUntraced(function* (timeoutMs = 10000) {
  const f = yield* fixture();
  const native = yield* connect({ ...options, timeoutMs }).pipe(
    Effect.provideService(DtlsClient, f.service),
    Effect.provideService(HostResolver, resolver),
    Effect.provideService(Clock.Clock, f.clock),
  );
  const client: Client = {
    get connected() {
      return native.connected;
    },
    close: native.close,
    request: (method, path, body) =>
      native.request(method, path, body).pipe(Effect.provideService(Clock.Clock, f.clock)),
  };
  return { ...f, client };
});
const start = (
  client: Client,
  method: "GET" | "POST" | "PUT" = "GET",
  path = "15001",
  body?: unknown,
) => client.request(method, path, body).pipe(Effect.forkChild);
const rejected = Effect.fnUntraced(function* <R>(
  effect: Effect.Effect<unknown, IkeaFailure, R>,
  message?: string,
) {
  const result = yield* Effect.result(effect);
  assert.isTrue(Result.isFailure(result));
  if (Result.isFailure(result)) {
    assert.instanceOf(result.failure, IkeaFailure);
    assert.notInclude(JSON.stringify(result.failure), "secret");
    if (message) assert.include(result.failure.reason, message);
  }
});
function response(request: coap.ParsedPacket, data: unknown, patch: coap.Packet = {}): coap.Packet {
  return {
    messageId: request.messageId,
    token: request.token,
    ack: true,
    code: "2.05",
    payload: Buffer.from(JSON.stringify(data)),
    options: [{ name: "Content-Format", value: Buffer.from([50]) }],
    ...patch,
  };
}

describe("scoped CoAP over DTLS", () => {
  it.effect("encodes full 32-bit GET/PUT resource IDs while keeping CoAP MIDs 16-bit", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* setup();
        for (const value of [0, 65537, 65538, 4294967295]) {
          for (const method of ["GET", "PUT"] as const) {
            const pending = yield* start(
              f.client,
              method,
              `15001/${value}`,
              method === "PUT" ? { "3311": [{ "5850": 0 }] } : undefined,
            );
            const request = yield* f.next;
            assert.deepStrictEqual(
              request.options.filter((o) => o.name === "Uri-Path").map((o) => o.value.toString()),
              ["15001", String(value)],
            );
            assert.isAtLeast(request.messageId, 0);
            assert.isAtMost(request.messageId, 65535);
            assert.strictEqual(request.token.length, 8);
            assert.strictEqual(request.token.readUInt16BE(6), request.messageId);
            if (method === "GET") {
              const device = { ...bulb, "9003": value };
              yield* f.response(response(request, device));
              assert.deepStrictEqual(yield* Fiber.join(pending), device);
            } else {
              yield* f.response({
                messageId: request.messageId,
                token: request.token,
                code: "2.04",
                ack: true,
              });
              assert.isUndefined(yield* Fiber.join(pending));
            }
          }
        }
      }),
    ),
  );
  it.effect("rejects fractional, negative and out-of-range paths before GET/PUT sends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* setup();
        for (const value of [
          "65537.5",
          "-1",
          "4294967296",
          "42949672950",
          "NaN",
          "Infinity",
          "01",
          "1?secret",
        ]) {
          for (const method of ["GET", "PUT"] as const)
            yield* rejected(f.client.request(method, `15001/${value}`));
        }
        assert.deepStrictEqual(f.sent, []);
        assert.isTrue(f.client.connected);
      }),
    ),
  );
  it.effect("correlates concurrent responses by full token and verifies piggyback MID", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* setup();
        const a = yield* start(f.client, "GET", "15001/1");
        const first = yield* f.next;
        const b = yield* start(f.client, "GET", "15001/2");
        const second = yield* f.next;
        assert.isTrue(first.confirmable);
        assert.strictEqual(first.code, "0.01");
        assert.strictEqual(first.token.length, 8);
        assert.notDeepEqual(first.token, second.token);
        assert.deepStrictEqual(
          first.options.filter((o) => o.name === "Uri-Path").map((o) => o.value.toString()),
          ["15001", "1"],
        );
        yield* f.response(
          response(first, "wrong-token", { token: Buffer.from("ffffffffffffffff", "hex") }),
        );
        yield* f.response(
          response(first, "wrong-mid", { messageId: (first.messageId + 1) & 0xffff }),
        );
        assert.isUndefined(a.pollUnsafe());
        yield* f.response(response(second, { id: 2 }));
        yield* f.response(response(first, { id: 1 }));
        assert.deepStrictEqual(yield* Effect.all([Fiber.join(a), Fiber.join(b)]), [
          { id: 1 },
          { id: 2 },
        ]);
        assert.strictEqual(f.receives(), 1);
        yield* f.client.close;
        assert.strictEqual(f.receives(), 0);
      }),
    ),
  );
  it.effect("keeps empty ACK pending, accepts separate CON and re-ACKs duplicates", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* setup();
        const pending = yield* start(f.client);
        const request = yield* f.next;
        yield* f.response({ messageId: request.messageId, ack: true, code: "0.00" });
        assert.isUndefined(pending.pollUnsafe());
        const separate = response(request, [1], {
          ack: false,
          confirmable: true,
          messageId: (request.messageId + 123) & 0xffff,
        });
        yield* f.response(separate);
        assert.deepStrictEqual(yield* Fiber.join(pending), [1]);
        assert.deepStrictEqual(yield* f.next, {
          messageId: separate.messageId!,
          code: "0.00",
          ack: true,
          confirmable: false,
          reset: false,
          token: Buffer.alloc(0),
          payload: Buffer.alloc(0),
          options: [],
        });
        yield* f.response(separate);
        assert.isTrue((yield* f.next).ack);
        assert.strictEqual(f.sent.length, 3);
      }),
    ),
  );
  it.effect("accepts separate NON and empty PUT responses and sends numeric JSON commands", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* setup();
        const get = yield* start(f.client);
        yield* f.response(response(yield* f.next, [], { ack: false, messageId: 123, options: [] }));
        assert.deepStrictEqual(yield* Fiber.join(get), []);
        const put = yield* start(f.client, "PUT", "15001/1", { "3311": [{ "5850": 0 }] });
        const request = yield* f.next;
        assert.strictEqual(request.code, "0.03");
        assert.strictEqual(request.options.find((o) => o.name === "Content-Format")!.value[0], 50);
        assert.deepStrictEqual(JSON.parse(request.payload.toString()), { "3311": [{ "5850": 0 }] });
        yield* f.response({
          messageId: request.messageId,
          token: request.token,
          code: "2.04",
          ack: true,
        });
        assert.isUndefined(yield* Fiber.join(put));
      }),
    ),
  );
  it.effect("retransmits identical packets with backoff and stops retry sleeps after an ACK", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* setup();
        const pending = yield* start(f.client);
        const request = yield* f.next;
        yield* TestClock.adjust("3 seconds");
        yield* f.next;
        assert.strictEqual(f.sent.length, 2);
        assert.deepStrictEqual(f.sent[0], f.sent[1]);
        yield* f.response({ messageId: request.messageId, ack: true, code: "0.00" });
        yield* TestClock.adjust("7 seconds");
        yield* rejected(Fiber.join(pending), "timed out");
        assert.strictEqual(f.sent.length, 2);
        assert.strictEqual(f.sleeps(), 0);
      }),
    ),
  );
  it.effect("bounds exponential retransmission by the configured exchange deadline", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* setup(30000);
        const pending = yield* start(f.client);
        yield* f.next;
        yield* TestClock.adjust("29 seconds");
        assert.strictEqual(f.sent.length, 4);
        for (const packet of f.sent) assert.deepStrictEqual(packet, f.sent[0]);
        yield* TestClock.adjust("1 second");
        yield* rejected(Fiber.join(pending), "timed out");
        assert.isAtMost(f.sent.length, 5);
        assert.strictEqual(f.sleeps(), 0);
      }),
    ),
  );
  it.effect(
    "rejects status, format, blockwise, Observe, JSON/UTF-8/size errors without payload leaks",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* setup();
          for (const patch of [
            { code: "4.01", payload: Buffer.from("secret") },
            { code: "2.04" },
            { payload: Buffer.from("secret") },
            { payload: Buffer.from([0xff]) },
            { payload: Buffer.alloc(32769, 32) },
            { options: [{ name: "Content-Format", value: Buffer.from([0]) }] },
            { options: [{ name: "Content-Format", value: Buffer.from([0, 0, 50]) }] },
            {
              options: [
                { name: "Content-Format", value: Buffer.from([50]) },
                { name: "Content-Format", value: Buffer.from([50]) },
              ],
            },
            { options: [{ name: "Block2", value: Buffer.from([0]) }] },
            { options: [{ name: "Observe", value: Buffer.alloc(0) }] },
            { options: [{ name: 99, value: Buffer.alloc(0) }] },
          ] satisfies coap.Packet[]) {
            const pending = yield* start(f.client);
            yield* f.response(response(yield* f.next, {}, patch));
            yield* rejected(Fiber.join(pending));
            assert.isTrue(f.client.connected);
          }
        }),
      ),
  );
  it.effect("rejects correlated RST and invalid empty ACK without success", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const patch of [{ reset: true }, { ack: true, payload: Buffer.from("bad") }]) {
          const f = yield* setup();
          const pending = yield* start(f.client);
          const request = yield* f.next;
          yield* f.response({ messageId: request.messageId, code: "0.00", ...patch });
          yield* rejected(Fiber.join(pending));
        }
        const f = yield* setup();
        const pending = yield* start(f.client);
        yield* f.response(response(yield* f.next, {}, { ack: false, reset: true }));
        yield* rejected(Fiber.join(pending), "reset");
      }),
    ),
  );
  it.effect(
    "interrupts only one exchange, never reuses its identifiers and fails others on shutdown",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* setup();
          const a = yield* start(f.client, "GET", "15001/1");
          const first = yield* f.next;
          const b = yield* start(f.client, "GET", "15001/2");
          const second = yield* f.next;
          yield* Fiber.interrupt(a);
          assert.isTrue(f.client.connected);
          assert.isTrue(Exit.isFailure(yield* Fiber.await(a)));
          yield* f.response(response(first, "late"));
          yield* f.response({ messageId: first.messageId, code: "0.00", ack: true });
          assert.isUndefined(b.pollUnsafe());
          const c = yield* start(f.client);
          const third = yield* f.next;
          assert.notStrictEqual(first.messageId, third.messageId);
          assert.notDeepEqual(first.token, third.token);
          assert.notStrictEqual(second.messageId, third.messageId);
          yield* f.client.close;
          yield* rejected(Fiber.join(b), "disconnected");
          yield* rejected(Fiber.join(c), "disconnected");
          assert.strictEqual(f.terminated(), 1);
          assert.isFalse(f.client.connected);
          assert.strictEqual(f.receives(), 0);
          assert.strictEqual(f.sleeps(), 0);
          yield* f.client.close;
          assert.strictEqual(f.terminated(), 1);
          yield* rejected(f.client.request("GET", "15001"), "disconnected");
        }),
      ),
  );
  it.effect(
    "passes typed DTLS options and releases the established socket when its scope closes",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const client = yield* connect(options).pipe(
              Effect.provideService(DtlsClient, f.service),
              Effect.provideService(HostResolver, resolver),
            );
            assert.isTrue(client.connected);
            assert.deepStrictEqual(f.connections, [
              {
                address: options.host,
                port: 5684,
                timeoutMs: 10000,
                identity: "identity",
                psk: "secret",
                resetAntiReplayWindowBeforeServerHello: true,
              },
            ]);
          }),
        );
        assert.strictEqual(f.terminated(), 1);
        assert.strictEqual(f.receives(), 0);
      }),
  );
  it.effect(
    "cleans up interrupted/timed-out/failed handshakes and suppresses DTLS error details",
    () =>
      Effect.gen(function* () {
        for (const action of ["interrupt", "timeout", "error"] as const) {
          const f = yield* fixture();
          const started = yield* Deferred.make<void>();
          const handshake = yield* Deferred.make<Socket, DtlsError>();
          const service: typeof DtlsClient.Service = {
            connect: () =>
              Effect.gen(function* () {
                yield* Effect.acquireRelease(Effect.succeed(f.socket), (socket) => socket.close);
                yield* Deferred.succeed(started, undefined);
                return yield* Deferred.await(handshake);
              }).pipe(Effect.onError(() => f.socket.close)),
          };
          const pending = yield* Effect.scoped(
            connect(options).pipe(
              Effect.provideService(DtlsClient, service),
              Effect.provideService(HostResolver, resolver),
              Effect.provideService(Clock.Clock, f.clock),
            ),
          ).pipe(Effect.forkChild);
          yield* Deferred.await(started);
          if (action === "interrupt") {
            yield* Fiber.interrupt(pending);
            const exit = yield* Fiber.await(pending);
            assert.isTrue(Exit.isFailure(exit));
            if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
          } else {
            if (action === "timeout") yield* TestClock.adjust("10 seconds");
            else yield* Deferred.fail(handshake, transportError());
            yield* rejected(Fiber.join(pending));
          }
          assert.strictEqual(f.terminated(), 1);
          assert.strictEqual(f.sleeps(), 0);
        }
      }),
  );
  it.effect("closes every exchange on malformed datagrams or send/receive errors", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const mode of ["packet", "send", "receive"] as const) {
          const f = yield* setup();
          const a = yield* start(f.client);
          yield* f.next;
          if (mode === "send") f.failSend();
          const b = yield* start(f.client);
          yield* f.next;
          if (mode === "packet") yield* f.deliver(Buffer.from([0]));
          if (mode === "receive") yield* f.failReceive;
          yield* rejected(Fiber.join(a));
          yield* rejected(Fiber.join(b));
          assert.isFalse(f.client.connected);
          assert.strictEqual(f.terminated(), 1);
        }
      }),
    ),
  );
  it.effect(
    "bounds pending exchanges, rejects outgoing JSON overflow and frees slots after interruption",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* setup();
          yield* rejected(f.client.request("PUT", "15001/1", "x".repeat(4096)), "encode");
          const circular: { self?: unknown } = {};
          circular.self = circular;
          yield* rejected(f.client.request("PUT", "15001/1", circular), "encode");
          assert.deepStrictEqual(f.sent, []);
          const pending: Fiber.Fiber<unknown, IkeaFailure>[] = [];
          for (let i = 0; i < 32; i++) {
            pending.push(yield* start(f.client));
            yield* f.next;
          }
          yield* rejected(f.client.request("GET", "15001"), "Too many");
          assert.strictEqual(f.sent.length, 32);
          yield* Fiber.interrupt(pending.shift()!);
          pending.push(yield* start(f.client));
          yield* f.next;
          yield* f.client.close;
          for (const fiber of pending) yield* rejected(Fiber.join(fiber));
        }),
      ),
  );
  it.effect("bounds completed duplicate CON history to the newest 128 exchanges", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* setup();
        const packets: coap.Packet[] = [];
        for (let i = 0; i < 129; i++) {
          const pending = yield* start(f.client);
          const packet = response(yield* f.next, [], {
            ack: false,
            confirmable: true,
            messageId: i,
          });
          packets.push(packet);
          yield* f.response(packet);
          yield* f.next;
          yield* Fiber.join(pending);
        }
        const count = f.sent.length;
        yield* f.response(packets[0]!);
        assert.strictEqual(f.sent.length, count);
        yield* f.response(packets.at(-1)!);
        yield* f.next;
        assert.strictEqual(f.sent.length, count + 1);
      }),
    ),
  );
  it.effect("keeps pending capacity atomic when concurrent request preparation yields", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* setup();
        let finished = 0;
        const fibers = yield* Effect.forEach(Array.from({ length: 64 }), () =>
          f.client.request("GET", "15001").pipe(
            Effect.result,
            Effect.tap(() =>
              Effect.sync(() => {
                finished++;
              }),
            ),
            Effect.provideService(References.MaxOpsBeforeYield, 5),
            Effect.forkChild,
          ),
        );
        for (let i = 0; i < 32; i++) yield* f.next;
        while (finished < 32) yield* Effect.yieldNow;
        assert.strictEqual(f.sent.length, 32);
        assert.strictEqual(new Set(f.sent.map((buffer) => coap.parse(buffer).messageId)).size, 32);
        yield* f.client.close;
        for (const fiber of fibers) assert.isTrue(Result.isFailure(yield* Fiber.join(fiber)));
        assert.strictEqual(f.sleeps(), 0);
      }),
    ),
  );
  it.effect(
    "rejects truncated options/tokens and empty payload markers accepted by the codec",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const suffix of [Buffer.from([0xc2, 50]), Buffer.from([0xff])]) {
            const f = yield* setup();
            const pending = yield* start(f.client, "PUT", "15001/1", { "3311": [{ "5850": 1 }] });
            const request = yield* f.next;
            const header = coap.generate({
              messageId: request.messageId,
              token: request.token,
              ack: true,
              code: "2.04",
            });
            yield* f.deliver(Buffer.concat([header, suffix]));
            yield* rejected(Fiber.join(pending), "malformed");
            assert.isFalse(f.client.connected);
          }
          const f = yield* setup();
          const pending = yield* start(f.client);
          yield* f.next;
          yield* f.deliver(Buffer.from([0x68, 0x45, 0, 1, 0]));
          yield* rejected(Fiber.join(pending), "malformed");
        }),
      ),
  );
  it.effect(
    "resolves DNS hosts to IPv4 before opening DTLS and bypasses resolution for literals",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture();
          const hosts: string[] = [];
          const client = yield* connect({ ...options, host: "gateway.local" }).pipe(
            Effect.provideService(DtlsClient, f.service),
            Effect.provideService(HostResolver, {
              resolve: (host) =>
                Effect.sync(() => {
                  hosts.push(host);
                  return options.host;
                }),
            }),
          );
          assert.deepStrictEqual(hosts, ["gateway.local"]);
          assert.strictEqual(f.connections[0]!.address, options.host);
          assert.isTrue(client.connected);
          const literal = yield* setup();
          assert.strictEqual(literal.connections[0]!.address, options.host);
        }),
      ),
  );
  it.effect("never connects after canceled or timed-out DNS resolution returns a late result", () =>
    Effect.gen(function* () {
      for (const action of ["interrupt", "timeout"] as const) {
        const f = yield* fixture();
        const started = yield* Deferred.make<void>();
        let resolveDns: (address: string) => void = () => assert.fail("DNS was not started");
        const pending = yield* Effect.scoped(
          connect({ ...options, host: "gateway.local" }).pipe(
            Effect.provideService(DtlsClient, f.service),
            Effect.provideService(HostResolver, {
              resolve: () =>
                Effect.tryPromise({
                  // Like node:dns/promises, this underlying operation cannot be aborted.
                  try: () =>
                    new Promise<string>((resolve) => {
                      resolveDns = resolve;
                      Deferred.doneUnsafe(started, Effect.void);
                    }),
                  catch: () => new IkeaFailure({ reason: "Could not resolve gateway host." }),
                }),
            }),
            Effect.provideService(Clock.Clock, f.clock),
          ),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        if (action === "interrupt") yield* Fiber.interrupt(pending);
        else {
          yield* TestClock.adjust("10 seconds");
          yield* rejected(Fiber.join(pending), "timed out");
        }
        resolveDns(options.host);
        yield* Effect.yieldNow;
        assert.deepStrictEqual(f.connections, []);
        assert.deepStrictEqual(f.sent, []);
        assert.strictEqual(f.sleeps(), 0);
      }
    }),
  );
  it.effect("uses one deadline for DNS resolution and the DTLS handshake", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const handshake = yield* Deferred.make<void>();
      const pending = yield* Effect.scoped(
        connect({ ...options, host: "gateway.local" }).pipe(
          Effect.provideService(HostResolver, {
            resolve: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.sleep("6 seconds")),
                Effect.as(options.host),
              ),
          }),
          Effect.provideService(DtlsClient, {
            connect: () =>
              Deferred.succeed(handshake, undefined).pipe(Effect.andThen(Effect.never)),
          }),
        ),
      ).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("6 seconds");
      yield* Deferred.await(handshake);
      yield* TestClock.adjust("4 seconds");
      yield* rejected(Fiber.join(pending), "timed out");
    }),
  );
  it.effect("parent disposal cancels DNS resolution without waiting for its deadline", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const parent = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        const f = yield* fixture();
        const started = yield* Deferred.make<void>();
        let resolveDns: (address: string) => void = () => assert.fail("DNS was not started");
        const pending = yield* connect({ ...options, host: "gateway.local" }).pipe(
          Effect.provideService(DtlsClient, f.service),
          Effect.provideService(HostResolver, {
            resolve: () =>
              Effect.tryPromise({
                try: () =>
                  new Promise<string>((resolve) => {
                    resolveDns = resolve;
                    Deferred.doneUnsafe(started, Effect.void);
                  }),
                catch: () => new IkeaFailure({ reason: "Could not resolve gateway host." }),
              }),
          }),
          Scope.provide(parent),
          Effect.forkChild,
        );
        yield* Deferred.await(started);
        yield* Scope.close(parent, Exit.void);
        yield* rejected(Fiber.join(pending), "disconnected");
        resolveDns(options.host);
        yield* Effect.yieldNow;
        assert.deepStrictEqual(f.connections, []);
        assert.deepStrictEqual(f.sent, []);
      }),
    ),
  );
  it.effect("rejects invalid connection options and DNS failures before opening DTLS", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture();
        for (const config of [
          { ...options, host: "http://secret@gateway" },
          { ...options, identity: "identity\n" },
          { ...options, psk: "" },
          { ...options, timeoutMs: 0 },
          { ...options, host: "gateway.local" },
        ])
          yield* rejected(
            connect(config).pipe(
              Effect.provideService(DtlsClient, f.service),
              Effect.provideService(HostResolver, {
                resolve: () =>
                  Effect.fail(new IkeaFailure({ reason: "Could not resolve gateway host." })),
              }),
            ),
          );
        assert.deepStrictEqual(f.connections, []);
        assert.deepStrictEqual(f.sent, []);
      }),
    ),
  );
  it.effect("scope closure fails externally running requests and stops the receiver", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const f = yield* setup().pipe(Scope.provide(scope));
      const pending = yield* start(f.client);
      yield* f.next;
      yield* Scope.close(scope, Exit.void);
      yield* rejected(Fiber.join(pending), "disconnected");
      assert.strictEqual(f.terminated(), 1);
      assert.strictEqual(f.receives(), 0);
      assert.strictEqual(f.sleeps(), 0);
    }),
  );
  it.effect("concurrent close and parent disposal await the same asynchronous cleanup", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const parent = yield* Scope.make();
      const f = yield* fixture(Deferred.await(gate));
      const client = yield* connect(options).pipe(
        Effect.provideService(DtlsClient, f.service),
        Effect.provideService(HostResolver, resolver),
        Scope.provide(parent),
      );
      const first = yield* client.close.pipe(Effect.forkChild);
      while (f.terminated() === 0) yield* Effect.yieldNow;
      const second = yield* client.close.pipe(Effect.forkChild);
      const disposal = yield* Scope.close(parent, Exit.void).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.isUndefined(first.pollUnsafe());
      assert.isUndefined(second.pollUnsafe());
      assert.isUndefined(disposal.pollUnsafe());
      yield* Deferred.succeed(gate, undefined);
      yield* Effect.all([Fiber.join(first), Fiber.join(second), Fiber.join(disposal)]);
      assert.strictEqual(f.terminated(), 1);
      assert.strictEqual(f.receives(), 0);
    }),
  );
  it.effect(
    "interruption during established-socket setup cleans up without closing the caller scope",
    () =>
      Effect.gen(function* () {
        const parent = yield* Scope.make();
        const f = yield* fixture();
        const established = yield* Deferred.make<void>();
        const pending = yield* connect(options).pipe(
          Effect.provideService(DtlsClient, {
            connect: (options) =>
              f.service
                .connect(options)
                .pipe(Effect.tap(() => Deferred.succeed(established, undefined))),
          }),
          Effect.provideService(HostResolver, resolver),
          Effect.provideService(References.MaxOpsBeforeYield, 5),
          Scope.provide(parent),
          Effect.forkChild,
        );
        yield* Deferred.await(established);
        yield* Fiber.interrupt(pending);
        assert.isTrue(Exit.isFailure(yield* Fiber.await(pending)));
        assert.strictEqual(f.terminated(), 1);
        assert.strictEqual(f.receives(), 0);
        assert.notStrictEqual(parent.state._tag, "Closed");
        yield* Scope.close(parent, Exit.void);
        assert.strictEqual(f.terminated(), 1);
      }),
  );
});
