import { Queue } from "@macrograph/core";
import { Context, Effect, Layer, PubSub, Stream } from "effect";

export interface Interface {
  readonly snapshot: Effect.Effect<ReadonlyArray<Queue.State>>;
  readonly changes: Stream.Stream<ReadonlyArray<Queue.State>>;
  readonly pause: (
    queueId: string,
    paused: boolean,
  ) => Effect.Effect<void, Queue.NotFoundError | Queue.OperationError>;
  readonly advance: (
    queueId: string,
  ) => Effect.Effect<void, Queue.NotFoundError | Queue.OperationError>;
  readonly remove: (
    queueId: string,
    itemId: string,
  ) => Effect.Effect<void, Queue.NotFoundError | Queue.OperationError>;
  readonly clear: (
    queueId: string,
  ) => Effect.Effect<void, Queue.NotFoundError | Queue.OperationError>;
}

export class Service extends Context.Service<Service, Interface>()(
  "macrograph/editor/QueueRuntime",
) {}

export const unavailable: Interface = {
  snapshot: Effect.succeed([]),
  changes: Stream.make([]),
  pause: (queueId) => new Queue.OperationError({ queueId, reason: "Queue runtime unavailable" }),
  advance: (queueId) => new Queue.OperationError({ queueId, reason: "Queue runtime unavailable" }),
  remove: (queueId) => new Queue.OperationError({ queueId, reason: "Queue runtime unavailable" }),
  clear: (queueId) => new Queue.OperationError({ queueId, reason: "Queue runtime unavailable" }),
};

// Hosts mount the project-scoped scheduler after constructing their executor.
export class Mount extends Context.Service<
  Mount,
  { readonly set: (runtime: Interface) => Effect.Effect<void> }
>()("macrograph/editor/QueueRuntime/Mount") {}
export const layer = Layer.effectContext(
  Effect.gen(function* () {
    let runtime = unavailable;
    const mounted = yield* PubSub.sliding<Interface>({ capacity: 1, replay: 1 });
    yield* PubSub.publish(mounted, runtime);
    yield* Effect.addFinalizer(() => PubSub.shutdown(mounted));
    return Context.make(Service, {
      snapshot: Effect.suspend(() => runtime.snapshot),
      changes: Stream.fromPubSub(mounted).pipe(Stream.switchMap((runtime) => runtime.changes)),
      pause: (id, paused) => Effect.suspend(() => runtime.pause(id, paused)),
      advance: (id) => Effect.suspend(() => runtime.advance(id)),
      remove: (id, item) => Effect.suspend(() => runtime.remove(id, item)),
      clear: (id) => Effect.suspend(() => runtime.clear(id)),
    }).pipe(
      Context.add(Mount, {
        set: (next) =>
          Effect.sync(() => {
            runtime = next;
          }).pipe(Effect.andThen(PubSub.publish(mounted, next)), Effect.asVoid),
      }),
    );
  }),
);

export * as QueueRuntime from "./QueueRuntime.ts";
