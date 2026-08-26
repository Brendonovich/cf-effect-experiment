import { Effect, Schema } from "effect";

export const Id = Schema.String.pipe(Schema.brand("ResourceConstantId"));
export type Id = typeof Id.Type;

export const ResourceRef = Schema.Struct({
  package: Schema.String,
  resource: Schema.String,
});
export type ResourceRef = typeof ResourceRef.Type;

export const LiveValue = Schema.Struct({
  id: Schema.Json,
  display: Schema.String,
});
export type LiveValue = typeof LiveValue.Type;

export const Model = Schema.Struct({
  id: Id,
  name: Schema.String,
  resource: ResourceRef,
  value: Schema.optional(Schema.Json),
});
export type Model = typeof Model.Type;

export const Collection = Schema.Record(Schema.String, Model).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({})),
);

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "ResourceConstantNotFoundError",
  { id: Schema.String },
) {}

export class InUseError extends Schema.TaggedError<InUseError>()("ResourceConstantInUseError", {
  id: Schema.String,
  nodeIds: Schema.Array(Schema.String),
}) {}

export class InvalidResourceError extends Schema.TaggedError<InvalidResourceError>()(
  "InvalidResourceError",
  { package: Schema.String, resource: Schema.String, reason: Schema.String },
) {}

export * as ResourceConstant from "./ResourceConstant.ts";
