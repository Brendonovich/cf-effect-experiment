import { Effect, Schema } from "effect";

export const Id = Schema.String.pipe(Schema.brand("PollingIngressId"));
export type Id = typeof Id.Type;
export const InstanceKey = Schema.String.pipe(Schema.brand("PollingIngressInstanceKey"));
export type InstanceKey = typeof InstanceKey.Type;

export interface PollEvent<Value> {
  readonly event: Value;
  readonly eventId?: string;
}

export interface PollResult<Cursor, Event> {
  readonly cursor: Cursor;
  readonly events: ReadonlyArray<PollEvent<Event>>;
}

export class PollError extends Schema.TaggedError<PollError>()("PollingIngressPollError", {
  handlerId: Id,
  cause: Schema.Unknown,
}) {}
export class InvalidConfiguration extends Schema.TaggedError<InvalidConfiguration>()(
  "PollingIngressInvalidConfiguration",
  { handlerId: Id, cause: Schema.Unknown },
) {}
export class InvalidCursor extends Schema.TaggedError<InvalidCursor>()(
  "PollingIngressInvalidCursor",
  { handlerId: Id, cause: Schema.Unknown },
) {}
export class InvalidEvent extends Schema.TaggedError<InvalidEvent>()("PollingIngressInvalidEvent", {
  handlerId: Id,
  cause: Schema.Unknown,
}) {}

export const Requirement = Schema.Struct({
  handlerId: Id,
  moduleId: Schema.String,
  instanceKey: InstanceKey,
  displayName: Schema.String,
  intervalMs: Schema.Number,
  configuration: Schema.Unknown,
});
export type Requirement = typeof Requirement.Type;
export const Manifest = Schema.Array(Requirement);
export type Manifest = typeof Manifest.Type;

export interface DeliveredEvent {
  readonly moduleId: string;
  readonly eventType: string;
  readonly eventId?: string;
  readonly payload: unknown;
}

export interface PollResponse {
  readonly cursor: unknown;
  readonly events: ReadonlyArray<DeliveredEvent>;
}

export interface AnyHandler {
  readonly id: Id;
  readonly moduleId: string;
  readonly displayName: string;
  readonly intervalMs: number;
  readonly initialCursor: (
    configuration: unknown,
  ) => Effect.Effect<unknown, InvalidConfiguration, unknown>;
  readonly poll: (
    configuration: unknown,
    cursor: unknown,
  ) => Effect.Effect<
    PollResponse,
    InvalidConfiguration | InvalidCursor | InvalidEvent | PollError,
    unknown
  >;
}

export interface Handler<Configuration, R> extends AnyHandler {
  readonly require: (options: {
    readonly instanceKey: string;
    readonly displayName?: string;
    readonly configuration: Configuration;
  }) => Requirement;
  readonly initialCursor: (
    configuration: unknown,
  ) => Effect.Effect<unknown, InvalidConfiguration, R>;
  readonly poll: (
    configuration: unknown,
    cursor: unknown,
  ) => Effect.Effect<
    PollResponse,
    InvalidConfiguration | InvalidCursor | InvalidEvent | PollError,
    R
  >;
}

export const make = <Configuration, Cursor, Event extends { readonly _tag: string }, R>(options: {
  readonly id: string;
  readonly moduleId: string;
  readonly displayName: string;
  readonly intervalMs: number;
  readonly configuration: Schema.Codec<Configuration, unknown, never, never>;
  readonly cursor: Schema.Codec<Cursor, unknown, never, never>;
  readonly event: Schema.Codec<Event, unknown, never, never>;
  readonly initialCursor: (configuration: Configuration) => Effect.Effect<Cursor, unknown, R>;
  readonly poll: (options: {
    readonly configuration: Configuration;
    readonly cursor: Cursor;
  }) => Effect.Effect<PollResult<Cursor, Event>, unknown, R>;
}): Handler<Configuration, R> => {
  const id = Id.make(options.id);
  const decodeConfiguration = (configuration: unknown) =>
    Schema.decodeUnknownEffect(options.configuration)(configuration).pipe(
      Effect.mapError((cause) => new InvalidConfiguration({ handlerId: id, cause })),
    );
  const decodeCursor = (cursor: unknown) =>
    Schema.decodeUnknownEffect(options.cursor)(cursor).pipe(
      Effect.mapError((cause) => new InvalidCursor({ handlerId: id, cause })),
    );
  const encodeCursor = Schema.encodeUnknownEffect(options.cursor);
  const encodeEvent = Schema.encodeUnknownEffect(options.event);
  return {
    id,
    moduleId: options.moduleId,
    displayName: options.displayName,
    intervalMs: options.intervalMs,
    require: ({ instanceKey, displayName = options.displayName, configuration }) => ({
      handlerId: id,
      moduleId: options.moduleId,
      instanceKey: InstanceKey.make(instanceKey),
      displayName,
      intervalMs: options.intervalMs,
      configuration,
    }),
    initialCursor: (configuration) =>
      decodeConfiguration(configuration).pipe(
        Effect.flatMap(options.initialCursor),
        Effect.flatMap(encodeCursor),
        Effect.mapError((cause) => new InvalidConfiguration({ handlerId: id, cause })),
      ),
    poll: (configuration, cursor) =>
      Effect.gen(function* () {
        const decodedConfiguration = yield* decodeConfiguration(configuration);
        const decodedCursor = yield* decodeCursor(cursor);
        const result = yield* options
          .poll({ configuration: decodedConfiguration, cursor: decodedCursor })
          .pipe(Effect.mapError((cause) => new PollError({ handlerId: id, cause })));
        const encodedCursor = yield* encodeCursor(result.cursor).pipe(
          Effect.mapError((cause) => new InvalidCursor({ handlerId: id, cause })),
        );
        const events = yield* Effect.forEach(result.events, ({ event, eventId }) =>
          encodeEvent(event).pipe(
            Effect.map((payload) => ({
              moduleId: options.moduleId,
              eventType: event._tag,
              ...(eventId === undefined ? {} : { eventId }),
              payload,
            })),
            Effect.mapError((cause) => new InvalidEvent({ handlerId: id, cause })),
          ),
        );
        return { cursor: encodedCursor, events };
      }),
  };
};

export const requirementKey = (requirement: Requirement) =>
  JSON.stringify([requirement.handlerId, requirement.instanceKey]);
