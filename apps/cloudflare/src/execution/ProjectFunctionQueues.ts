import { Queue } from "@macrograph/core";
import { Effect, Schema, Semaphore } from "effect";

import * as Protocol from "./FunctionQueueProtocol.ts";

const Entry = Schema.Struct({
  work: Protocol.Work,
  phase: Schema.Literals(["waiting", "dispatching", "running", "cancelling"]),
  attempts: Schema.Number,
  dispatched: Schema.Boolean,
  failure: Schema.optionalKey(Schema.String),
});
type Entry = typeof Entry.Type;
const Runtime = Schema.Struct({
  ...Protocol.Scope.fields,
  queueId: Schema.String,
  paused: Schema.Boolean,
  entries: Schema.Array(Entry),
});
type Runtime = typeof Runtime.Type;
const Metadata = Schema.Array(Runtime);
const storageKey = "function-queue-scheduling";
export const alarmId = "function-queues:reconcile";

export interface Host<R = never> {
  readonly load: Effect.Effect<unknown, never, R>;
  readonly save: (metadata: typeof Metadata.Type) => Effect.Effect<void, never, R>;
  readonly wake: Effect.Effect<void, never, R>;
  readonly sleep: Effect.Effect<void, never, R>;
  readonly send: (delivery: Protocol.Delivery) => Effect.Effect<void, unknown, R>;
  readonly workflows: Protocol.WorkflowBinding;
}

