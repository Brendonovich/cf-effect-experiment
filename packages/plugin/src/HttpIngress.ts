import { Context, Effect, Layer, Option, Schema } from "effect";

import * as HttpEndpoint from "./HttpEndpoint.ts";

export interface HttpRequest<Metadata, Configuration = unknown> {
  readonly endpoint: HttpEndpoint.Resolved<Metadata>;
  readonly configuration: Configuration;
  readonly method: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: Uint8Array;
}

export interface HttpEvent<Event> {
  readonly event: Event;
  readonly eventId?: string;
}

export interface HttpResponse<Event> {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
  readonly events?: ReadonlyArray<HttpEvent<Event>>;
}

export interface DeliveredEvent {
  readonly pluginId: string;
  readonly eventType: string;
  readonly eventId?: string;
  readonly payload: unknown;
}

export interface Response {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
  readonly events: ReadonlyArray<DeliveredEvent>;
}

export class InitializationError extends Schema.TaggedErrorClass<InitializationError>()(
  "HttpIngressInitializationError",
  { handlerId: Schema.String, cause: Schema.Unknown },
) {}

export class InvalidMetadata extends Schema.TaggedErrorClass<InvalidMetadata>()(
  "HttpIngressInvalidMetadata",
  { handlerId: Schema.String, cause: Schema.Unknown },
) {}

export class InvalidConfiguration extends Schema.TaggedErrorClass<InvalidConfiguration>()(
  "HttpIngressInvalidConfiguration",
  { handlerId: Schema.String, cause: Schema.Unknown },
) {}

export class EventEncodingError extends Schema.TaggedErrorClass<EventEncodingError>()(
  "HttpIngressEventEncodingError",
  { handlerId: Schema.String, cause: Schema.Unknown },
) {}

export class ReconciliationError extends Schema.TaggedErrorClass<ReconciliationError>()(
  "HttpIngressReconciliationError",
  { handlerId: Schema.String, instanceKey: Schema.String, cause: Schema.Unknown },
) {}

interface Handler {
  readonly id: string;
  readonly method: string;
  readonly handle: (
    request: HttpRequest<unknown>,
  ) => Effect.Effect<Response, InvalidMetadata | InvalidConfiguration | EventEncodingError>;
  readonly mount: (
    entry: ManifestEntry,
    endpoints: HttpEndpoint.Service,
  ) => Effect.Effect<HttpEndpoint.Routed, ReconciliationError>;
  readonly unmount: (
    entry: ManifestEntry,
    endpoints: HttpEndpoint.Service,
  ) => Effect.Effect<void, ReconciliationError>;
  readonly merge: (
    entries: ReadonlyArray<ManifestEntry>,
  ) => Effect.Effect<ManifestEntry, ReconciliationError>;
  readonly allows: (
    entry: ManifestEntry,
    event: DeliveredEvent,
  ) => Effect.Effect<boolean, InvalidConfiguration>;
}

export interface Live<RO, RI> {
  readonly definition: AnyHttpDefinition;
  readonly make: Effect.Effect<
    Effect.Effect<Handler, InitializationError, RI>,
    InitializationError,
    RO
  >;
  readonly build: Effect.Effect<Handler, InitializationError, RO | RI>;
}

export type AnyLive = Live<unknown, unknown>;

export interface Requirement {
  readonly definition: AnyHttpDefinition;
  readonly instanceKey: string;
  readonly metadata: unknown;
  readonly configuration: unknown;
}

export interface ManifestEntry {
  readonly handlerId: string;
  readonly pluginId: string;
  readonly instanceKey: string;
  readonly metadata: unknown;
  readonly configuration: unknown;
}

export const ManifestEntry = Schema.Struct({
  handlerId: Schema.String,
  pluginId: Schema.String,
  instanceKey: Schema.String,
  metadata: Schema.Unknown,
  configuration: Schema.Unknown,
});

export const Manifest = Schema.Array(ManifestEntry);
export type Manifest = typeof Manifest.Type;

export interface HttpDefinition<
  Metadata,
  Event extends { readonly _tag: string },
  Configuration,
