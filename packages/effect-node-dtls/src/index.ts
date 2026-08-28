import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Queue,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import { UdpSocket, nodeLayer as udpNodeLayer } from "effect-node-udp";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";

import { ClientHandshakeHandler } from "./DTLS/HandshakeHandler.js";
import { ContentType, MAX_PLAINTEXT, parseRecords, RecordLayer } from "./DTLS/RecordLayer.js";

export interface Options {
  readonly address: string;
  readonly port: number;
  readonly identity: string;
  /** Strings are literal ASCII keys, NOT hexadecimal. Use Uint8Array for binary keys. */
  readonly psk: string | Uint8Array;
  readonly timeoutMs?: number;
  readonly resetAntiReplayWindowBeforeServerHello?: boolean;
}

export class DtlsError extends Schema.TaggedError<DtlsError>()("DtlsError", {
  reason: Schema.Literals(["Options", "Transport", "Protocol", "Timeout", "Overflow", "Closed"]),
  cause: Schema.Defect(),
}) {}

export interface Socket {
  readonly send: (data: Uint8Array) => Effect.Effect<void, DtlsError>;
  readonly receive: Effect.Effect<Uint8Array, DtlsError>;
  readonly close: Effect.Effect<void>;
  readonly isOpen: () => boolean;
}

export class DtlsClient extends Context.Service<
  DtlsClient,
  { readonly connect: (options: Options) => Effect.Effect<Socket, DtlsError, Scope.Scope> }
>()("effect-node-dtls/DtlsClient") {}

function canonicalAddress(address: string): string | undefined {
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return undefined;
  // WHATWG URLs exclude IPv6 zones. Canonicalize only the address bits and
  // preserve the exact interface identity; foreign/invalid peers must not throw.
  const zone = address.indexOf("%");
  const ip = zone === -1 ? address : address.slice(0, zone);
  try {
    return new URL(`http://[${ip}]/`).hostname + (zone === -1 ? "" : address.slice(zone));
  } catch {
    return undefined;
  }
}

