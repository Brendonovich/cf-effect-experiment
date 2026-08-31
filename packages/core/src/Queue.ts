import { Effect, Schema } from "effect";

export const QueueId = Schema.String.pipe(Schema.brand("QueueId"));
export type QueueId = typeof QueueId.Type;

export const Model = Schema.Struct({ id: QueueId, name: Schema.String });
export type Model = typeof Model.Type;
export const Collection = Schema.Record(Schema.String, Model).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({})),
);

export const Item = Schema.Struct({ id: Schema.String, functionId: Schema.String });
export const State = Schema.Struct({
  queueId: Schema.String,
  paused: Schema.Boolean,
  waiting: Schema.Array(Item),
  running: Schema.Array(Item),
});
export type State = typeof State.Type;

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("QueueNotFoundError", {
  id: Schema.String,
}) {}

export class OperationError extends Schema.TaggedError<OperationError>()("QueueOperationError", {
  queueId: Schema.String,
  reason: Schema.String,
}) {}

export * as Queue from "./Queue.ts";
