import { Cause, Context, Effect, Layer, Option, Schema } from "effect";

import * as HttpEndpoint from "./HttpEndpoint.ts";
import * as ModuleId from "./ModuleId.ts";

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

/** An encoded event produced by a handler; the registry adds the id of the module it belongs to. */
export interface EncodedEvent {
  readonly eventType: string;
  readonly eventId?: string;
  readonly payload: unknown;
}

export interface DeliveredEvent extends EncodedEvent {
  readonly moduleId: ModuleId.Id;
}

export interface HandlerResponse {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
  readonly events: ReadonlyArray<EncodedEvent>;
}

export interface Response extends HandlerResponse {
  readonly events: ReadonlyArray<DeliveredEvent>;
}

export class InitializationError extends Schema.TaggedError<InitializationError>()(
  "HttpIngressInitializationError",
  { handlerId: HttpEndpoint.HandlerId, cause: Schema.Unknown },
) {}

export class InvalidMetadata extends Schema.TaggedError<InvalidMetadata>()(
  "HttpIngressInvalidMetadata",
  { handlerId: HttpEndpoint.HandlerId, cause: Schema.Unknown },
) {}

export class InvalidConfiguration extends Schema.TaggedError<InvalidConfiguration>()(
  "HttpIngressInvalidConfiguration",
  { handlerId: HttpEndpoint.HandlerId, cause: Schema.Unknown },
) {}

export class EventEncodingError extends Schema.TaggedError<EventEncodingError>()(
  "HttpIngressEventEncodingError",
  { handlerId: HttpEndpoint.HandlerId, cause: Schema.Unknown },
) {}

export class ReconciliationError extends Schema.TaggedError<ReconciliationError>()(
  "HttpIngressReconciliationError",
  {
    handlerId: HttpEndpoint.HandlerId,
    instanceKey: HttpEndpoint.InstanceKey,
    cause: Schema.Unknown,
  },
) {
  override get message() {
    const error = Cause.isCause(this.cause) ? Cause.squash(this.cause) : this.cause;
    const reason =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : typeof error === "string"
          ? error
          : "Provider setup failed";
    return `Failed to configure ${this.handlerId}/${this.instanceKey}: ${reason}`;
  }
}

interface Handler {
  readonly id: HttpEndpoint.HandlerId;
  readonly method: string;
  readonly handle: (
    request: HttpRequest<unknown>,
  ) => Effect.Effect<HandlerResponse, InvalidMetadata | InvalidConfiguration | EventEncodingError>;
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
    event: EncodedEvent,
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
  readonly instanceKey: HttpEndpoint.InstanceKey;
  readonly displayName: string;
  readonly metadata: unknown;
  readonly configuration: unknown;
}

export const ManifestEntry = Schema.Struct({
  handlerId: HttpEndpoint.HandlerId,
  moduleId: ModuleId.Id,
  instanceKey: HttpEndpoint.InstanceKey,
  displayName: Schema.String,
  metadata: Schema.Unknown,
  configuration: Schema.Unknown,
});
export type ManifestEntry = typeof ManifestEntry.Type;

export const ManifestEntryKey = Schema.String.pipe(Schema.brand("HttpIngressManifestEntryKey"));
export type ManifestEntryKey = typeof ManifestEntryKey.Type;

export const manifestEntryKey = (entry: ManifestEntry): ManifestEntryKey =>
  ManifestEntryKey.make(JSON.stringify([entry.moduleId, entry.handlerId, entry.instanceKey]));

export const Manifest = Schema.Array(ManifestEntry);
export type Manifest = typeof Manifest.Type;

export interface HttpDefinition<
  Metadata,
  Event extends { readonly _tag: string },
  Configuration,
