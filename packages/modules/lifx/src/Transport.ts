import { Context, Deferred, Effect, Exit, Layer, Scope } from "effect";
import { nodeLayer as udpNodeLayer, UdpSocket } from "effect-node-udp";
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";

import { LIFXFailure, type Device } from "./Definition.ts";
import { decode, encode, MessageType } from "./Protocol.ts";
import { failure, range, validateDevice } from "./Validation.ts";

export class Transport extends Context.Service<
  Transport,
  {
    readonly exchange: (
      device: Device,
      type: number,
      payload: Buffer,
      responseType: number,
      timeout: number,
    ) => Effect.Effect<Buffer, LIFXFailure>;
  }
>()("LIFX/Transport") {}

export const layer = Layer.effect(Transport)(
  Effect.gen(function* () {
    const udp = yield* UdpSocket;
    const active = new Set<Effect.Effect<void>>();
    let closed = false;
    yield* Effect.addFinalizer(() => {
      closed = true;
      return Effect.forEach([...active], (close) => close, { discard: true });
    });

    const exchange = Effect.fnUntraced(function* (
      device: Device,
      type: number,
      payload: Buffer,
      responseType: number,
      timeout: number,
    ) {
      const target = yield* validateDevice(device);
      yield* range("Timeout (ms)", timeout, 100, 30000, true);
      // Track the exchange before opening UDP so disposal also closes a pending bind.
      const lifetime = yield* Effect.acquireRelease(
        Effect.suspend(() => {
          if (closed) return new LIFXFailure({ reason: "LIFX transport is closed" });
          const scope = Scope.makeUnsafe();
          const done = Deferred.makeUnsafe<void>();
          let closing = false;
          // Scope.close marks Closed before finalization. All closers must await one result.
          const close: Effect.Effect<void> = Effect.suspend(() => {
            if (closing) return Deferred.await(done);
            closing = true;
            return Scope.close(scope, Exit.void).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  active.delete(close);
                  Deferred.doneUnsafe(done, exit);
                }),
              ),
            );
          }).pipe(Effect.uninterruptible);
          active.add(close);
          return Effect.succeed({ scope, close });
        }),
        (lifetime) => lifetime.close,
      );
      return yield* Effect.gen(function* () {
        const socket = yield* udp.open({ type: "udp4" });
        // Fresh source/sequence and ephemeral sockets avoid reusing correlation identities
        // when the 8-bit sequence space wraps.
        const identity = yield* Effect.try({ try: () => randomBytes(5), catch: failure });
        const source = identity.readUInt32LE(0) || 1,
          sequence = identity[4]!;
        const packet = yield* Effect.try({
          try: () =>
            encode(type, target.id, source, sequence, payload, responseType === MessageType.Ack),
          catch: failure,
        });
        yield* socket.send(packet, target);
        while (true) {
          const { data, peer } = yield* socket.receive;
          if (peer.address !== target.address || peer.port !== target.port) continue;
          const reply = decode(Buffer.from(data));
          if (
            !reply ||
            reply.source !== source ||
            reply.sequence !== sequence ||
            reply.target !== target.id ||
            reply.type !== responseType
          )
            continue;
          if (reply.payload.length !== (responseType === MessageType.State ? 52 : 0))
            return yield* new LIFXFailure({ reason: "Invalid LIFX response payload length" });
          return reply.payload;
        }
      }).pipe(
        Effect.provideService(Scope.Scope, lifetime.scope),
        Effect.mapError((error) =>
          error instanceof LIFXFailure
            ? error
            : new LIFXFailure({
                reason:
                  error.reason === "Closed"
                    ? "LIFX UDP socket closed"
                    : `LIFX UDP ${error.reason.toLowerCase()} failed`,
              }),
        ),
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => new LIFXFailure({ reason: "LIFX request timed out" }),
        }),
      );
    }, Effect.scoped);
    return { exchange };
  }),
);

export const nodeLayer = layer.pipe(Layer.provide(udpNodeLayer));
