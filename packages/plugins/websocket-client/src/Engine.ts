import {
  Cause,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Result,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import { Socket } from "effect/unstable/socket";

import {
  ClientRpcs,
  type ConnectionDefinition,
  ConnectionFailed,
  ConnectionId,
  ConnectionNotFound,
  InvalidConnection,
  MAX_MESSAGE_BYTES,
  MessageReceived,
  MessageTooLarge,
  NotConnected,
  RuntimeRpcs,
  SendFailed,
  WebSocketClientEngine,
  WebSocketConnection,
} from "./Definition.ts";
import {
  Service as UrlPolicy,
  localLayer as localPolicyLayer,
  secureLayer,
} from "./UrlPolicy.ts";

type Session = {
  readonly generation: number;
  readonly write: (data: string) => Effect.Effect<void, Socket.SocketError>;
  readonly closed: Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
};

type Entry = {
  readonly definition: ConnectionDefinition;
  readonly generation: number;
  readonly status: "disconnected" | "connecting" | "connected" | "error";
  readonly error?: string;
  readonly session?: Session;
};

const connectionFailureReason =
  "The WebSocket connection failed or closed during setup";

const safeInput = (input: string) =>
  input.replace(/^([a-z][a-z\d+.-]*:\/\/)[^/?#]*@/i, "$1[redacted]@");

const utf8Size = (input: string) => {
  let size = 0;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code <= 0x7f) size++;
    else if (code <= 0x7ff) size += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < input.length &&
      input.charCodeAt(index + 1) >= 0xdc00 &&
      input.charCodeAt(index + 1) <= 0xdfff
    ) {
      size += 4;
      index++;
    } else size += 3;
  }
  return size;
};

