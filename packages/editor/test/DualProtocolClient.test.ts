import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Queue, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { frameRpc, makeDualClientProtocol } from "../src/DualProtocol.ts";

const Rpcs = RpcGroup.make(Rpc.make("Watch", { success: Schema.String, stream: true }));

const setup = Effect.gen(function* () {
  const incoming = yield* Queue.make<Uint8Array>();
  const outgoing = yield* Queue.make<Uint8Array>();
  const closed = yield* Deferred.make<void, Socket.SocketError>();
  let disconnected = false;
  const socket = Socket.make({
    runRaw: (handler) =>
      Stream.fromQueue(incoming).pipe(
        Stream.runForEach((data) => handler(data) ?? Effect.void),
        Effect.raceFirst(Deferred.await(closed)),
        Effect.ensuring(
          Effect.sync(() => {
            disconnected = true;
          }),
        ),
      ),
    writer: Effect.succeed((data) => {
      if (disconnected) return Effect.never;
      return data instanceof Uint8Array ? Queue.offer(outgoing, data) : Effect.void;
    }),
  });
  const dual = yield* makeDualClientProtocol.pipe(Effect.provideService(Socket.Socket, socket));
  const first = yield* RpcClient.make(Rpcs).pipe(
    Effect.provideService(RpcClient.Protocol, dual.protocol),
  );
  const second = yield* RpcClient.make(Rpcs).pipe(
    Effect.provideService(RpcClient.Protocol, dual.protocol),
  );
  const pending = yield* Effect.forEach([first, second], (client) =>
    client.Watch().pipe(Stream.runDrain, Effect.exit, Effect.forkChild),
  );
  yield* Queue.take(outgoing);
  yield* Queue.take(outgoing);
  return { incoming, outgoing, closed, dual, first, pending };
});

describe("dual client socket lifecycle", () => {
  for (const mode of [
    "clean close",
    "abnormal close",
    "read error",
    "malformed response",
    "ping timeout",
  ] as const) {
    it.effect(`fails all RPC clients after ${mode}`, () =>
      Effect.gen(function* () {
        const { incoming, outgoing, closed, first, pending } = yield* setup;
        switch (mode) {
          case "clean close":
            yield* Deferred.succeed(closed, undefined);
            break;
          case "abnormal close":
            yield* Deferred.fail(
              closed,
              new Socket.SocketError({
                reason: new Socket.SocketCloseError({ code: 1006 }),
              }),
            );
            break;
          case "read error":
            yield* Deferred.fail(
              closed,
              new Socket.SocketError({
                reason: new Socket.SocketReadError({ cause: "read failed" }),
              }),
            );
            break;
          case "malformed response":
            yield* Queue.offer(incoming, frameRpc("{"));
            break;
          case "ping timeout": {
            yield* TestClock.adjust("5 seconds");
            const ping = yield* Queue.take(outgoing);
            assert.strictEqual(ping[0], 0);
            assert.include(new TextDecoder().decode(ping.subarray(1)), "Ping");
            yield* TestClock.adjust("5 seconds");
            break;
          }
        }
        for (const fiber of pending) {
          const exit = yield* Fiber.join(fiber);
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit))
            assert.propertyVal(Cause.squash(exit.cause), "_tag", "RpcClientError");
        }
        // A closed browser socket's writer waits for open; teardown must not get stuck there.
        if (mode !== "malformed response") {
          const later = yield* first.Watch().pipe(Stream.runDrain, Effect.exit);
          assert.isTrue(Exit.isFailure(later));
        }
      }).pipe(Effect.scoped, Effect.provide(RpcSerialization.layerJsonRpc())),
    );
  }

  it.effect("keeps custom frames separate from RPC responses", () =>
    Effect.gen(function* () {
      const { incoming, outgoing, dual } = yield* setup;
      yield* Queue.offer(incoming, new Uint8Array([1, 2, 3]));
      assert.deepStrictEqual(yield* Queue.take(dual.customMessages), new Uint8Array([2, 3]));
      yield* dual.sendCustom(new Uint8Array([4, 5]));
      assert.deepStrictEqual(yield* Queue.take(outgoing), new Uint8Array([1, 4, 5]));
    }).pipe(Effect.scoped, Effect.provide(RpcSerialization.layerJsonRpc())),
  );
});