> extends HttpEndpoint.Handler<Metadata> {
  readonly displayName: string;
  readonly method: string;
  readonly event: Schema.Codec<Event, unknown, never, never>;
  readonly configuration: Schema.Codec<Configuration, unknown, never, never>;
  readonly require: (options: {
    readonly instanceKey: string;
    readonly displayName?: string;
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
  readonly displayName: string;
  readonly method: string;
  readonly configuration: Schema.Codec<unknown, unknown, never, never>;
}

export const make = <Metadata, Event extends { readonly _tag: string }, Configuration>(options: {
  readonly id: string;
  readonly displayName: string;
  readonly method: string;
  readonly metadata: Schema.Codec<Metadata, unknown, never, never>;
  readonly event: Schema.Codec<Event, unknown, never, never>;
  readonly configuration: Schema.Codec<Configuration, unknown, never, never>;
  readonly mergeConfiguration?: (current: Configuration, next: Configuration) => Configuration;
  readonly accepts?: (configuration: Configuration, eventType: Event["_tag"]) => boolean;
}): HttpDefinition<Metadata, Event, Configuration> => {
  const handlerId = HttpEndpoint.HandlerId.make(options.id);
  const definition: HttpDefinition<Metadata, Event, Configuration> = {
    id: handlerId,
    displayName: options.displayName,
    method: options.method,
    metadata: options.metadata,
    event: options.event,
    configuration: options.configuration,
    require: ({ instanceKey, displayName = options.displayName, metadata, configuration }) => ({
      definition,
      instanceKey: HttpEndpoint.InstanceKey.make(instanceKey),
      displayName,
      metadata,
      configuration,
    }),
    implement: (implementation) => {
      const make = implementation.pipe(
        Effect.mapError((cause) => new InitializationError({ handlerId, cause })),
        Effect.map((initialize) =>
          initialize.pipe(
            Effect.mapError((cause) => new InitializationError({ handlerId, cause })),
            Effect.map(
              (service): Handler => ({
                id: handlerId,
                method: options.method,
                handle: Effect.fnUntraced(function* (request) {
                  const metadata = yield* Schema.decodeUnknownEffect(options.metadata)(
                    request.endpoint.metadata,
                  ).pipe(Effect.mapError((cause) => new InvalidMetadata({ handlerId, cause })));
                  const response = yield* service.handle({
                    ...request,
                    endpoint: { ...request.endpoint, metadata },
                    configuration: yield* Schema.decodeUnknownEffect(options.configuration)(
                      request.configuration,
                    ).pipe(
                      Effect.mapError((cause) => new InvalidConfiguration({ handlerId, cause })),
                    ),
                  });
                  const events = yield* Effect.forEach(
                    response.events ?? [],
                    ({ event, eventId }) =>
                      Schema.encodeUnknownEffect(options.event)(event).pipe(
                        Effect.map(
                          (payload): EncodedEvent =>
                            eventId === undefined
                              ? { eventType: event._tag, payload }
                              : { eventType: event._tag, eventId, payload },
                        ),
                        Effect.mapError((cause) => new EventEncodingError({ handlerId, cause })),
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
                      displayName: entry.displayName,
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
                            handlerId,
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
                            handlerId,
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
                            handlerId,
                            instanceKey:
                              entries[0]?.instanceKey ?? HttpEndpoint.InstanceKey.make("unknown"),
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
                    Effect.mapError((cause) => new InvalidConfiguration({ handlerId, cause })),
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

export const manifest = (
  moduleId: ModuleId.Id,
  requirements: ReadonlyArray<Requirement>,
): Effect.Effect<Manifest> =>
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
          moduleId,
          instanceKey: requirement.instanceKey,
          displayName: requirement.displayName,
          metadata,
          configuration,
        }),
      ),
      Effect.orDie,
    ),
  );

/** A handler definition together with the module it was registered for. */
export interface RegisteredDefinition extends AnyHttpDefinition {
  readonly moduleId: ModuleId.Id;
}

export interface RegistryService {
  readonly definitions: ReadonlyArray<RegisteredDefinition>;
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

/** Coordinates registered HTTP ingress handlers, requests, endpoints, and manifests. */
export class Registry extends Context.Service<Registry, RegistryService>()(
  "macrograph/Module/HttpIngress/Registry",
) {}

/** The handlers of one module, registered under the id its host mounted it with. */
export interface ModuleHandlers<Lives extends ReadonlyArray<Live<any, any>>> {
  readonly moduleId: ModuleId.Id;
  readonly handlers: Lives;
}

export type HandlerServices<Modules extends ReadonlyArray<ModuleHandlers<ReadonlyArray<AnyLive>>>> =
  Modules[number]["handlers"][number] extends infer L
    ? L extends Live<infer RO, infer RI>
      ? RO | RI
      : never
    : never;

export const makeRegistry = <
  const Modules extends ReadonlyArray<ModuleHandlers<ReadonlyArray<Live<any, any>>>>,
>(
  modules: Modules,
): Effect.Effect<RegistryService, InitializationError, HandlerServices<Modules>> =>
  Effect.gen(function* () {
    const registered = modules.flatMap((module) =>
      module.handlers.map((live) => ({ moduleId: module.moduleId, live })),
    );
    const handlers = yield* Effect.forEach(registered, ({ moduleId, live }) =>
      Effect.map(live.build, (handler) => ({ moduleId, handler })),
    );
    const byId = new Map(handlers.map((entry) => [entry.handler.id, entry]));
    if (byId.size !== handlers.length) {
      const duplicate = handlers.find(
        (entry, index) =>
          handlers.findIndex((candidate) => candidate.handler.id === entry.handler.id) !== index,
      );
      return yield* new InitializationError({
        handlerId: duplicate?.handler.id ?? HttpEndpoint.HandlerId.make("unknown"),
        cause: "Duplicate HTTP ingress handler id",
      });
    }
    const forEntry = (entry: ManifestEntry) => {
      const registered = byId.get(entry.handlerId);
      return registered === undefined || registered.moduleId !== entry.moduleId
        ? Effect.fail(
            new ReconciliationError({
              handlerId: entry.handlerId,
              instanceKey: entry.instanceKey,
              cause: "HTTP ingress handler is not registered",
            }),
          )
        : Effect.succeed(registered.handler);
    };

    return Registry.of({
      definitions: registered.map(({ moduleId, live }) => ({ ...live.definition, moduleId })),
      handle: (request) => {
        const registered = byId.get(request.endpoint.schema.id);
        if (registered === undefined) return Effect.succeed({ status: 404, events: [] });
        if (request.method !== registered.handler.method)
          return Effect.succeed({ status: 405, events: [] });
        return registered.handler.handle(request).pipe(
          Effect.map((response) => ({
            ...response,
            events: response.events.map((event) => ({ ...event, moduleId: registered.moduleId })),
          })),
        );
      },
      mount: (entry, endpoints) =>
        Effect.flatMap(forEntry(entry), (handler) => handler.mount(entry, endpoints)),
      unmount: (entry, endpoints) =>
        Effect.flatMap(forEntry(entry), (handler) => handler.unmount(entry, endpoints)),
      mergeManifests: (manifests) => {
        const grouped = new Map<ManifestEntryKey, Array<ManifestEntry>>();
        for (const entry of manifests.flat()) {
          const key = manifestEntryKey(entry);
          const entries = grouped.get(key);
          if (entries === undefined) grouped.set(key, [entry]);
          else entries.push(entry);
        }
        return Effect.forEach(grouped.values(), (entries) => {
          const handler = byId.get(
            entries[0]?.handlerId ?? HttpEndpoint.HandlerId.make("unknown"),
          )?.handler;
          if (handler === undefined)
            return Effect.fail(
              new ReconciliationError({
                handlerId: entries[0]?.handlerId ?? HttpEndpoint.HandlerId.make("unknown"),
                instanceKey: entries[0]?.instanceKey ?? HttpEndpoint.InstanceKey.make("unknown"),
                cause: "HTTP ingress handler is not registered",
              }),
            );
          return handler.merge(entries);
        });
      },
      allows: (entry, event) => {
        const registered = byId.get(entry.handlerId);
        return registered === undefined || registered.moduleId !== event.moduleId
          ? Effect.succeed(false)
          : registered.handler.allows(entry, event);
      },
    });
  });

export const layer = <
  const Modules extends ReadonlyArray<ModuleHandlers<ReadonlyArray<Live<any, any>>>>,
>(
  modules: Modules,
) => Layer.effect(Registry)(makeRegistry(modules));

export * as HttpIngress from "./HttpIngress.ts";