export const make = Effect.fnUntraced(function* () {
  const mg = yield* WebSocketClientEngine.EngineContext;
  const policy = yield* UrlPolicy;
  const socketContext = yield* Effect.context<
    Scope.Scope | Socket.WebSocketConstructor
  >();
  const state = yield* SubscriptionRef.make<ReadonlyMap<ConnectionId, Entry>>(
    new Map(),
  );
  const lock = yield* Semaphore.make(1);

  yield* Stream.runForEach(
    SubscriptionRef.changes(state),
    () => mg.client.refresh,
  ).pipe(Effect.forkScoped);

  const getEntry = (id: ConnectionId) =>
    SubscriptionRef.get(state).pipe(
      Effect.map((entries) => Option.fromNullishOr(entries.get(id))),
    );

  const updateEntry = (id: ConnectionId, update: (entry: Entry) => Entry) =>
    SubscriptionRef.modifySome(state, (entries) => {
      const entry = entries.get(id);
      if (entry === undefined) return [undefined, Option.none()];
      const next = update(entry);
      return next === entry
        ? [undefined, Option.none()]
        : [undefined, Option.some(new Map(entries).set(id, next))];
    });

  const validate = Effect.fnUntraced(function* (
    definition: ConnectionDefinition,
  ): Effect.fn.Return<ConnectionDefinition, InvalidConnection> {
    const name = definition.name.trim();
    if (name.length === 0 || name.length > 80)
      return yield* new InvalidConnection({
        reason: "Name must contain 1 to 80 characters",
      });
    if (definition.id.length === 0 || definition.id.length > 128)
      return yield* new InvalidConnection({
        reason: "Connection ID must contain 1 to 128 characters",
      });
    if (definition.url.length > 2048)
      return yield* new InvalidConnection({
        reason: "URL must not exceed 2048 characters",
      });
    const url = yield* Effect.try({
      try: () => new URL(definition.url),
      catch: () =>
        new InvalidConnection({
          reason: `Invalid WebSocket URL: ${safeInput(definition.url)}`,
        }),
    });
    yield* policy
      .check(url)
      .pipe(
        Effect.mapError(
          (error) => new InvalidConnection({ reason: error.reason }),
        ),
      );
    url.username = "";
    url.password = "";
    return { ...definition, name, url: url.href };
  });

  const save = SubscriptionRef.get(state).pipe(
    Effect.flatMap((entries) =>
      mg.storage.set({
        connections: [...entries.values()].map((entry) => entry.definition),
      }),
    ),
  );

  const disconnectUnsafe = Effect.fnUntraced(function* (id: ConnectionId) {
    const current = yield* getEntry(id);
    if (Option.isNone(current)) return yield* new ConnectionNotFound({ id });
    const close = current.value.session?.close;
    yield* updateEntry(id, (entry) => ({
      definition: { ...entry.definition, connectOnStartup: false },
      generation: entry.generation + 1,
      status: "disconnected",
    }));
    yield* save;
    if (close !== undefined) yield* close;
  });

  const connect = Effect.fnUntraced(function* (
    id: ConnectionId,
    rememberIntent = false,
  ) {
    const prepared = yield* Effect.gen(function* () {
      const current = yield* getEntry(id);
      if (Option.isNone(current)) return yield* new ConnectionNotFound({ id });
      if (rememberIntent && !current.value.definition.connectOnStartup) {
        yield* updateEntry(id, (entry) => ({
          ...entry,
          definition: { ...entry.definition, connectOnStartup: true },
        }));
        yield* save;
      }
      if (
        current.value.status === "connected" ||
        current.value.status === "connecting"
      )
        return Option.none<{
          readonly definition: ConnectionDefinition;
          readonly generation: number;
        }>();
      const generation = current.value.generation + 1;
      yield* updateEntry(id, (entry) => ({
        definition: entry.definition,
        generation,
        status: "connecting",
      }));
      return Option.some({ definition: current.value.definition, generation });
    }).pipe(lock.withPermit);
    if (Option.isNone(prepared)) return;

    const { definition, generation } = prepared.value;
    const failed = () =>
      new ConnectionFailed({ id, reason: connectionFailureReason });
    const socket = yield* Socket.makeWebSocket(definition.url, {
      openTimeout: "10 seconds",
    }).pipe(Effect.provideContext(socketContext));
    const write = yield* socket.writer.pipe(
      Effect.provideContext(socketContext),
    );
    const opened = yield* Deferred.make<void, ConnectionFailed>();
    const closed = yield* Deferred.make<void>();
    const finish = Deferred.succeed(closed, undefined).pipe(
      Effect.andThen(
        updateEntry(id, (entry) =>
          entry.generation !== generation
            ? entry
            : {
                definition: entry.definition,
                generation,
                status: "error",
                error: "Connection closed",
              },
        ),
      ),
    );
    const run = socket
      .runRaw(
        (data) =>
          Effect.gen(function* () {
            if (typeof data !== "string") return Effect.void;
            const current = yield* getEntry(id);
            if (
              Option.isNone(current) ||
              current.value.generation !== generation ||
              current.value.status !== "connected"
            )
              return;
            const size = utf8Size(data);
            if (size > MAX_MESSAGE_BYTES)
              return yield* Effect.logWarning(
                "Dropped oversized WebSocket message",
                {
                  connectionId: id,
                  size,
                  limit: MAX_MESSAGE_BYTES,
                },
              );
            yield* mg.emit(new MessageReceived({ connectionId: id, data }));
          }),
        { onOpen: Deferred.succeed(opened, undefined).pipe(Effect.asVoid) },
      )
      .pipe(
        Effect.catchCause(() => {
          const error = failed();
          return Deferred.fail(opened, error).pipe(
            Effect.andThen(Effect.fail(error)),
          );
        }),
        Effect.ensuring(finish),
      );
    const fiber = yield* run.pipe(
      Effect.forkScoped,
      Effect.provideContext(socketContext),
    );
    const close = Deferred.fail(opened, failed()).pipe(
      Effect.andThen(Fiber.interrupt(fiber)),
      Effect.asVoid,
    );
    const installed = yield* Effect.gen(function* () {
      const current = yield* getEntry(id);
      if (
        Option.isNone(current) ||
        current.value.generation !== generation ||
        current.value.status !== "connecting"
      )
        return false;
      const session: Session = {
        generation,
        write,
        closed: Deferred.await(closed),
        close,
      };
      yield* updateEntry(id, (entry) => ({ ...entry, session }));
      return true;
    }).pipe(lock.withPermit);
    if (!installed) {
      yield* Fiber.interrupt(fiber);
      return yield* failed();
    }
    yield* Deferred.await(opened);
    const connected = yield* Effect.gen(function* () {
      const current = yield* getEntry(id);
      if (
        Option.isNone(current) ||
        current.value.generation !== generation ||
        current.value.status !== "connecting"
      )
        return false;
      yield* updateEntry(id, (entry) => ({ ...entry, status: "connected" }));
      return true;
    }).pipe(lock.withPermit);
    if (!connected) return yield* failed();
  });

  const stored = yield* mg.storage.get;
  for (const definition of stored.connections) {
    const result = yield* Effect.result(validate(definition));
    const entry: Entry = Result.isSuccess(result)
      ? { definition: result.success, generation: 0, status: "disconnected" }
      : {
          definition: { ...definition, url: safeInput(definition.url) },
          generation: 0,
          status: "error",
          error: result.failure.reason,
        };
    yield* SubscriptionRef.update(state, (entries) =>
      new Map(entries).set(definition.id, entry),
    );
  }
  for (const entry of (yield* SubscriptionRef.get(state)).values()) {
    if (entry.definition.connectOnStartup && entry.status === "disconnected")
      yield* connect(entry.definition.id).pipe(
        Effect.catchCause(() => Effect.void),
        Effect.forkScoped,
      );
  }

  return WebSocketClientEngine.of({
    resources: WebSocketConnection.toLayer(
      SubscriptionRef.get(state).pipe(
        Effect.map((entries) =>
          [...entries.values()].map((entry) => ({
            id: entry.definition.id,
            display: entry.definition.name,
          })),
        ),
      ),
    ),
    rpcs: RuntimeRpcs.toLayer({
      WebSocketSendMessage: ({ connectionId, data }) =>
        Effect.gen(function* () {
          const size = utf8Size(data);
          if (size > MAX_MESSAGE_BYTES)
            return yield* new MessageTooLarge({
              size,
              limit: MAX_MESSAGE_BYTES,
            });
          const entry = yield* getEntry(connectionId);
          if (Option.isNone(entry))
            return yield* new ConnectionNotFound({ id: connectionId });
          if (
            entry.value.status !== "connected" ||
            entry.value.session === undefined
          )
            return yield* new NotConnected({ id: connectionId });
          const session = entry.value.session;
          yield* Effect.raceFirst(
            session.write(data).pipe(
              Effect.catchCause((cause) =>
                Effect.fail(
                  new SendFailed({
                    id: connectionId,
                    reason: Cause.hasDies(cause)
                      ? "The WebSocket writer failed"
                      : "Message send failed",
                  }),
                ),
              ),
            ),
            session.closed.pipe(
              Effect.andThen(
                Effect.fail(
                  new SendFailed({
                    id: connectionId,
                    reason: "The WebSocket closed before the message was sent",
                  }),
                ),
              ),
            ),
          );
        }).pipe(lock.withPermit),
    }),
    client: {
      state: SubscriptionRef.get(state).pipe(
        Effect.map((entries) => ({
          connections: [...entries.values()].map((entry) => ({
            definition: entry.definition,
            status: entry.status,
            ...(entry.error === undefined ? {} : { error: entry.error }),
          })),
        })),
      ),
      rpcs: ClientRpcs.toLayer({
        WebSocketAddConnection: (input) =>
          Effect.gen(function* () {
            const id = ConnectionId.make(globalThis.crypto.randomUUID());
            const definition = yield* validate({
              ...input,
              id,
              connectOnStartup: false,
            });
            yield* SubscriptionRef.update(state, (entries) =>
              new Map(entries).set(id, {
                definition,
                generation: 0,
                status: "disconnected",
              }),
            );
            yield* save;
            yield* mg.resource.refresh(WebSocketConnection);
            return id;
          }).pipe(lock.withPermit),
        WebSocketUpdateConnection: (input) =>
          Effect.gen(function* () {
            const definition = yield* validate(input);
            const current = yield* getEntry(input.id);
            if (Option.isNone(current))
              return yield* new ConnectionNotFound({ id: input.id });
            const close = current.value.session?.close;
            yield* updateEntry(input.id, (entry) => ({
              definition,
              generation: entry.generation + 1,
              status: "disconnected",
            }));
            if (close !== undefined) yield* close;
            yield* save;
            yield* mg.resource.refresh(WebSocketConnection);
          }).pipe(lock.withPermit),
        WebSocketRemoveConnection: ({ id }) =>
          Effect.gen(function* () {
            const current = yield* getEntry(id);
            if (Option.isNone(current))
              return yield* new ConnectionNotFound({ id });
            const close = current.value.session?.close;
            yield* SubscriptionRef.update(state, (entries) => {
              const next = new Map(entries);
              next.delete(id);
              return next;
            });
            if (close !== undefined) yield* close;
            yield* save;
            yield* mg.resource.refresh(WebSocketConnection);
          }).pipe(lock.withPermit),
        WebSocketConnect: ({ id }) => connect(id, true),
        WebSocketDisconnect: ({ id }) =>
          disconnectUnsafe(id).pipe(lock.withPermit),
      }),
    },
  });
});

export const layer = Layer.effect(WebSocketClientEngine)(make());
export const productionLayer = layer.pipe(Layer.provide(secureLayer));
export const localLayer = layer.pipe(Layer.provide(localPolicyLayer));

export default productionLayer;