// Stored state contains only live scheduling entries, never completed outputs or a result journal.
export const make = Effect.fnUntraced(function* <R>(host: Host<R>) {
  const lock = yield* Semaphore.make(1);
  const load = host.load.pipe(
    Effect.flatMap((value) =>
      value === undefined
        ? Effect.succeed([] as typeof Metadata.Type)
        : Schema.decodeUnknownEffect(Metadata)(value).pipe(Effect.orDie),
    ),
  );
  const failure = (queueId: string, reason: string) =>
    new Queue.OperationError({ queueId, reason });
  const status = (id: string) =>
    Effect.tryPromise({
      try: async () => (await host.workflows.get(id)).status(),
      catch: (error) => error,
    });
  const replace = (all: typeof Metadata.Type, next: Runtime) =>
    all.map((queue) =>
      Protocol.scopeKey(queue) === Protocol.scopeKey(next) && queue.queueId === next.queueId
        ? next
        : queue,
    );
  const find = (all: typeof Metadata.Type, scope: Protocol.Scope, queueId: string) => {
    const queue = all.find(
      (queue) => Protocol.scopeKey(queue) === Protocol.scopeKey(scope) && queue.queueId === queueId,
    );
    if (queue?.r2Key !== scope.r2Key) return undefined;
    return queue;
  };
  const dispatch = (queue: Runtime, advance = false): Runtime => {
    if (
      queue.paused ||
      queue.entries.some((entry) => entry.phase === "dispatching") ||
      (!advance && queue.entries.some((entry) => entry.phase !== "waiting"))
    )
      return queue;
    const first = queue.entries.find((entry) => entry.phase === "waiting");
    return first === undefined
      ? queue
      : {
          ...queue,
          entries: queue.entries.map((entry) =>
            entry === first ? { ...entry, phase: "dispatching" } : entry,
          ),
        };
  };
  const persist = (all: typeof Metadata.Type) =>
    Effect.gen(function* () {
      // Arm recovery before saving metadata or attempting an external transport operation.
      yield* host.wake;
      yield* host.save(all);
    });
  const reconcile = lock.withPermit(
    Effect.gen(function* () {
      let all = yield* load;
      for (const original of all) {
        let queue = original;
        for (const entry of original.entries) {
          if (entry.phase === "waiting") continue;
          const current = yield* status(entry.work.id).pipe(Effect.option);
          if (current._tag === "Some" && Protocol.terminal(current.value)) {
            queue = {
              ...queue,
              entries: queue.entries.filter((candidate) => candidate.work.id !== entry.work.id),
            };
            continue;
          }
          if (entry.phase === "cancelling") {
            const unavailable = current._tag === "None" || current.value.status === "unknown";
            if (unavailable) {
              // Cancellation already failed the caller; bounded uncertainty must not strand later work.
              queue = {
                ...queue,
                entries:
                  !entry.dispatched || entry.attempts >= 4
                    ? queue.entries.filter((candidate) => candidate !== entry)
                    : queue.entries.map((candidate) =>
                        candidate === entry
                          ? { ...entry, attempts: entry.attempts + 1 }
                          : candidate,
                      ),
              };
              if (entry.dispatched && entry.attempts >= 4)
                yield* Effect.logWarning(
                  "Releasing cancelled queue entry after unavailable Workflow status retries; termination is unconfirmed",
                  { workId: entry.work.id, queueId: queue.queueId },
                );
            } else if (entry.attempts !== 0) {
              queue = {
                ...queue,
                entries: queue.entries.map((candidate) =>
                  candidate === entry ? { ...entry, attempts: 0 } : candidate,
                ),
              };
            }
            yield* Effect.tryPromise({
              try: async () => (await host.workflows.get(entry.work.id)).terminate(),
              catch: (error) => error,
            }).pipe(Effect.ignore);
          } else if (entry.phase === "dispatching") {
            if (entry.failure !== undefined) {
              if (current._tag === "Some" && current.value.status !== "unknown") {
                queue = {
                  ...queue,
                  entries: queue.entries.map((candidate) =>
                    candidate === entry
                      ? { ...entry, phase: "cancelling", attempts: 0 }
                      : candidate,
                  ),
                };
              } else {
                queue = {
                  ...queue,
                  entries: queue.entries.filter((candidate) => candidate !== entry),
                };
              }
            }
          } else if (
            entry.phase === "running" &&
            (current._tag === "None" || current.value.status === "unknown")
          ) {
            // A status outage is not completion: retain singleflight until recovery or explicit cancellation.
            yield* Effect.logWarning(
              "Function Workflow status unavailable; retaining running queue entry",
              {
                workId: entry.work.id,
                queueId: queue.queueId,
              },
            );
          }
        }
        queue = dispatch(queue);
        all = replace(all, queue);
      }
      yield* host.save(all);
      if (all.some((queue) => queue.entries.length > 0)) yield* host.wake;
      else yield* host.sleep;
      for (const queue of all)
        for (const entry of queue.entries) {
          if (entry.phase === "dispatching" && !queue.paused) {
            const { id, queueId, projectId, deploymentId, r2Key } = entry.work;
            const sent = yield* host
              .send({ id, queueId, projectId, deploymentId, r2Key })
              .pipe(Effect.exit);
            if (sent._tag === "Failure") {
              const latest = all.find(
                (candidate) =>
                  Protocol.scopeKey(candidate) === Protocol.scopeKey(queue) &&
                  candidate.queueId === queue.queueId,
              )!;
              all = replace(all, {
                ...latest,
                entries: latest.entries.map((candidate) =>
                  candidate.work.id === entry.work.id
                    ? {
                        ...candidate,
                        attempts: candidate.attempts + 1,
                        ...(candidate.attempts >= 4
                          ? { failure: "Function queue transport failed" }
                          : {}),
                      }
                    : candidate,
                ),
              });
            }
          }
        }
      yield* host.save(all);
    }),
  );
  const change = (scope: Protocol.Scope, queueId: string, edit: (queue: Runtime) => Runtime) =>
    lock
      .withPermit(
        Effect.gen(function* () {
          const all = yield* load;
          const queue = find(all, scope, queueId);
          if (queue === undefined) return yield* new Queue.NotFoundError({ id: queueId });
          const next = yield* Effect.try({
            try: () => edit(queue),
            catch: (error) =>
              error instanceof Queue.OperationError ? error : failure(queueId, String(error)),
          });
          yield* persist(replace(all, next));
        }),
      )
      .pipe(Effect.andThen(reconcile));

  return {
    reconcile,
    configure: (scope: Protocol.Scope, queueIds: ReadonlyArray<string>) =>
      lock.withPermit(
        Effect.gen(function* () {
          let all = yield* load;
          for (const queueId of queueIds) {
            const existing = find(all, scope, queueId);
            if (
              all.some(
                (queue) =>
                  Protocol.scopeKey(queue) === Protocol.scopeKey(scope) &&
                  queue.r2Key !== scope.r2Key,
              )
            )
              return yield* Effect.die("Deployment snapshot identity cannot change");
            if (existing === undefined)
              all = [...all, { ...scope, queueId, paused: false, entries: [] }];
          }
          yield* host.save(all);
        }),
      ),
    stop: (scope: Protocol.Scope) =>
      lock
        .withPermit(
          Effect.gen(function* () {
            const all = yield* load;
            yield* persist(
              all.map((queue) =>
                Protocol.scopeKey(queue) !== Protocol.scopeKey(scope)
                  ? queue
                  : {
                      ...queue,
                      paused: true,
                      entries: queue.entries.flatMap((entry): Entry[] =>
                        entry.phase === "waiting" ||
                        (entry.phase === "dispatching" && !entry.dispatched)
                          ? []
                          : [
                              {
                                ...entry,
                                phase: "cancelling",
                                attempts: entry.phase === "cancelling" ? entry.attempts : 0,
                                failure: "Project deployment stopped",
                              },
                            ],
                      ),
                    },
              ),
            );
          }),
        )
        .pipe(Effect.andThen(reconcile)),
    enqueue: (work: Protocol.Work) =>
      lock
        .withPermit(
          Effect.gen(function* () {
            const all = yield* load;
            const queue = find(all, work, work.queueId);
            if (queue === undefined) return yield* new Queue.NotFoundError({ id: work.queueId });
            if (work.queueLineage.includes(work.queueId))
              return yield* failure(
                work.queueId,
                "Awaited enqueue would create a queue lineage cycle",
              );
            if (queue.entries.some((entry) => entry.work.id === work.id)) return;
            // Workflow identity supplies replay deduplication after a completed entry has been removed.
            const existing = yield* status(work.id).pipe(Effect.option);
            if (existing._tag === "Some" && existing.value.status !== "unknown") return;
            if (queue.entries.filter((entry) => entry.phase === "waiting").length >= 500)
              return yield* failure(work.queueId, "Queue is full (500 waiting calls)");
            const captured = yield* Effect.try({
              try: () => structuredClone(work),
              catch: () => failure(work.queueId, "Function arguments could not be captured"),
            });
            yield* persist(
              replace(
                all,
                dispatch({
                  ...queue,
                  entries: [
                    ...queue.entries,
                    { work: captured, phase: "waiting", attempts: 0, dispatched: false },
                  ],
                }),
              ),
            );
          }),
        )
        .pipe(Effect.andThen(reconcile)),
    deliver: (delivery: Protocol.Delivery) =>
      lock.withPermit(
        Effect.gen(function* () {
          let all = yield* load;
          const queue = find(all, delivery, delivery.queueId);
          const entry = queue?.entries.find((entry) => entry.work.id === delivery.id);
          // Late/reordered/duplicate messages cannot create work or bypass DO admission.
          if (
            queue === undefined ||
            entry === undefined ||
            entry.phase !== "dispatching" ||
            queue.paused ||
            entry.failure !== undefined
          )
            return;
          const existing = yield* status(entry.work.id).pipe(Effect.option);
          if (existing._tag === "None" || existing.value.status === "unknown") {
            // Retain an ambiguous external create through cancellation until its status is known.
            all = replace(all, {
              ...queue,
              entries: queue.entries.map((candidate) =>
                candidate === entry ? { ...entry, dispatched: true } : candidate,
              ),
            });
            yield* persist(all);
            const created = yield* Effect.tryPromise({
              try: () => host.workflows.create({ id: entry.work.id, params: entry.work }),
              catch: (error) => error,
            }).pipe(Effect.exit);
            if (created._tag === "Failure") {
              // An ambiguous create can already have succeeded; never generate a replacement identity.
              const after = yield* status(entry.work.id).pipe(Effect.option);
              if (after._tag === "None" || after.value.status === "unknown") {
                yield* persist(
                  replace(all, {
                    ...queue,
                    entries: queue.entries.map((candidate) =>
                      candidate === entry
                        ? {
                            ...entry,
                            dispatched: true,
                            attempts: entry.attempts + 1,
                            ...(entry.attempts >= 4
                              ? { failure: "Function Workflow dispatch failed" }
                              : {}),
                          }
                        : candidate,
                    ),
                  }),
                );
                return yield* failure(
                  delivery.queueId,
                  "Function Workflow dispatch will be retried",
                );
              }
            }
          }
          all = replace(all, {
            ...queue,
            entries: queue.entries.map((candidate) =>
              candidate === entry
                ? { work: entry.work, attempts: entry.attempts, dispatched: true, phase: "running" }
                : candidate,
            ),
          });
          yield* persist(all);
        }),
      ),
    inspect: (delivery: Protocol.Delivery) =>
      lock.withPermit(
        Effect.gen(function* () {
          const all = yield* load;
          const entry = find(all, delivery, delivery.queueId)?.entries.find(
            (entry) => entry.work.id === delivery.id,
          );
          return entry === undefined
            ? { state: "absent" as const }
            : {
                state: entry.phase,
                ...(entry.failure === undefined ? {} : { error: entry.failure }),
              };
        }),
      ),
    snapshot: (scope: Protocol.Scope) =>
      lock.withPermit(
        load.pipe(
          Effect.map((all) =>
            all
              .filter((queue) => Protocol.scopeKey(queue) === Protocol.scopeKey(scope))
              .map((queue) => ({
                queueId: queue.queueId,
                paused: queue.paused,
                waiting: queue.entries
                  .filter((entry) => entry.phase === "waiting")
                  .map((entry) => ({ id: entry.work.id, functionId: entry.work.functionId })),
                running: queue.entries
                  .filter((entry) => entry.phase !== "waiting")
                  .map((entry) => ({ id: entry.work.id, functionId: entry.work.functionId })),
              })),
          ),
        ),
      ),
    pause: (scope: Protocol.Scope, queueId: string, paused: boolean) =>
      change(scope, queueId, (queue) => ({ ...queue, paused })),
    advance: (scope: Protocol.Scope, queueId: string) =>
      change(scope, queueId, (queue) => {
        if (queue.paused) throw failure(queueId, "Queue is paused");
        if (queue.entries.some((entry) => entry.phase === "dispatching"))
          throw failure(queueId, "Previous queue start is still being dispatched");
        if (!queue.entries.some((entry) => entry.phase === "waiting"))
          throw failure(queueId, "No waiting calls to advance");
        return dispatch(queue, true);
      }),
    remove: (scope: Protocol.Scope, queueId: string, id: string) =>
      change(scope, queueId, (queue) => {
        if (!queue.entries.some((entry) => entry.work.id === id))
          throw failure(queueId, "Queue item not found");
        return {
          ...queue,
          entries: queue.entries.flatMap((entry): Entry[] =>
            entry.work.id !== id
              ? [entry]
              : entry.phase === "waiting" || (entry.phase === "dispatching" && !entry.dispatched)
                ? []
                : [
                    {
                      ...entry,
                      phase: "cancelling",
                      attempts: entry.phase === "cancelling" ? entry.attempts : 0,
                      failure: "Queue item removed",
                    },
                  ],
          ),
        };
      }),
    clear: (scope: Protocol.Scope, queueId: string) =>
      change(scope, queueId, (queue) => ({
        ...queue,
        entries: queue.entries.flatMap((entry): Entry[] =>
          entry.phase === "waiting" || (entry.phase === "dispatching" && !entry.dispatched)
            ? []
            : [
                {
                  ...entry,
                  phase: "cancelling",
                  attempts: entry.phase === "cancelling" ? entry.attempts : 0,
                  failure: "Queue cleared",
                },
              ],
        ),
      })),
  };
});

export { storageKey };
