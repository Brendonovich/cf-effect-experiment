import { Queue } from "@macrograph/core";
import { Cause, Context, Deferred, Effect, Exit, Fiber, PubSub, Scope, Stream } from "effect";

export const Lineage = Context.Reference<ReadonlyArray<string>>("macrograph/Queues/Lineage", {
  defaultValue: () => [],
});

export const Item = Queue.Item;
export const State = Queue.State;
export type State = typeof State.Type;
export type Values = Readonly<Record<string, unknown>>;
export type Error = Queue.NotFoundError | Queue.OperationError;

export interface Service {
  readonly snapshot: Effect.Effect<ReadonlyArray<State>>;
  readonly changes: Stream.Stream<ReadonlyArray<State>>;
  readonly configure: (definitions: Readonly<Record<string, Queue.Model>>) => Effect.Effect<void>;
  readonly enqueue: (
    queueId: string,
    functionId: string,
    values: Values,
  ) => Effect.Effect<Values, Error>;
  readonly pause: (queueId: string, paused: boolean) => Effect.Effect<void, Error>;
  readonly advance: (queueId: string) => Effect.Effect<void, Error>;
  readonly remove: (queueId: string, itemId: string) => Effect.Effect<void, Error>;
  readonly clear: (queueId: string) => Effect.Effect<void, Error>;
}

