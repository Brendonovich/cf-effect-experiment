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
  // Explicit choice; use getDefault to include the automatic fallback.
  isDefault: Schema.optional(Schema.Boolean),
});
export type Model = typeof Model.Type;

export const Collection = Schema.Record(Schema.String, Model).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({})),
);

export const getDefault = (
  constants: Readonly<Record<string, Model>>,
  resource: ResourceRef,
): Model | undefined => {
  let fallback: Model | undefined;
  for (const constant of Object.values(constants)) {
    if (
      constant.resource.package !== resource.package ||
      constant.resource.resource !== resource.resource
    )
      continue;
    fallback ??= constant;
    if (constant.isDefault) return constant;
  }
  return fallback;
};

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
