import { Context, Effect, Option, Redacted, Schema } from "effect";

export const Id = Schema.String.pipe(Schema.brand("HttpEndpointId"));
export type Id = typeof Id.Type;

export const HandlerId = Schema.String.pipe(Schema.brand("HttpEndpointHandlerId"));
export type HandlerId = typeof HandlerId.Type;

export const InstanceKey = Schema.String.pipe(Schema.brand("HttpEndpointInstanceKey"));
export type InstanceKey = typeof InstanceKey.Type;

export const EndpointSchema = Schema.Struct({
  id: HandlerId,
  displayName: Schema.String,
});
export type EndpointSchema = typeof EndpointSchema.Type;

export interface Handler<Metadata> {
  readonly id: HandlerId;
  readonly metadata: Schema.Codec<Metadata, unknown, never, never>;
}

export const handler = <Metadata>(
  id: string,
  metadata: Schema.Codec<Metadata, unknown, never, never>,
): Handler<Metadata> => ({ id: HandlerId.make(id), metadata });

export interface Resolved<Metadata> {
  readonly id: Id;
  readonly url: string;
  readonly schema: EndpointSchema;
  readonly instanceKey: InstanceKey;
  readonly displayName?: string;
  readonly metadata: Metadata;
}

export const Routed = Schema.Struct({
  id: Id,
  url: Schema.String,
  schema: EndpointSchema,
  instanceKey: InstanceKey,
  displayName: Schema.optionalKey(Schema.String),
  metadata: Schema.Unknown,
});
export type Routed = typeof Routed.Type;

export class ProvisionError extends Schema.TaggedError<ProvisionError>()("ProvisionError", {
  cause: Schema.Unknown,
}) {}

export interface Service {
  readonly ensure: <Metadata>(
    handler: Handler<Metadata> & { readonly displayName: string },
    options: {
      readonly instanceKey: string;
      readonly displayName?: string;
      readonly metadata: Metadata;
    },
  ) => Effect.Effect<Resolved<Metadata>, ProvisionError>;

  readonly get: <Metadata>(
    handler: Handler<Metadata>,
    instanceKey: string,
  ) => Effect.Effect<Option.Option<Resolved<Metadata>>, ProvisionError>;

  readonly remove: <Metadata>(
    handler: Handler<Metadata>,
    instanceKey: string,
  ) => Effect.Effect<void, ProvisionError>;

  readonly lookup: (id: Id) => Effect.Effect<Option.Option<Routed>, ProvisionError>;

  readonly secret: (endpointId: Id) => Effect.Effect<Redacted.Redacted<string>>;
}

/** Provisions, resolves, removes, and manages secrets for plugin HTTP endpoints. */
export class Host extends Context.Service<Host, Service>()(
  "@macrograph/plugin/HttpEndpoint/Host",
) {}
