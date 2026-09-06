import * as coap from "coap-packet";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { DtlsClient } from "effect-node-dtls";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { IkeaFailure } from "./Definition.ts";
import { integer, validateConfig, validateSecret } from "./Protocol.ts";

export interface ConnectionOptions {
  readonly host: string;
  readonly timeoutMs: number;
  readonly identity: string;
  readonly psk: string;
}
export interface Client {
  readonly connected: boolean;
  readonly request: (
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
  ) => Effect.Effect<unknown, IkeaFailure>;
  readonly close: Effect.Effect<void>;
}
const failure = (reason: string) => new IkeaFailure({ reason });

export class HostResolver extends Context.Service<
  HostResolver,
  { readonly resolve: (host: string) => Effect.Effect<string, IkeaFailure> }
>()("IkeaHostResolver") {}

export const resolverLayer = Layer.succeed(HostResolver)({
  resolve: (host) =>
    Effect.tryPromise({
      try: () => lookup(host, { family: 4 }),
      catch: () => failure("Could not resolve gateway host."),
    }).pipe(Effect.map(({ address }) => address)),
});

export const connect: (
  options: ConnectionOptions,
) => Effect.Effect<Client, IkeaFailure, DtlsClient | HostResolver | Scope.Scope> =
  Effect.fnUntraced(function* (options: ConnectionOptions) {
    yield* Effect.gen(function* () {
      yield* validateConfig(options);
      yield* validateSecret(options.identity);
      yield* validateSecret(options.psk);
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.fail(
          error instanceof IkeaFailure ? error : failure("Invalid gateway connection options."),
        ),
      ),
    );
    const dtls = yield* DtlsClient;
    const resolver = yield* HostResolver;
    const parent = yield* Effect.scope;
    let close: Effect.Effect<void> = Effect.void;
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(parent);
        const closedScope = yield* Deferred.make<void>();
        const shutdown = yield* Deferred.make<never, IkeaFailure>();
        let closing = false;
        // Scope.close itself does not wait for another in-progress close in Effect v4.
        close = Effect.suspend(() => {
          if (closing) return Deferred.await(closedScope);
          closing = true;
          // Scope finalizers release sockets, but cannot cancel an in-progress DNS lookup.
          return Deferred.fail(shutdown, failure("Gateway disconnected.")).pipe(
            Effect.andThen(Scope.close(scope, Exit.void)),
            Effect.onExit((exit) => Deferred.done(closedScope, exit)),
          );
        }).pipe(Effect.uninterruptible);
        yield* Scope.addFinalizer(parent, close);
        return yield* restore(
          Effect.gen(function* () {
            const socket = yield* (
              isIP(options.host) === 4
                ? Effect.succeed(options.host)
                : resolver.resolve(options.host)
            ).pipe(
              Effect.flatMap((address) =>
                dtls
                  .connect({
                    address,
                    port: 5684,
                    timeoutMs: options.timeoutMs,
                    identity: options.identity,
                    psk: options.psk,
                    resetAntiReplayWindowBeforeServerHello: true,
                  })
                  .pipe(Effect.mapError(() => failure("Gateway DTLS connection failed."))),
              ),
              Effect.timeoutOrElse({
                duration: options.timeoutMs,
                orElse: () => failure("Gateway DTLS handshake timed out."),
              }),
            );
            const seed = yield* Effect.try({
              try: () => randomBytes(8),
              catch: () => failure("Could not initialize gateway session."),
            });
            let mid = seed.readUInt16BE(6);
            let issuedIds = 0;
            let closed = false;
            const pending = new Map<
              string,
              {
                mid: number;
                method: "GET" | "POST" | "PUT";
                ack: Deferred.Deferred<void>;
                response: Deferred.Deferred<unknown, IkeaFailure>;
              }
            >();
            const completed = new Map<string, number>();
            const terminated = yield* Deferred.make<void>();
            const terminate = (error: IkeaFailure) =>
              Effect.suspend(() => {
                if (closed) return Deferred.await(terminated);
                closed = true;
                const entries = [...pending.values()];
                pending.clear();
                completed.clear();
                return Effect.gen(function* () {
                  for (const entry of entries) yield* Deferred.fail(entry.response, error);
                  yield* socket.close;
                }).pipe(Effect.onExit((exit) => Deferred.done(terminated, exit)));
              }).pipe(Effect.uninterruptible);
            const send = (data: Uint8Array) =>
              socket.send(data).pipe(
                Effect.mapError(() => failure("Gateway datagram send failed.")),
                Effect.tapError(terminate),
              );
            const onMessage = Effect.fnUntraced(function* (data: Uint8Array) {
              if (closed) return;
              const malformed = () => failure("Gateway sent a malformed CoAP packet.");
              const message = yield* Effect.try({
                try: () => Buffer.from(data),
                catch: malformed,
              });
              if (message.length < 4 || message.length > 65535 || (message[0]! & 15) > 8)
                return yield* malformed();
              const packet = yield* Effect.try({
                try: () => coap.parse(message),
                catch: malformed,
              });
              // The codec slices truncated tokens/options instead of rejecting them.
              if (packet.options.length > 32) return yield* malformed();
              const canonical = yield* Effect.try({
                try: () => coap.generate(packet, 65535).equals(message),
                catch: malformed,
              });
              if (!canonical) return yield* malformed();
              const token = packet.token.toString("hex");
              const finish = (key: string, exit: Exit.Exit<unknown, IkeaFailure>) =>
                Effect.suspend(() => {
                  const entry = pending.get(key);
                  if (!entry) return Effect.void;
                  pending.delete(key);
                  return Deferred.done(entry.response, exit).pipe(Effect.asVoid);
                }).pipe(Effect.uninterruptible);
              if (packet.code === "0.00") {
                const match = [...pending.entries()].find(
                  ([, entry]) => entry.mid === packet.messageId,
                );
                if (!match) return;
                const [key, entry] = match;
                if (
                  packet.token.length ||
                  packet.payload.length ||
                  packet.options.length ||
                  (!packet.ack && !packet.reset)
                )
                  return yield* finish(
                    key,
                    Exit.fail(failure("Gateway sent an invalid empty acknowledgment.")),
                  );
                if (packet.reset)
                  return yield* finish(key, Exit.fail(failure("Gateway reset the CoAP request.")));
                yield* Deferred.succeed(entry.ack, undefined);
                return;
              }
              const entry = pending.get(token);
              if (!entry) {
                // A duplicate separate CON is ACKed without resolving a newer exchange.
                if (packet.confirmable && completed.get(token) === packet.messageId)
                  yield* send(
                    coap.generate({ messageId: packet.messageId, code: "0.00", ack: true }),
                  );
                return;
              }
              if (packet.ack && packet.messageId !== entry.mid) return;
              if (packet.reset)
                return yield* finish(token, Exit.fail(failure("Gateway reset the CoAP request.")));
              if (packet.confirmable) {
                yield* send(
                  coap.generate({ messageId: packet.messageId, code: "0.00", ack: true }),
                );
                if (closed) return;
                if (completed.size >= 128) completed.delete(completed.keys().next().value!);
                completed.set(token, packet.messageId);
              }
              if (
                packet.options.some((option) => {
                  if (
                    [
                      "Content-Format",
                      "ETag",
                      "Max-Age",
                      "Size2",
                      "Location-Path",
                      "Location-Query",
                    ].includes(String(option.name))
                  )
                    return false;
                  // Unknown options are numeric strings at runtime despite the codec typings.
                  const number = Number(option.name);
                  return (
                    !Number.isInteger(number) || number < 0 || number > 65535 || number % 2 === 1
                  );
                })
              )
                return yield* finish(
                  token,
                  Exit.fail(
                    failure(
                      "Gateway response requires unsupported CoAP options or blockwise transfer.",
                    ),
                  ),
                );
              const expected =
                entry.method === "GET"
                  ? ["2.05"]
                  : entry.method === "POST"
                    ? ["2.01", "2.04"]
                    : ["2.04"];
              if (!expected.includes(packet.code))
                return yield* finish(
                  token,
                  Exit.fail(
                    failure(
                      /^\d\.\d{2}$/.test(packet.code)
                        ? `Gateway rejected request (CoAP ${packet.code}).`
                        : "Invalid CoAP response code.",
                    ),
                  ),
                );
              const format = packet.options.filter((option) => option.name === "Content-Format");
              if (
                format.length > 1 ||
                format.some(
                  (option) =>
                    option.value.length > 2 ||
                    option.value.reduce((value, byte) => value * 256 + byte, 0) !== 50,
                )
              )
                return yield* finish(
                  token,
                  Exit.fail(failure("Gateway response is not JSON content format.")),
                );
              const result = yield* Effect.gen(function* () {
                if (!packet.payload.length && entry.method === "PUT") return undefined;
                const invalid = () =>
                  failure("Gateway returned invalid or oversized JSON (maximum 32768 bytes).");
                if (packet.payload.length > 32768) return yield* invalid();
                return yield* Effect.try({
                  try: (): unknown =>
                    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(packet.payload)),
                  catch: invalid,
                });
              }).pipe(Effect.exit);
              yield* finish(token, result);
            });
            const receiver = yield* Effect.gen(function* () {
              while (!closed) {
                const message = yield* socket.receive.pipe(
                  Effect.mapError(() => failure("Gateway DTLS connection closed.")),
                );
                yield* onMessage(message);
              }
            }).pipe(Effect.catch(terminate), Effect.interruptible, Effect.forkScoped);
            yield* Effect.addFinalizer(() =>
              terminate(failure("Gateway disconnected.")).pipe(
                Effect.andThen(Fiber.interrupt(receiver)),
                Effect.asVoid,
                Effect.uninterruptible,
              ),
            );
            return {
              get connected() {
                return !closed && socket.isOpen();
              },
              close,
              request: Effect.fnUntraced(function* (
                method: "GET" | "POST" | "PUT",
                path: string,
                body?: unknown,
              ) {
                return yield* Effect.uninterruptibleMask((restore) =>
                  Effect.gen(function* () {
                    if (closed || !socket.isOpen())
                      return yield* failure("Gateway is disconnected.");
                    yield* Effect.gen(function* () {
                      if (!/^(15001(?:\/(?:0|[1-9][0-9]{0,9}))?|15011\/9063)$/.test(path))
                        return yield* failure("Invalid gateway resource path.");
                      if (path.startsWith("15001/"))
                        yield* integer(Number(path.split("/")[1]), 0, 4294967295, "Device ID");
                    }).pipe(
                      Effect.catchDefect((error) =>
                        Effect.fail(
                          error instanceof IkeaFailure
                            ? error
                            : failure("Invalid gateway resource path."),
                        ),
                      ),
                    );
                    const id = yield* Effect.suspend(() => {
                      // Allocate atomically even when concurrent fibers yield during preparation.
                      if (issuedIds === 65536) {
                        const error = failure("Gateway session exhausted message IDs; reconnect.");
                        return close.pipe(Effect.andThen(Effect.fail(error)));
                      }
                      const id = mid;
                      mid = (mid + 1) & 0xffff;
                      issuedIds++;
                      return Effect.succeed(id);
                    });
                    const token = Buffer.from(seed);
                    token.writeUInt16BE(id, 6);
                    const key = token.toString("hex");
                    const payload = yield* Effect.try({
                      try: () =>
                        body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
                      catch: () => failure("Could not encode gateway request."),
                    });
                    if (payload && payload.length > 4096)
                      return yield* failure("Could not encode gateway request.");
                    const buffer = yield* Effect.try({
                      try: () =>
                        coap.generate(
                          {
                            messageId: id,
                            confirmable: true,
                            code: method,
                            token,
                            ...(payload === undefined ? {} : { payload }),
                            options: [
                              ...path.split("/").map((segment) => ({
                                name: "Uri-Path",
                                value: Buffer.from(segment),
                              })),
                              { name: "Accept", value: Buffer.from([50]) },
                              ...(payload
                                ? [{ name: "Content-Format", value: Buffer.from([50]) }]
                                : []),
                            ],
                          },
                          8192,
                        ),
                      catch: () => failure("Could not encode gateway request."),
                    });
                    const ack = yield* Deferred.make<void>();
                    const response = yield* Deferred.make<unknown, IkeaFailure>();
                    const retries = Effect.gen(function* () {
                      const initialDelay = 2000 + Math.floor(Math.random() * 1000);
                      for (let retry = 0; retry < 4; retry++) {
                        yield* Effect.sleep(initialDelay * 2 ** retry);
                        if (!pending.has(key) || closed) return;
                        yield* send(buffer);
                      }
                    }).pipe(Effect.raceFirst(Deferred.await(ack)), Effect.andThen(Effect.never));
                    return yield* Effect.suspend(() => {
                      if (closed || !socket.isOpen())
                        return Effect.fail(failure("Gateway is disconnected."));
                      if (pending.size >= 32)
                        return Effect.fail(failure("Too many pending gateway requests."));
                      pending.set(key, { mid: id, method, ack, response });
                      return restore(
                        Deferred.await(response).pipe(
                          Effect.raceFirst(send(buffer).pipe(Effect.andThen(retries))),
                          Effect.timeoutOrElse({
                            duration: options.timeoutMs,
                            orElse: () => failure("Gateway CoAP request timed out."),
                          }),
                        ),
                      ).pipe(
                        Effect.ensuring(
                          Effect.sync(() => {
                            pending.delete(key);
                          }),
                        ),
                      );
                    });
                  }),
                );
              }),
            };
          }).pipe(Scope.provide(scope), Effect.raceFirst(Deferred.await(shutdown))),
        );
      }),
    ).pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? close : Effect.void)));
  });