export const make = Effect.fnUntraced(function* (
  definitions: Readonly<Record<string, Queue.Model>>,
  invoke: (functionId: string, values: Values) => Effect.Effect<Values, unknown>,
): Effect.fn.Return<Service, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  type Work = {
    readonly id: string;
    readonly functionId: string;
    readonly values: Values;
    readonly lineage: ReadonlyArray<string>;
    readonly result: Deferred.Deferred<Values, Error>;
    fiber?: Fiber.Fiber<void>;
  };
  type Runtime = {
    readonly id: string;
    paused: boolean;
    waiting: Work[];
    running: Map<string, Work>;
  };
  const queues = new Map<string, Runtime>();
  let closed = false;
  const snapshots = yield* PubSub.sliding<ReadonlyArray<State>>({ capacity: 1, replay: 1 });
  const snapshot = Effect.sync(() =>
    Array.from(
      queues.values(),
      (queue): State => ({
        queueId: queue.id,
        paused: queue.paused,
        waiting: queue.waiting.map(({ id, functionId }) => ({ id, functionId })),
        running: Array.from(queue.running.values(), ({ id, functionId }) => ({ id, functionId })),
      }),
    ),
  );
  const publish = snapshot.pipe(
    Effect.flatMap((state) => PubSub.publish(snapshots, state)),
    Effect.asVoid,
  );
  const failure = (queueId: string, reason: string) =>
    new Queue.OperationError({ queueId, reason });
  const get = (queueId: string): Effect.Effect<Runtime, Error> =>
    Effect.suspend((): Effect.Effect<Runtime, Error> => {
      if (closed) return Effect.fail(failure(queueId, "Project runtime stopped"));
      const queue = queues.get(queueId);
      return queue === undefined
        ? Effect.fail(new Queue.NotFoundError({ id: queueId }))
        : Effect.succeed(queue);
    });

  const dispatch = (queue: Runtime, advance = false): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (
        closed ||
        queues.get(queue.id) !== queue ||
        queue.paused ||
        (!advance && queue.running.size > 0)
      )
        return;
      const item = queue.waiting.shift();
      if (item === undefined) return;
      queue.running.set(item.id, item);
      item.fiber = yield* Effect.suspend(() => invoke(item.functionId, item.values)).pipe(
        Effect.provideService(Lineage, [...item.lineage, queue.id]),
        Effect.interruptible,
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            yield* Deferred.done(
              item.result,
              Exit.isSuccess(exit)
                ? Exit.succeed(exit.value)
                : Exit.fail(
                    failure(
                      queue.id,
                      Cause.hasInterruptsOnly(exit.cause)
                        ? "Queued function interrupted"
                        : `Queued function failed: ${String(Cause.squash(exit.cause))}`,
                    ),
                  ),
            );
            queue.running.delete(item.id);
            yield* publish;
            yield* dispatch(queue);
          }),
        ),
        Effect.catchCause(() => Effect.void),
        Effect.asVoid,
        Effect.forkIn(scope),
      );
      yield* publish;
    });
  const cancel = (queue: Runtime, item: Work, reason: string) =>
    Effect.gen(function* () {
      queue.waiting = queue.waiting.filter((candidate) => candidate !== item);
      yield* Deferred.fail(item.result, failure(queue.id, reason));
      // Keep running work counted until its finalizer completes, including cancellation cleanup.
      if (item.fiber !== undefined) yield* Fiber.interrupt(item.fiber).pipe(Effect.forkIn(scope));
    });
  const configure: Service["configure"] = (next) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        if (closed) return;
        for (const [id, queue] of queues) {
          if (Object.hasOwn(next, id)) continue;
          queues.delete(id);
          for (const item of [...queue.waiting, ...queue.running.values()])
            yield* cancel(queue, item, "Queue deleted");
        }
        for (const id of Object.keys(next)) {
          if (!queues.has(id))
            queues.set(id, { id, paused: false, waiting: [], running: new Map() });
        }
        yield* publish;
      }),
    );
  yield* configure(definitions);
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      for (const queue of queues.values()) {
        for (const item of [...queue.waiting, ...queue.running.values()]) {
          yield* Deferred.fail(item.result, failure(queue.id, "Project runtime stopped"));
        }
      }
      queues.clear();
      yield* PubSub.shutdown(snapshots);
    }),
  );

  return {
    snapshot,
    changes: Stream.fromPubSub(snapshots),
    configure,
    enqueue: (queueId, functionId, values) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const queue = yield* get(queueId);
          const lineage = yield* Lineage;
          if (lineage.includes(queueId))
            return yield* failure(queueId, "Awaited enqueue would create a queue lineage cycle");
          if (queue.waiting.length >= 500)
            return yield* failure(queueId, "Queue is full (500 waiting calls)");
          const captured = yield* Effect.try({
            try: () => structuredClone(values),
            catch: () => failure(queueId, "Function arguments could not be captured"),
          });
          const item: Work = {
            id: crypto.randomUUID(),
            functionId,
            values: captured,
            lineage,
            result: yield* Deferred.make<Values, Error>(),
          };
          queue.waiting.push(item);
          yield* publish;
          yield* dispatch(queue);
          return yield* restore(Deferred.await(item.result)).pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
                ? cancel(queue, item, "Waiting caller interrupted").pipe(Effect.andThen(publish))
                : Effect.void,
            ),
          );
        }),
      ),
    pause: (queueId, paused) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const queue = yield* get(queueId);
          queue.paused = paused;
          yield* publish;
          if (!paused) yield* dispatch(queue);
        }),
      ),
    advance: (queueId) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const queue = yield* get(queueId);
          if (queue.paused) return yield* failure(queueId, "Queue is paused");
          if (queue.waiting.length === 0)
            return yield* failure(queueId, "No waiting calls to advance");
          yield* dispatch(queue, true);
        }),
      ),
    remove: (queueId, itemId) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const queue = yield* get(queueId);
          const item =
            queue.waiting.find((candidate) => candidate.id === itemId) ?? queue.running.get(itemId);
          if (item === undefined) return yield* failure(queueId, "Queue item not found");
          yield* cancel(queue, item, "Queue item removed");
          yield* publish;
          yield* dispatch(queue);
        }),
      ),
    clear: (queueId) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const queue = yield* get(queueId);
          for (const item of [...queue.waiting, ...queue.running.values()])
            yield* cancel(queue, item, "Queue cleared");
          yield* publish;
        }),
      ),
  };
});

export * as Queues from "./Queues.ts";
