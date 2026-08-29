import { assert, describe, it } from "@effect/vitest";
import { Persistence } from "@macrograph/persistence";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Queue, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { Rpc, RpcClient, RpcGroup, RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";

import { makeDualClientProtocol, makeDualServerProtocol } from "../src/DualProtocol.ts";
import { EditorAccess } from "../src/EditorAccess.ts";
import { EditorEvents } from "../src/EditorEvents.ts";
import { EditorRpc } from "../src/EditorRpc.ts";
import { Presence } from "../src/Presence.ts";

const rpcs = RpcGroup.make(
  Rpc.make("PresenceStream", {
    success: Schema.Union([Presence.Snapshot, Presence.Changed]),
    stream: true,
  }),
  Rpc.make("UpdatePresence", {
    payload: Presence.Update,
    error: Presence.InvalidUpdate,
  }),
).middleware(EditorRpc.ConnectionMiddleware);

const handlers = rpcs
  .toLayer(
    Effect.gen(function* () {
      const registry = yield* Presence.Registry;
      return rpcs.of({
        PresenceStream: () => Presence.stream,
        UpdatePresence: (update) => registry.update(update),
      });
    }),
  )
  .pipe(
    Layer.provideMerge(EditorRpc.connectionMiddlewareLayer),
    Layer.provide(EditorEvents.layer),
    Layer.provide(Persistence.layerMemory),
    Layer.provide(EditorAccess.permissivePolicyLayer),
    Layer.provide(Presence.layer),
  );

type Frame = string | Uint8Array | Socket.CloseEvent;

const makeServer = Effect.gen(function* () {
  const dual = yield* makeDualServerProtocol();
  yield* RpcServer.make(rpcs).pipe(
    Effect.provideService(RpcServer.Protocol, dual.protocol),
    Effect.provide(handlers),
    Effect.forkScoped,
  );

  const connect = Effect.fnUntraced(function* () {
    const incoming = yield* Queue.make<Frame, Cause.Done>();
    const outgoing = yield* Queue.make<Frame, Cause.Done>();
    const socket = (
      input: Queue.Queue<Frame, Cause.Done>,
      output: Queue.Queue<Frame, Cause.Done>,
    ) =>
      Socket.make({
        runRaw: (handler, options) =>
          Effect.gen(function* () {
            yield* options?.onOpen ?? Effect.void;
            yield* Stream.fromQueue(input).pipe(
              Stream.runForEach((data) =>
                Effect.gen(function* () {
                  if (Socket.isCloseEvent(data)) {
                    return yield* new Socket.SocketError({
                      reason: new Socket.SocketCloseError({ code: data.code }),
                    });
                  }
                  yield* handler(data) ?? Effect.void;
                }),
              ),
            );
          }),
        writer: Effect.succeed((data) => Queue.offer(output, data).pipe(Effect.asVoid)),
      });

    const connection = yield* dual
      .onSocket(socket(incoming, outgoing))
      .pipe(Effect.exit, Effect.forkScoped);
    const clientDual = yield* makeDualClientProtocol.pipe(
      Effect.provideService(Socket.Socket, socket(outgoing, incoming)),
    );
    const client = yield* RpcClient.make(rpcs).pipe(
      Effect.provideService(RpcClient.Protocol, clientDual.protocol),
    );
    const close = Effect.fnUntraced(function* (reportedError: boolean) {
      if (reportedError) {
        yield* Queue.offer(incoming, new Socket.CloseEvent(1000));
        yield* Queue.offer(outgoing, new Socket.CloseEvent(1000));
      } else {
        yield* Queue.end(incoming);
        yield* Queue.end(outgoing);
      }
      // Do not interrupt the client's stream: cleanup must come from onSocket.
      return yield* Fiber.join(connection);
    });

    const subscribe = Effect.fnUntraced(function* () {
      const snapshot = yield* Deferred.make<Presence.Snapshot>();
      const changes: Presence.Changed[] = [];
      const fiber = yield* client.PresenceStream().pipe(
        Stream.runForEach((event) =>
          event._tag === "PresenceSnapshot"
            ? Deferred.succeed(snapshot, event)
            : Effect.sync(() => {
                changes.push(event);
              }),
        ),
        Effect.exit,
        Effect.forkScoped,
      );
      return { fiber, changes, snapshot: yield* Deferred.await(snapshot) };
    });

    return { client, close, subscribe };
  });

  return { connect, clientIds: dual.protocol.clientIds };
});

describe("DualProtocol presence cleanup", () => {
  for (const cleanup of [
    "normal socket disconnect",
    "reported socket close",
    "stream interrupt without socket close",
  ] as const) {
    it.effect(`broadcasts removal and reconnects with fresh presence after ${cleanup}`, () =>
      Effect.gen(function* () {
        const server = yield* makeServer;
        const observer = yield* (yield* server.connect()).subscribe();
        const connection = yield* server.connect();
        const departing = yield* connection.subscribe();
        const observerId = observer.snapshot.selfConnectionId;
        const departingId = departing.snapshot.selfConnectionId;
        assert.notStrictEqual(departingId, observerId);
        assert.deepStrictEqual(
          departing.snapshot.clients.map((client) => client.connectionId),
          [observerId, departingId],
        );

        yield* connection.client.UpdatePresence({
          activeGraph: "graph",
          cursor: { x: 42, y: 24 },
          selectedNodeIds: ["node"],
        });
        yield* TestClock.adjust("20 millis");
        assert.deepStrictEqual(
          observer.changes.at(-1)?.clients.find((client) => client.connectionId === departingId)
            ?.cursor,
          { x: 42, y: 24 },
        );
        yield* TestClock.adjust("15 seconds");
        assert.isUndefined(observer.fiber.pollUnsafe());
        assert.isUndefined(departing.fiber.pollUnsafe());
        const beforeRemoval = observer.changes.length;

        const socketDisconnected = cleanup !== "stream interrupt without socket close";
        let closed: Exit.Exit<void> | undefined;
        if (socketDisconnected) {
          closed = yield* connection.close(cleanup === "reported socket close");
        } else {
          yield* Fiber.interrupt(departing.fiber);
        }
        yield* TestClock.adjust("20 millis");
        assert.isAbove(observer.changes.length, beforeRemoval);
        assert.deepStrictEqual(
          observer.changes.at(-1)?.clients.map((client) => client.connectionId),
          [observerId],
        );
        assert.strictEqual((yield* server.clientIds).size, socketDisconnected ? 1 : 2);

        // HMR restarts a subscription on the existing socket; a reconnect opens a new socket.
        const reconnected = socketDisconnected ? yield* server.connect() : connection;
        const fresh = yield* reconnected.subscribe();
        const freshId = fresh.snapshot.selfConnectionId;
        if (socketDisconnected) {
          assert.notStrictEqual(freshId, departingId);
        } else {
          assert.strictEqual(freshId, departingId);
        }
        assert.deepStrictEqual(
          fresh.snapshot.clients.map((client) => client.connectionId),
          [observerId, freshId],
        );
        assert.deepStrictEqual(
          fresh.snapshot.clients.find((client) => client.connectionId === freshId),
          {
            connectionId: freshId,
            displayName: socketDisconnected ? "Local 3" : "Local 2",
            color: Presence.colorFor(socketDisconnected ? "Local 3" : "Local 2"),
            canEdit: true,
            activeGraph: null,
            cursor: null,
            selectedNodeIds: [],
          },
        );
        yield* TestClock.adjust("20 millis");
        assert.deepStrictEqual(observer.changes.at(-1)?.clients, fresh.snapshot.clients);

        const beforeFinalRemoval = observer.changes.length;
        yield* Fiber.interrupt(fresh.fiber);
        yield* TestClock.adjust("20 millis");
        assert.isAbove(observer.changes.length, beforeFinalRemoval);
        assert.deepStrictEqual(
          observer.changes.at(-1)?.clients.map((client) => client.connectionId),
          [observerId],
        );
        if (closed !== undefined) {
          assert.isTrue(
            Exit.isSuccess(closed),
            "onSocket should treat socket closure as successful completion",
          );
        }
      }).pipe(Effect.scoped, Effect.provide(RpcSerialization.layerJsonRpc())),
    );
  }
});