> extends HttpEndpoint.Handler<Metadata> {
  readonly pluginId: string;
  readonly method: string;
  readonly event: Schema.Codec<Event, unknown, never, never>;
  readonly configuration: Schema.Codec<Configuration, unknown, never, never>;
  readonly require: (options: {
    readonly instanceKey: string;
    readonly metadata: Metadata;
    readonly configuration: Configuration;
  }) => Requirement;
  readonly implement: <EO, RO, EI, RI>(
    implementation: Effect.Effect<
      Effect.Effect<
        {
          readonly handle: (
            request: HttpRequest<Metadata, Configuration>,
          ) => Effect.Effect<HttpResponse<Event>>;
          readonly mount?: (options: {
            readonly endpoint: HttpEndpoint.Resolved<Metadata>;
            readonly configuration: Configuration;
          }) => Effect.Effect<void, unknown>;
          readonly unmount?: (options: {
            readonly endpoint: HttpEndpoint.Resolved<Metadata>;
            readonly configuration: Configuration;
          }) => Effect.Effect<void, unknown>;
        },
        EI,
        RI
      >,
      EO,
      RO
    >,
  ) => Live<RO, RI>;
}

export interface AnyHttpDefinition extends HttpEndpoint.Handler<unknown> {
  readonly pluginId: string;
  readonly method: string;
  readonly configuration: Schema.Codec<unknown, unknown, never, never>;
}

