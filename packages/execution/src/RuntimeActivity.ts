import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Layer,
  PubSub,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type * as Executor from "./Executor.ts";

export const Status = Schema.Literals(["running", "complete", "failed", "interrupted"]);

export const Node = Schema.Struct({
  id: Schema.String,
  graphId: Schema.String,
  nodeId: Schema.String,
  executionId: Schema.String,
  startedAt: Schema.Number,
  finishedAt: Schema.NullOr(Schema.Number),
  status: Status,
  error: Schema.NullOr(Schema.String),
});
export type Node = typeof Node.Type;

export const Event = Schema.Struct({
  id: Schema.String,
  pluginId: Schema.String,
  name: Schema.String,
  source: Schema.Literals(["Engine", "Replay"]),
  replayable: Schema.Boolean,
  startedAt: Schema.Number,
  finishedAt: Schema.NullOr(Schema.Number),
  status: Status,
  payload: Schema.String,
  error: Schema.NullOr(Schema.String),
  nodes: Schema.Array(Node),
});
export type Event = typeof Event.Type;

export const limits = { events: 100, nodes: 200, payload: 8192, error: 2048 } as const;

export class ReplayUnavailable extends Schema.TaggedError<ReplayUnavailable>()(
  "ReplayUnavailable",
  { eventId: Schema.String },
) {}

export const Rpcs = RpcGroup.make(
  Rpc.make("ActivityStream", { success: Schema.Array(Event), stream: true }),
  Rpc.make("ReplayEvent", { payload: { eventId: Schema.String }, error: ReplayUnavailable }),
);

const CurrentEvent = Context.Reference<string | undefined>("macrograph/RuntimeActivity/Event", {
  defaultValue: () => undefined,
});

// Copy only bounded data properties: never invoke getters or user-defined toJSON methods.
const display = (value: unknown, limit: number): string => {
  const seen = new WeakSet<object>();
  let remaining = 200;
  const visit = (value: unknown, depth: number): unknown => {
    if (--remaining < 0) return "[truncated]";
    if (typeof value === "string")
      return value.length > 1024 ? `${value.slice(0, 1024)}...` : value;
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value !== "object") return String(value).slice(0, 1024);
    if (seen.has(value)) return "[circular]";
    if (depth >= 8) return "[truncated]";
    seen.add(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      for (let index = 0; index < Math.min(length, 50) && remaining > 0; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        result.push(
          descriptor && "value" in descriptor ? visit(descriptor.value, depth + 1) : "[getter]",
        );
      }
      if (length > result.length) result.push("[truncated]");
      return result;
    }
    const result: Record<string, unknown> = {};
    const keys = Object.getOwnPropertyNames(value);
    for (const key of keys.slice(0, 50)) {
      if (remaining <= 0) break;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      Object.defineProperty(result, key.slice(0, 256), {
        value:
          descriptor && "value" in descriptor ? visit(descriptor.value, depth + 1) : "[getter]",
        enumerable: true,
        configurable: true,
      });
    }
    if (keys.length > 50 || remaining <= 0) result["[truncated]"] = true;
    return result;
  };
  try {
    const json = JSON.stringify(visit(value, 0));
    return json.length <= limit
      ? json
      : JSON.stringify(`${json.slice(0, Math.floor((limit - 32) / 6))}... [truncated]`);
  } catch {
    return '"[unserializable]"';
  }
};