export const layer = Layer.effect(DtlsClient)(
  Effect.gen(function* () {
    const udp = yield* UdpSocket;
    return {
      connect: (options: Options) =>
        Effect.uninterruptibleMask((restore) => {
          let release: Effect.Effect<void> = Effect.void;
          // The failure handler sits outside restore, under the mask. There is no
          // success-finalizer yield between successful acquisition and ownership transfer.
          return restore(
            Effect.gen(function* () {
              const validated = yield* Effect.try({
                try: () => {
                  const family = isIP(options.address);
                  const timeout = options.timeoutMs ?? 5000;
                  if (
                    family === 0 ||
                    !Number.isInteger(options.port) ||
                    options.port < 1 ||
                    options.port > 65535
                  )
                    throw new Error("DTLS requires an IP literal and port 1..65535");
                  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 120000)
                    throw new Error("DTLS timeoutMs must be 1..120000");
                  if (options.identity.length > 256 || !/^[\x00-\x7f]+$/.test(options.identity))
                    throw new Error("DTLS identity must contain 1..256 ASCII bytes");
                  if (options.psk.length < 1 || options.psk.length > 256)
                    throw new Error("DTLS PSK must contain 1..256 bytes");
                  if (typeof options.psk === "string" && !/^[\x00-\x7f]+$/.test(options.psk))
                    throw new Error(
                      "String PSKs must be nonempty ASCII; use Uint8Array for binary PSKs",
                    );
                  const peer = canonicalAddress(options.address);
                  if (peer === undefined) throw new Error("Invalid DTLS peer address");
                  const psk = Buffer.from(options.psk);
                  return { family, timeout, psk, peer };
                },
                catch: (cause) => new DtlsError({ reason: "Options", cause }),
              });
              const parent = yield* Scope.Scope;
              const scopeFinished = yield* Deferred.make<void>();
              const scope = yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  const scope = yield* Scope.fork(parent);
                  // Registered first, runs last. A concurrent Scope.close can otherwise
                  // return while the first closer is still executing async finalizers.
                  yield* Scope.addFinalizer(scope, Deferred.succeed(scopeFinished, undefined));
                  release = Scope.close(scope, Exit.void).pipe(
                    Effect.andThen(Deferred.await(scopeFinished)),
                  );
                  return scope;
                }),
              );
              const connect = Effect.gen(function* () {
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    validated.psk.fill(0);
                  }),
                );
                const transport = yield* udp
                  .open({ type: validated.family === 6 ? "udp6" : "udp4", capacity: 128 })
                  .pipe(Effect.mapError((cause) => new DtlsError({ reason: "Transport", cause })));
                const incoming = yield* Queue.bounded<Uint8Array, DtlsError>(64);
                const ready = yield* Deferred.make<void, DtlsError>();
                const stopped = yield* Deferred.make<never, DtlsError>();
                const cleaned = yield* Deferred.make<void>();
                const mutex = yield* Semaphore.make(1);
                const handler = yield* Effect.try({
                  try: () =>
                    new ClientHandshakeHandler(
                      new RecordLayer(),
                      Buffer.from(options.identity, "ascii"),
                      validated.psk,
                      randomBytes(32),
                      options.resetAntiReplayWindowBeforeServerHello ?? false,
                    ),
                  catch: (cause) => new DtlsError({ reason: "Protocol", cause }),
                });
                let terminal: DtlsError | undefined;
                const terminate = Effect.fnUntraced(function* (error: DtlsError) {
                  const first = yield* Effect.sync(() => {
                    if (terminal) return false;
                    terminal = error;
                    handler.destroy();
                    while (Queue.takeUnsafe(incoming) !== undefined) {}
                    Queue.failCauseUnsafe(incoming, Cause.fail(error));
                    Deferred.doneUnsafe(stopped, Effect.fail(error));
                    Deferred.doneUnsafe(ready, Effect.fail(error));
                    return true;
                  });
                  if (!first) return yield* Deferred.await(cleaned);
                  yield* transport.close.pipe(
                    Effect.ensuring(Deferred.succeed(cleaned, undefined)),
                  );
                }, Effect.uninterruptible);
                const close = terminate(
                  new DtlsError({ reason: "Closed", cause: "DTLS socket closed" }),
                );
                yield* Effect.addFinalizer(() => close);
                const guard = <A>(
                  effect: Effect.Effect<A, DtlsError>,
                ): Effect.Effect<A, DtlsError> =>
                  Effect.suspend(() =>
                    terminal
                      ? Effect.fail(terminal)
                      : effect.pipe(Effect.raceFirst(Deferred.await(stopped))),
                  );
                const sendDatagram = (data: Buffer) =>
                  guard(
                    transport
                      .send(data, { address: options.address, port: options.port })
                      .pipe(
                        Effect.mapError((cause) => new DtlsError({ reason: "Transport", cause })),
                      ),
                  );
                const failSession = <A>(effect: Effect.Effect<A, DtlsError>) =>
                  effect.pipe(
                    Effect.catchCause((cause) => {
                      const error = Cause.squash(cause);
                      const typed =
                        error instanceof DtlsError
                          ? error
                          : new DtlsError({ reason: "Protocol", cause: error });
                      return terminate(typed).pipe(
                        Effect.andThen(Effect.suspend(() => Effect.fail(terminal ?? typed))),
                      );
                    }),
                  );

                for (const datagram of handler.drainOutput()) yield* sendDatagram(datagram);
                const receiver = Effect.gen(function* () {
                  while (!terminal) {
                    const datagram = yield* guard(
                      transport.receive.pipe(
                        Effect.mapError((cause) => new DtlsError({ reason: "Transport", cause })),
                      ),
                    );
                    // Foreign UDP sources cannot influence handshake, replay or terminal state.
                    if (
                      datagram.peer.port !== options.port ||
                      canonicalAddress(datagram.peer.address) !== validated.peer
                    )
                      continue;
                    yield* Semaphore.withPermit(mutex)(
                      Effect.gen(function* () {
                        if (terminal) return;
                        const output = yield* Effect.try({
                          try: () => {
                            // Malformed datagrams are discarded without partially parsing their prefix.
                            let records: ReturnType<typeof parseRecords>;
                            try {
                              records = parseRecords(Buffer.from(datagram.data));
                            } catch {
                              return [];
                            }
                            for (const ciphertext of records) {
                              const record = handler.recordLayer.receive(ciphertext);
                              if (!record) continue;
                              switch (record.type) {
                                case ContentType.handshake:
                                  handler.receive(record.fragment, record.epoch);
                                  break;
                                case ContentType.changeCipherSpec:
                                  handler.changeCipherSpec(record.fragment, record.epoch);
                                  break;
                                case ContentType.alert:
                                  if (record.fragment.length !== 2)
                                    throw new Error("Invalid DTLS alert");
                                  if (record.fragment[1] === 0)
                                    throw new DtlsError({
                                      reason: "Closed",
                                      cause: "Peer sent close_notify",
                                    });
                                  if (record.fragment[0] === 2)
                                    throw new Error(
                                      `Peer sent fatal DTLS alert ${record.fragment[1]}`,
                                    );
                                  break;
                                case ContentType.applicationData:
                                  // Never buffer/deliver epoch-zero or pre-Finished application data.
                                  if (
                                    record.epoch === 1 &&
                                    handler.established &&
                                    !Queue.offerUnsafe(incoming, Uint8Array.from(record.fragment))
                                  )
                                    throw new DtlsError({
                                      reason: "Overflow",
                                      cause: "DTLS receive capacity 64 exceeded",
                                    });
                                  break;
                              }
                            }
                            return handler.drainOutput();
                          },
                          catch: (cause) =>
                            cause instanceof DtlsError
                              ? cause
                              : new DtlsError({ reason: "Protocol", cause }),
                        });
                        for (const packet of output) yield* sendDatagram(packet);
                        if (handler.established) yield* Deferred.succeed(ready, undefined);
                      }),
                    );
                  }
                }).pipe(
                  Effect.onExit((exit) => {
                    if (Exit.isSuccess(exit)) return Effect.void;
                    const cause = Cause.squash(exit.cause);
                    return terminate(
                      cause instanceof DtlsError
                        ? cause
                        : new DtlsError({ reason: "Closed", cause }),
                    );
                  }),
                  Effect.catchCause(() => Effect.void),
                );
                yield* Effect.forkScoped(receiver);
                yield* Deferred.await(ready);
                const send: Socket["send"] = (data) =>
                  failSession(
                    guard(
                      Semaphore.withPermit(mutex)(
                        Effect.gen(function* () {
                          if (terminal) return yield* Effect.fail(terminal);
                          const packet = yield* Effect.try({
                            try: () => {
                              if (!handler.established)
                                throw new Error("Handshake is not established");
                              if (data.length > MAX_PLAINTEXT)
                                throw new Error("DTLS plaintext exceeds 16384 bytes");
                              return handler.recordLayer.send(
                                ContentType.applicationData,
                                Buffer.from(data),
                              );
                            },
                            catch: (cause) => new DtlsError({ reason: "Protocol", cause }),
                          });
                          yield* sendDatagram(packet);
                        }),
                      ),
                    ),
                  );
                const receive = Effect.suspend(() =>
                  terminal
                    ? Effect.fail(terminal)
                    : Queue.take(incoming).pipe(
                        Effect.flatMap((data) =>
                          terminal ? Effect.fail(terminal) : Effect.succeed(data),
                        ),
                      ),
                );
                return {
                  send,
                  receive,
                  // Mask scope traversal and its completion latch as well as transport close.
                  close: close.pipe(Effect.andThen(release), Effect.uninterruptible),
                  isOpen: () => !terminal && handler.established,
                } satisfies Socket;
              }).pipe(Scope.provide(scope));
              return yield* connect.pipe(
                Effect.timeoutOrElse({
                  duration: validated.timeout,
                  orElse: () =>
                    Effect.fail(
                      new DtlsError({
                        reason: "Timeout",
                        cause: "DTLS allocation/handshake timed out",
                      }),
                    ),
                }),
              );
            }),
          ).pipe(
            Effect.catchCause((cause) => release.pipe(Effect.andThen(Effect.failCause(cause)))),
          );
        }),
    };
  }),
);

export const nodeLayer = layer.pipe(Layer.provide(udpNodeLayer));
