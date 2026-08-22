import { Context, Effect, Option, Redacted, Schema } from "effect";

export interface Handler<Metadata> {
  readonly id: string;
  readonly metadata: Schema.Codec<Metadata, unknown, never, never>;
}

export const handler = <Metadata>(
  id: string,
  metadata: Schema.Codec<Metadata, unknown, never, never>,
): Handler<Metadata> => ({ id, metadata });

export interface Resolved<Metadata> {
  readonly id: string;
  readonly url: string;
  readonly handlerId: string;
  readonly instanceKey: string;
  readonly metadata: Metadata;
}

export const Routed = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  handlerId: Schema.String,
  instanceKey: Schema.String,
  metadata: Schema.Unknown,
});
export type Routed = typeof Routed.Type;

export class Current extends Context.Service<Current, Routed>()(
  "@macrograph/plugin/HttpEndpoint/Current",
) {}

export class ProvisionError extends Schema.TaggedErrorClass<ProvisionError>()("ProvisionError", {
  cause: Schema.Unknown,
}) {}

export interface Service {
  readonly ensure: <Metadata>(
    handler: Handler<Metadata>,
    options: {
      readonly instanceKey: string;
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

  readonly lookup: (id: string) => Effect.Effect<Option.Option<Routed>, ProvisionError>;
}

export class Host extends Context.Service<Host, Service>()(
  "@macrograph/plugin/HttpEndpoint/Host",
) {}

export interface SecretStoreService {
  readonly upsert: (endpointId: string) => Effect.Effect<Redacted.Redacted<string>>;
}

export class SecretStore extends Context.Service<SecretStore, SecretStoreService>()(
  "@macrograph/plugin/HttpEndpoint/SecretStore",
) {}