export class Service extends Context.Service<
  Service,
  {
    readonly snapshot: Effect.Effect<ReadonlyArray<Event>>;
    readonly changes: Stream.Stream<ReadonlyArray<Event>>;
    readonly track: <A, E, R, Input extends { readonly _tag: string }>(
      pluginId: string,
      event: Input,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    readonly executionDriver: Executor.ExecutionDriver;
    readonly wrap: (executor: Executor.Service) => Executor.Service;
    readonly replay: (eventId: string) => Effect.Effect<void, ReplayUnavailable>;
  }
>()("macrograph/RuntimeActivity") {}

export const layer = Layer.effect(Service)(
  Effect.gen(function* () {
    let events: ReadonlyArray<Event> = [];
    const scope = yield* Effect.scope;
    // Retain the original input, not the lossy display payload, only while its event is retained.
    const replays = new Map<string, () => Effect.Effect<void, Executor.ExecutorError>>();
    const semaphore = yield* Semaphore.make(1);
    // Full snapshots can be coalesced. Replay makes subscribing atomic with reading the latest state.
    const snapshots = yield* PubSub.sliding<ReadonlyArray<Event>>({ capacity: 1, replay: 1 });
    yield* Effect.addFinalizer(() => PubSub.shutdown(snapshots));
    yield* PubSub.publish(snapshots, events);
    const update = (f: (events: ReadonlyArray<Event>) => ReadonlyArray<Event>) =>
      semaphore.withPermit(
        Effect.gen(function* () {
          const next = f(events);
          if (next === events) return;
          events = next;
          const retained = new Set(events.map((event) => event.id));
          for (const id of replays.keys()) if (!retained.has(id)) replays.delete(id);
          yield* PubSub.publish(snapshots, events);
        }),
      );
    const finish = (exit: Exit.Exit<unknown, unknown>) =>
      Clock.currentTimeMillis.pipe(
        Effect.map((finishedAt) => ({
          finishedAt,
          status: Exit.isSuccess(exit)
            ? ("complete" as const)
            : Cause.hasInterruptsOnly(exit.cause)
              ? ("interrupted" as const)
              : ("failed" as const),
          error: Exit.isFailure(exit) ? display(Cause.squash(exit.cause), limits.error) : null,
        })),
      );
    const track = <A, E, R, Input extends { readonly _tag: string }>(
      pluginId: string,
      event: Input,
      effect: Effect.Effect<A, E, R>,
      replay?: () => Effect.Effect<void, Executor.ExecutorError>,
      source: Event["source"] = "Engine",
    ): Effect.Effect<A, E, R> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID();
          const startedAt = yield* Clock.currentTimeMillis;
          yield* update((events) => {
            if (replay !== undefined) replays.set(id, replay);
            return [
              {
                id,
                pluginId,
                name: event._tag,
                source,
                replayable: replay !== undefined,
                startedAt,
                finishedAt: null,
                status: "running",
                payload: display(event, limits.payload),
                error: null,
                nodes: [],
              },
              ...events.slice(0, limits.events - 1),
            ];
          });
          return yield* restore(Effect.provideService(effect, CurrentEvent, id)).pipe(
            Effect.onExit((exit) =>
              finish(exit).pipe(
                Effect.flatMap((finished) =>
                  update((events) =>
                    events.map((event) => (event.id === id ? { ...event, ...finished } : event)),
                  ),
                ),
              ),
            ),
          );
        }),
      );
    const executionDriver: Executor.ExecutionDriver = {
      executeNode: (key, effect) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const eventId = yield* CurrentEvent;
            if (eventId === undefined) return yield* restore(effect);
            const startedAt = yield* Clock.currentTimeMillis;
            yield* update((events) =>
              events.map((event) =>
                event.id !== eventId
                  ? event
                  : {
                      ...event,
                      nodes: [
                        ...event.nodes.slice(-(limits.nodes - 1)),
                        {
                          id: key.traceId,
                          graphId: key.graphId,
                          nodeId: key.nodeId,
                          executionId: key.executionTraceId,
                          startedAt,
                          finishedAt: null,
                          status: "running",
                          error: null,
                        },
                      ],
                    },
              ),
            );
            return yield* restore(effect).pipe(
              Effect.onExit((exit) =>
                finish(exit).pipe(
                  Effect.flatMap((finished) =>
                    update((events) =>
                      events.map((event) =>
                        event.id !== eventId
                          ? event
                          : {
                              ...event,
                              nodes: event.nodes.map((node) =>
                                node.id === key.traceId ? { ...node, ...finished } : node,
                              ),
                            },
                      ),
                    ),
                  ),
                ),
              ),
            );
          }),
        ),
    };
    return Service.of({
      snapshot: Effect.sync(() => events),
      changes: Stream.fromPubSub(snapshots),
      track,
      executionDriver,
      replay: (eventId) =>
        Effect.gen(function* () {
          const replay = replays.get(eventId);
          if (replay === undefined) return yield* new ReplayUnavailable({ eventId });
          yield* replay().pipe(
            Effect.catchCause((cause) => Effect.logError("Event replay failed", cause)),
            Effect.forkIn(scope),
          );
        }),
      wrap: (executor) => ({
        ...executor,
        handleEvent: (plugin, event) => {
          const replay = (): Effect.Effect<void, Executor.ExecutorError> =>
            track(
              plugin.id,
              event,
              Effect.suspend(() => executor.handleEvent(plugin, event)),
              replay,
              "Replay",
            );
          return track(plugin.id, event, executor.handleEvent(plugin, event), replay);
        },
      }),
    });
  }),
);

export const handlerLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const activity = yield* Service;
    return Rpcs.of({
      ActivityStream: () => activity.changes,
      ReplayEvent: ({ eventId }) => activity.replay(eventId),
    });
  }),
);

export * as RuntimeActivity from "./RuntimeActivity.ts";