export const make = <Metadata, Event extends { readonly _tag: string }, Configuration>(options: {
  readonly id: string;
  readonly pluginId: string;
  readonly method: string;
  readonly metadata: Schema.Codec<Metadata, unknown, never, never>;
  readonly event: Schema.Codec<Event, unknown, never, never>;
  readonly configuration: Schema.Codec<Configuration, unknown, never, never>;
  readonly mergeConfiguration?: (current: Configuration, next: Configuration) => Configuration;
  readonly accepts?: (configuration: Configuration, eventType: Event["_tag"]) => boolean;
}): HttpDefinition<Metadata, Event, Configuration> => {
  const definition: HttpDefinition<Metadata, Event, Configuration> = {
    id: options.id,
    pluginId: options.pluginId,
    method: options.method,
    metadata: options.metadata,
    event: options.event,
    configuration: options.configuration,
    require: ({ instanceKey, metadata, configuration }) => ({
      definition,
      instanceKey,
      metadata,
      configuration,
    }),
    implement: (implementation) => {
      const make = implementation.pipe(
        Effect.mapError((cause) => new InitializationError({ handlerId: options.id, cause })),
        Effect.map((initialize) =>
          initialize.pipe(
            Effect.mapError((cause) => new InitializationError({ handlerId: options.id, cause })),
            Effect.map(
              (service): Handler => ({
                id: options.id,
                method: options.method,
                handle: Effect.fnUntraced(function* (request) {
                  const metadata = yield* Schema.decodeUnknownEffect(options.metadata)(
                    request.endpoint.metadata,
                  ).pipe(
                    Effect.mapError(
                      (cause) => new InvalidMetadata({ handlerId: options.id, cause }),
                    ),
                  );
                  const response = yield* service.handle({
                    ...request,
                    endpoint: { ...request.endpoint, metadata },
                    configuration: yield* Schema.decodeUnknownEffect(options.configuration)(
                      request.configuration,
                    ).pipe(
                      Effect.mapError(
                        (cause) => new InvalidConfiguration({ handlerId: options.id, cause }),
                      ),
                    ),
                  });
                  const events = yield* Effect.forEach(
                    response.events ?? [],
                    ({ event, eventId }) =>
                      Schema.encodeUnknownEffect(options.event)(event).pipe(
                        Effect.map(
                          (payload): DeliveredEvent =>
                            eventId === undefined
                              ? {
                                  pluginId: options.pluginId,
                                  eventType: event._tag,
                                  payload,
                                }
                              : {
                                  pluginId: options.pluginId,
                                  eventType: event._tag,
                                  eventId,
                                  payload,
                                },
                        ),
                        Effect.mapError(
                          (cause) => new EventEncodingError({ handlerId: options.id, cause }),
                        ),
                      ),
                  );
                  return { ...response, events };
                }),
                mount: Effect.fnUntraced(
                  function* (entry, endpoints) {
                    const metadata = yield* Schema.decodeUnknownEffect(options.metadata)(
                      entry.metadata,
                    );
                    const configuration = yield* Schema.decodeUnknownEffect(options.configuration)(
                      entry.configuration,
                    );
                    const endpoint = yield* endpoints.ensure(definition, {
                      instanceKey: entry.instanceKey,
                      metadata,
                    });
                    if (service.mount !== undefined)
                      yield* service.mount({ endpoint, configuration });
                    return endpoint;
                  },
                  (effect, entry) =>
                    effect.pipe(
                      Effect.catchCause((cause) =>
                        Effect.fail(
                          new ReconciliationError({
                            handlerId: options.id,
                            instanceKey: entry.instanceKey,
                            cause,
                          }),
                        ),
                      ),
                    ),
                ),
                unmount: Effect.fnUntraced(
                  function* (entry, endpoints) {
                    const endpoint = yield* endpoints.get(definition, entry.instanceKey);
                    if (Option.isSome(endpoint) && service.unmount !== undefined) {
                      const configuration = yield* Schema.decodeUnknownEffect(
                        options.configuration,
                      )(entry.configuration);
                      yield* service.unmount({ endpoint: endpoint.value, configuration });
                    }
                    yield* endpoints.remove(definition, entry.instanceKey);
                  },
                  (effect, entry) =>
                    effect.pipe(
                      Effect.catchCause((cause) =>
                        Effect.fail(
                          new ReconciliationError({
                            handlerId: options.id,
                            instanceKey: entry.instanceKey,
                            cause,
                          }),
                        ),
                      ),
                    ),
                ),
                merge: Effect.fnUntraced(
                  function* (entries) {
                    const first = entries[0];
                    if (first === undefined)
                      return yield* Effect.die("Cannot merge an empty HTTP ingress entry list");
                    let configuration = yield* Schema.decodeUnknownEffect(options.configuration)(
                      first.configuration,
                    );
                    for (const entry of entries.slice(1)) {
                      const next = yield* Schema.decodeUnknownEffect(options.configuration)(
                        entry.configuration,
                      );
                      if (options.mergeConfiguration !== undefined)
                        configuration = options.mergeConfiguration(configuration, next);
                    }
                    return {
                      ...first,
                      configuration: yield* Schema.encodeUnknownEffect(options.configuration)(
                        configuration,
                      ),
                    };
                  },
                  (effect, entries) =>
                    effect.pipe(
                      Effect.catchCause((cause) =>
                        Effect.fail(
                          new ReconciliationError({
                            handlerId: options.id,
                            instanceKey: entries[0]?.instanceKey ?? "unknown",
                            cause,
                          }),
                        ),
                      ),
                    ),
                ),
                allows: (entry, event) =>
                  Schema.decodeUnknownEffect(options.configuration)(entry.configuration).pipe(
                    Effect.map((configuration) =>
                      options.accepts === undefined
                        ? true
                        : options.accepts(configuration, event.eventType),
                    ),
                    Effect.mapError(
                      (cause) => new InvalidConfiguration({ handlerId: options.id, cause }),
                    ),
                  ),
              }),
            ),
          ),
        ),
      );
      return {
        definition,
        make,
        build: Effect.flatten(make),
      };
    },
  };
  return definition;
};

export const manifest = (requirements: ReadonlyArray<Requirement>): Effect.Effect<Manifest> =>
  Effect.forEach(requirements, (requirement) =>
    Effect.all({
      metadata: Schema.encodeUnknownEffect(requirement.definition.metadata)(requirement.metadata),
      configuration: Schema.encodeUnknownEffect(requirement.definition.configuration)(
        requirement.configuration,
      ),
    }).pipe(
      Effect.map(
        ({ metadata, configuration }): ManifestEntry => ({
          handlerId: requirement.definition.id,
          pluginId: requirement.definition.pluginId,
          instanceKey: requirement.instanceKey,
          metadata,
          configuration,
        }),
      ),
      Effect.orDie,
    ),
  );

