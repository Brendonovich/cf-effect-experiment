import { Queue } from "@macrograph/core";
import { QueueRuntime } from "@macrograph/editor";
import { Effect, Schedule, Stream } from "effect";

export interface Operations {
  readonly queueSnapshot: (projectId: string) => Effect.Effect<ReadonlyArray<Queue.State>>;
  readonly queuePause: (
    projectId: string,
    queueId: string,
    paused: boolean,
  ) => Effect.Effect<void, Queue.NotFoundError | Queue.OperationError>;
  readonly queueAdvance: (
    projectId: string,
    queueId: string,
  ) => Effect.Effect<void, Queue.NotFoundError | Queue.OperationError>;
  readonly queueRemove: (
    projectId: string,
    queueId: string,
    itemId: string,
  ) => Effect.Effect<void, Queue.NotFoundError | Queue.OperationError>;
  readonly queueClear: (
    projectId: string,
    queueId: string,
  ) => Effect.Effect<void, Queue.NotFoundError | Queue.OperationError>;
}

export const make = (
  projectId: () => string | undefined,
  operations: Operations,
): QueueRuntime.Interface => {
  const snapshot = Effect.suspend(() => {
    const id = projectId();
    return id === undefined ? Effect.succeed([]) : operations.queueSnapshot(id);
  });
  const mutate = (
    queueId: string,
    operation: (id: string) => Effect.Effect<void, Queue.NotFoundError | Queue.OperationError>,
  ) =>
    Effect.suspend(() => {
      const id = projectId();
      return id === undefined
        ? Effect.fail(
            new Queue.OperationError({ queueId, reason: "Project queue runtime unavailable" }),
          )
        : operation(id);
    });
  return {
    snapshot,
    changes: Stream.fromEffectSchedule(snapshot, Schedule.spaced("2 seconds")).pipe(
      Stream.changesWith((previous, next) => JSON.stringify(previous) === JSON.stringify(next)),
    ),
    pause: (queueId, paused) => mutate(queueId, (id) => operations.queuePause(id, queueId, paused)),
    advance: (queueId) => mutate(queueId, (id) => operations.queueAdvance(id, queueId)),
    remove: (queueId, itemId) =>
      mutate(queueId, (id) => operations.queueRemove(id, queueId, itemId)),
    clear: (queueId) => mutate(queueId, (id) => operations.queueClear(id, queueId)),
  };
};
