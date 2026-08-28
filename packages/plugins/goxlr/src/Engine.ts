import * as WebSocket from "@macrograph/plugin-websocket-client/Definition";
import {
  Service as UrlPolicy,
  localLayer as policyLayer,
} from "@macrograph/plugin-websocket-client/UrlPolicy";
import {
  Cause,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { Socket } from "effect/unstable/socket";

import {
  ClientRpcs,
  Command,
  GoXLRConnection,
  GoXLREngine,
  GoXLRFailure,
  RuntimeRpcs,
} from "./Definition.ts";
import {
  DaemonStatus,
  Mixers,
  MixerStatus,
  commandRequest,
  decodeResponse,
  patchEvents,
  pathParts,
  statusRequest,
} from "./Protocol.ts";

type Session = {
  mixerIds: string[];
  pending: Deferred.Deferred<void, GoXLRFailure> | undefined;
  readonly ready: Deferred.Deferred<void, GoXLRFailure>;
  readonly closed: Deferred.Deferred<void>;
  readonly write: (data: string) => Effect.Effect<void, Socket.SocketError>;
  readonly lock: Semaphore.Semaphore;
  close: Effect.Effect<void>;
};
type Entry = {
  readonly definition: WebSocket.ConnectionDefinition;
  readonly status: WebSocket.ConnectionStatus;
  readonly error?: string;
  readonly session?: Session;
};

export const layer = GoXLREngine.toLayer((mg) =>
  Effect.gen(function* () {
    const policy = yield* UrlPolicy;
    const socketContext = yield* Effect.context<Scope.Scope | Socket.WebSocketConstructor>();
    const state = yield* SubscriptionRef.make<ReadonlyMap<WebSocket.ConnectionId, Entry>>(
      new Map(),
    );
    const lock = yield* Semaphore.make(1);
    yield* Stream.runForEach(SubscriptionRef.changes(state), () => mg.client.refresh).pipe(
      Effect.forkScoped,
    );

    const get = Effect.fnUntraced(function* (id: WebSocket.ConnectionId) {
      const entry = (yield* SubscriptionRef.get(state)).get(id);
      if (!entry) return yield* new WebSocket.ConnectionNotFound({ id });
      return entry;
    });
    const put = (id: WebSocket.ConnectionId, entry: Entry) =>
      SubscriptionRef.update(state, (entries) => new Map(entries).set(id, entry));
    const save = SubscriptionRef.get(state).pipe(
      Effect.flatMap((entries) =>
        mg.storage.set({
          connections: [...entries.values()].map(({ definition }) => definition),
        }),
      ),
    );
    const validate = Effect.fnUntraced(function* (definition: WebSocket.ConnectionDefinition) {
      const name = definition.name.trim();
      if (
        name.length < 1 ||
        name.length > 80 ||
        definition.id.length < 1 ||
        definition.id.length > 128 ||
        definition.url.length > 2048
      )
        return yield* new WebSocket.InvalidConnection({
          reason: "Invalid connection name, ID or URL length",
        });
      const url = yield* Effect.try({
        try: () => new URL(definition.url),
        catch: () => new WebSocket.InvalidConnection({ reason: "Invalid WebSocket URL" }),
      });
      yield* policy
        .check(url)
        .pipe(
          Effect.mapError((error) => new WebSocket.InvalidConnection({ reason: error.reason })),
        );
      return { ...definition, name, url: url.href };
    });
    const wait = (deferred: Deferred.Deferred<void, GoXLRFailure>, reason: string) =>
      Deferred.await(deferred).pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () => Effect.fail(new GoXLRFailure({ reason })),
        }),
      );

    const setupConnection = Effect.fnUntraced(function* (
      id: WebSocket.ConnectionId,
      remember = false,
    ) {
      const session = yield* Effect.gen(function* () {
        const current = yield* get(id);
        const definition = yield* validate({
          ...current.definition,
          connectOnStartup: remember || current.definition.connectOnStartup,
        }).pipe(
          Effect.mapError((error) => new WebSocket.ConnectionFailed({ id, reason: error.reason })),
        );
        if (current.session && (current.status === "connecting" || current.status === "connected"))
          return current.session;
        const socket = yield* Socket.makeWebSocket(definition.url, {
          openTimeout: "10 seconds",
        }).pipe(Effect.provideContext(socketContext));
        const write = yield* socket.writer.pipe(Effect.provideContext(socketContext));
        const session: Session = {
          mixerIds: [],
          pending: undefined,
          ready: yield* Deferred.make<void, GoXLRFailure>(),
          closed: yield* Deferred.make<void>(),
          write,
          lock: yield* Semaphore.make(1),
          close: Effect.void,
        };
        yield* put(id, { definition, status: "connecting", session });
        if (remember) yield* save;

        const receive = Effect.fnUntraced(function* (data: string | Uint8Array) {
          if (typeof data !== "string") return;
          if (new TextEncoder().encode(data).length > WebSocket.MAX_MESSAGE_BYTES)
            return yield* Effect.logWarning("Dropped oversized GoXLR message");
          if ((yield* SubscriptionRef.get(state)).get(id)?.session !== session) return;
          const result = yield* Effect.result(decodeResponse(data));
          if (Result.isFailure(result))
            return yield* Effect.logWarning("Dropped malformed GoXLR response", {
              connectionId: id,
            });
          const response = result.success;
          if (response.data === "Ok") {
            if (response.id === 0 && session.pending)
              yield* Deferred.succeed(session.pending, undefined);
          } else if ("Error" in response.data) {
            if (response.id !== 0) return;
            const error = new GoXLRFailure({ reason: response.data.Error });
            if (session.pending) yield* Deferred.fail(session.pending, error);
            else if ((yield* get(id)).status === "connecting")
              yield* Deferred.fail(session.ready, error);
            else yield* Effect.logWarning("GoXLR daemon error", { reason: error.reason });
          } else if ("Status" in response.data) {
            if (response.id !== 0) return;
            session.mixerIds = Object.keys(response.data.Status.mixers);
            yield* Deferred.succeed(session.ready, undefined);
          } else {
            for (const op of response.data.Patch) {
              const path = pathParts(op.path);
              if (op.path === "" && (op.op === "add" || op.op === "replace")) {
                const status = Schema.decodeUnknownResult(DaemonStatus)(op.value);
                session.mixerIds = Result.isSuccess(status)
                  ? Object.keys(status.success.mixers)
                  : [];
              } else if (path[0] === "mixers" && path.length === 1) {
                if (op.op === "remove") session.mixerIds = [];
                else if (op.op === "add" || op.op === "replace") {
                  const mixers = Schema.decodeUnknownResult(Mixers)(op.value);
                  session.mixerIds = Result.isSuccess(mixers) ? Object.keys(mixers.success) : [];
                }
              } else if (path[0] === "mixers" && path.length === 2) {
                const mixerId = path[1]!;
                if (op.op === "remove")
                  session.mixerIds = session.mixerIds.filter((mixer) => mixer !== mixerId);
                else if (op.op === "add" || op.op === "replace") {
                  if (Result.isFailure(Schema.decodeUnknownResult(MixerStatus)(op.value))) {
                    session.mixerIds = session.mixerIds.filter((mixer) => mixer !== mixerId);
                    yield* Effect.logWarning("Dropped invalid GoXLR mixer status patch", {
                      connectionId: id,
                    });
                  } else if (!session.mixerIds.includes(mixerId)) session.mixerIds.push(mixerId);
                }
              }
            }
            const mixer = session.mixerIds[0];
            if (mixer)
              for (const event of patchEvents(id, mixer, response.data.Patch))
                yield* mg.emit(event);
          }
        });
        const failed = new GoXLRFailure({ reason: "GoXLR connection closed or failed" });
        const finish = Effect.gen(function* () {
          session.mixerIds = [];
          yield* Deferred.fail(session.ready, failed);
          if (session.pending) yield* Deferred.fail(session.pending, failed);
          yield* SubscriptionRef.update(state, (entries) => {
            const entry = entries.get(id);
            return entry?.session === session
              ? new Map(entries).set(id, {
                  definition: entry.definition,
                  status: "error",
                  error: failed.reason,
                })
              : entries;
          });
          yield* Deferred.succeed(session.closed, undefined);
        });
        const fiber = yield* socket
          .runRaw(receive, {
            onOpen: write(statusRequest).pipe(
              Effect.catchCause(() =>
                Deferred.fail(
                  session.ready,
                  new GoXLRFailure({ reason: "Could not request GoXLR status" }),
                ).pipe(Effect.asVoid),
              ),
            ),
          })
          .pipe(
            Effect.catchCause(() => Effect.void),
            Effect.ensuring(finish),
            Effect.forkScoped,
            Effect.provideContext(socketContext),
          );
        session.close = Fiber.interrupt(fiber).pipe(Effect.asVoid);
        return session;
      }).pipe(lock.withPermit);

      const ready = yield* Effect.result(wait(session.ready, "Timed out waiting for GoXLR status"));
      if (Result.isFailure(ready)) {
        yield* session.close;
        return yield* new WebSocket.ConnectionFailed({ id, reason: ready.failure.reason });
      }
      const connected = yield* SubscriptionRef.modify(state, (entries) => {
        const current = entries.get(id);
        return current?.session === session
          ? [true, new Map(entries).set(id, { ...current, status: "connected" })]
          : [false, entries];
      });
      if (!connected)
        return yield* new WebSocket.ConnectionFailed({
          id,
          reason: "Connection changed during setup",
        });
    });

    // RPC callers only wait: the engine owns setup through readiness, failure or timeout.
    const connect = (id: WebSocket.ConnectionId, remember = false) =>
      setupConnection(id, remember).pipe(
        Effect.forkScoped,
        Effect.provideContext(socketContext),
        Effect.flatMap(Fiber.join),
      );

    for (const definition of (yield* mg.storage.get).connections) {
      const checked = yield* Effect.result(validate(definition));
      yield* put(
        definition.id,
        Result.isSuccess(checked)
          ? { definition: checked.success, status: "disconnected" }
          : {
              definition: {
                ...definition,
                url: definition.url.replace(/^([a-z][a-z\d+.-]*:\/\/)[^/?#]*@/i, "$1[redacted]@"),
              },
              status: "error",
              error: checked.failure.reason,
            },
      );
    }
    for (const entry of (yield* SubscriptionRef.get(state)).values()) {
      if (entry.definition.connectOnStartup && entry.status === "disconnected")
        yield* connect(entry.definition.id).pipe(
          Effect.catchCause(() => Effect.void),
          Effect.forkScoped,
        );
    }

    return GoXLREngine.of({
      resources: GoXLRConnection.toLayer(
        SubscriptionRef.get(state).pipe(
          Effect.map((entries) =>
            [...entries.values()].map(({ definition }) => ({
              id: definition.id,
              display: definition.name,
            })),
          ),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({
        GoXLRCommand: ({ connectionId, command }) =>
          Effect.gen(function* () {
            const checked = yield* Schema.decodeUnknownEffect(Command)(command).pipe(
              Effect.mapError(() => new GoXLRFailure({ reason: "Invalid GoXLR command" })),
            );
            const entry = yield* get(connectionId);
            if (entry.status !== "connected" || !entry.session)
              return yield* new WebSocket.NotConnected({ id: connectionId });
            const session = entry.session;
            yield* Effect.gen(function* () {
              if ((yield* get(connectionId)).session !== session)
                return yield* new WebSocket.NotConnected({ id: connectionId });
              const mixer = session.mixerIds[0];
              if (!mixer)
                return yield* new GoXLRFailure({
                  reason: "The GoXLR daemon has no available mixer",
                });
              // The legacy protocol uses id 0, so only one command may await a reply.
              const pending = yield* Deferred.make<void, GoXLRFailure>();
              session.pending = pending;
              yield* session.write(commandRequest(mixer, checked)).pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterrupts(cause)
                    ? Effect.interrupt
                    : Effect.fail(new GoXLRFailure({ reason: "GoXLR command send failed" })),
                ),
                Effect.andThen(Deferred.await(pending)),
                Effect.raceFirst(
                  Deferred.await(session.closed).pipe(
                    Effect.andThen(
                      Effect.fail(
                        new GoXLRFailure({ reason: "GoXLR connection closed or failed" }),
                      ),
                    ),
                  ),
                ),
                Effect.timeoutOrElse({
                  duration: "10 seconds",
                  orElse: () =>
                    Effect.fail(
                      new GoXLRFailure({
                        reason: "Timed out sending GoXLR command or waiting for acknowledgment",
                      }),
                    ),
                }),
                Effect.onError(() => session.close),
                Effect.ensuring(
                  Effect.sync(() => {
                    session.pending = undefined;
                  }),
                ),
              );
            }).pipe(session.lock.withPermit);
          }),
      }),
      client: {
        state: SubscriptionRef.get(state).pipe(
          Effect.map((entries) => ({
            connections: [...entries.values()].map(({ definition, status, error }) => ({
              definition,
              status,
              ...(error === undefined ? {} : { error }),
            })),
          })),
        ),
        rpcs: ClientRpcs.toLayer({
          GoXLRWebSocketAddConnection: (input) =>
            Effect.gen(function* () {
              const id = WebSocket.ConnectionId.make(globalThis.crypto.randomUUID());
              const definition = yield* validate({ ...input, id, connectOnStartup: false });
              yield* put(id, { definition, status: "disconnected" });
              yield* save;
              yield* mg.resource.refresh(GoXLRConnection);
              return id;
            }).pipe(lock.withPermit),
          GoXLRWebSocketUpdateConnection: (input) =>
            Effect.gen(function* () {
              const definition = yield* validate(input);
              const current = yield* get(input.id);
              yield* put(input.id, { definition, status: "disconnected" });
              if (current.session) yield* current.session.close;
              yield* save;
              yield* mg.resource.refresh(GoXLRConnection);
            }).pipe(lock.withPermit),
          GoXLRWebSocketRemoveConnection: ({ id }) =>
            Effect.gen(function* () {
              const current = yield* get(id);
              yield* SubscriptionRef.update(state, (entries) => {
                const next = new Map(entries);
                next.delete(id);
                return next;
              });
              if (current.session) yield* current.session.close;
              yield* save;
              yield* mg.resource.refresh(GoXLRConnection);
            }).pipe(lock.withPermit),
          GoXLRWebSocketConnect: ({ id }) => connect(id, true),
          GoXLRWebSocketDisconnect: ({ id }) =>
            Effect.gen(function* () {
              const current = yield* get(id);
              yield* put(id, {
                definition: { ...current.definition, connectOnStartup: false },
                status: "disconnected",
              });
              if (current.session) yield* current.session.close;
              yield* save;
            }).pipe(lock.withPermit),
        }),
      },
    });
  }),
).pipe(Layer.provide(policyLayer));

export default layer;