export interface RegistryService {
  readonly definitions: ReadonlyArray<AnyHttpDefinition>;
  readonly handle: (
    request: HttpRequest<unknown>,
  ) => Effect.Effect<Response, InvalidMetadata | InvalidConfiguration | EventEncodingError>;
  readonly mount: (
    entry: ManifestEntry,
    endpoints: HttpEndpoint.Service,
  ) => Effect.Effect<HttpEndpoint.Routed, ReconciliationError>;
  readonly unmount: (
    entry: ManifestEntry,
    endpoints: HttpEndpoint.Service,
  ) => Effect.Effect<void, ReconciliationError>;
  readonly mergeManifests: (
    manifests: ReadonlyArray<Manifest>,
  ) => Effect.Effect<Manifest, ReconciliationError>;
  readonly allows: (
    entry: ManifestEntry,
    event: DeliveredEvent,
  ) => Effect.Effect<boolean, InvalidConfiguration>;
}

export class Registry extends Context.Service<Registry, RegistryService>()(
  "macrograph/Plugin/HttpIngress/Registry",
) {}

export const makeRegistry = <RO, RI>(
  lives: ReadonlyArray<Live<RO, RI>>,
): Effect.Effect<RegistryService, InitializationError, RO | RI> =>
  Effect.gen(function* () {
    const handlers = yield* Effect.forEach(lives, (live) => live.build);
    const byId = new Map(handlers.map((handler) => [handler.id, handler]));
    if (byId.size !== handlers.length) {
      const duplicate = handlers.find(
        (handler, index) =>
          handlers.findIndex((candidate) => candidate.id === handler.id) !== index,
      );
      return yield* new InitializationError({
        handlerId: duplicate?.id ?? "unknown",
        cause: "Duplicate HTTP ingress handler id",
      });
    }

    return Registry.of({
      definitions: lives.map((live) => live.definition),
      handle: (request) => {
        const handler = byId.get(request.endpoint.handlerId);
        if (handler === undefined) return Effect.succeed({ status: 404, events: [] });
        if (request.method !== handler.method) return Effect.succeed({ status: 405, events: [] });
        return handler.handle(request);
      },
      mount: (entry, endpoints) => {
        const handler = byId.get(entry.handlerId);
        const definition = lives.find((live) => live.definition.id === entry.handlerId)?.definition;
        if (handler === undefined || definition?.pluginId !== entry.pluginId)
          return Effect.fail(
            new ReconciliationError({
              handlerId: entry.handlerId,
              instanceKey: entry.instanceKey,
              cause: "HTTP ingress handler is not registered",
            }),
          );
        return handler.mount(entry, endpoints);
      },
      unmount: (entry, endpoints) => {
        const handler = byId.get(entry.handlerId);
        const definition = lives.find((live) => live.definition.id === entry.handlerId)?.definition;
        if (handler === undefined || definition?.pluginId !== entry.pluginId)
          return Effect.fail(
            new ReconciliationError({
              handlerId: entry.handlerId,
              instanceKey: entry.instanceKey,
              cause: "HTTP ingress handler is not registered",
            }),
          );
        return handler.unmount(entry, endpoints);
      },
      mergeManifests: (manifests) => {
        const grouped = new Map<string, Array<ManifestEntry>>();
        for (const entry of manifests.flat()) {
          const key = JSON.stringify([entry.pluginId, entry.handlerId, entry.instanceKey]);
          const entries = grouped.get(key);
          if (entries === undefined) grouped.set(key, [entry]);
          else entries.push(entry);
        }
        return Effect.forEach(grouped.values(), (entries) => {
          const handler = byId.get(entries[0]?.handlerId ?? "");
          if (handler === undefined)
            return Effect.fail(
              new ReconciliationError({
                handlerId: entries[0]?.handlerId ?? "unknown",
                instanceKey: entries[0]?.instanceKey ?? "unknown",
                cause: "HTTP ingress handler is not registered",
              }),
            );
          return handler.merge(entries);
        });
      },
      allows: (entry, event) => {
        const handler = byId.get(entry.handlerId);
        return handler === undefined ? Effect.succeed(false) : handler.allows(entry, event);
      },
    });
  });

export const layer = <RO, RI>(lives: ReadonlyArray<Live<RO, RI>>) =>
  Layer.effect(Registry)(makeRegistry(lives));

export * as HttpIngress from "./HttpIngress.ts";
