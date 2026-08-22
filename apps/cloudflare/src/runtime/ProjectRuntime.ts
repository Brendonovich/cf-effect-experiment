import { HttpIngressRuntime } from "@macrograph/http-ingress";
import { HttpEndpoint, HttpIngress } from "@macrograph/plugin";
import kofiDeployment from "@macrograph/plugin-kofi/Deployment/Webhook";
import twitchDeployment from "@macrograph/plugin-twitch/Deployment/Webhook";
import { layerWebCrypto } from "@macrograph/plugin-twitch/EventSub/Webhook";
import { CloudCredentials } from "@macrograph/project-host";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpRouter, HttpServerResponse } from "effect/unstable/http";

import { DurableObjectHttpEndpointHost } from "../DurableObjectHttpEndpointHost.ts";
import { ObservabilityLayer } from "../Observability.ts";

export interface IngressRequest {
  readonly projectId: string;
  readonly endpointId: string;
  readonly method: string;
  readonly headers: ReadonlyArray<readonly [name: string, value: string]>;
  readonly body: Uint8Array;
}

export interface ProductionIngressEvent {
  readonly revisionId: string;
  readonly r2Key: string;
  readonly pluginId: string;
  readonly eventType: string;
  readonly eventId?: string;
  readonly payloadJson: string;
}

export interface DeployRequest {
  readonly projectId: string;
  readonly revisionId: string;
  readonly r2Key: string;
  readonly publicOrigin: string;
  readonly engines: Readonly<Record<string, unknown>>;
}

export interface PreviewRequest {
  readonly projectId: string;
  readonly publicOrigin: string;
  readonly previewId: string;
  readonly engines: Readonly<Record<string, unknown>>;
}

export interface StopPreviewRequest {
  readonly previewId: string;
}

export interface PreviewIngressEvent {
  readonly pluginId: string;
  readonly eventType: string;
  readonly eventId?: string;
  readonly payloadJson: string;
}

export interface IngressDispatch {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
  readonly receivedEvents: ReadonlyArray<PreviewIngressEvent>;
  readonly productionEvents: ReadonlyArray<ProductionIngressEvent>;
  readonly previewEvents: ReadonlyArray<PreviewIngressEvent>;
}

const JsonPayload = Schema.fromJsonString(Schema.Unknown);
const MountedEndpoint = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  handlerId: Schema.String,
  instanceKey: Schema.String,
  metadata: Schema.Unknown,
});
const ActiveDeployment = Schema.Struct({
  revisionId: Schema.String,
  r2Key: Schema.String,
  manifest: HttpIngress.Manifest,
  endpoints: Schema.Array(MountedEndpoint),
});
type ActiveDeployment = typeof ActiveDeployment.Type;
const PreviewDeployment = Schema.Struct({
  previewIds: Schema.Array(Schema.String),
  manifest: HttpIngress.Manifest,
  endpoints: Schema.Array(MountedEndpoint),
});
type PreviewDeployment = typeof PreviewDeployment.Type;
const activeDeploymentKey = "active-deployment";
const previewDeploymentKey = "preview-deployment";

export default class ProjectRuntime extends Cloudflare.DurableObject<ProjectRuntime>()(
  "ProjectRuntime",
  Effect.gen(function* () {
    const durableState = yield* Cloudflare.DurableObjectState;
    let publicOrigin = "http://localhost:1338";
    let activeProjectId: string | undefined;
    const endpointHostLayer = DurableObjectHttpEndpointHost.layer({
      namespace: "ingress",
      makeUrl: (id) => `${publicOrigin}/ingress/${activeProjectId ?? "unknown"}/${id}`,
    });

    return Effect.gen(function* () {
      const endpointHost = yield* HttpEndpoint.Host;
      const secrets = yield* HttpEndpoint.SecretStore;

      const ingressRegistry = yield* HttpIngress.makeRegistry([
        ...twitchDeployment.httpIngress.handlers,
        ...kofiDeployment.httpIngress.handlers,
      ]).pipe(
        Effect.provide(CloudCredentials.defaultLayer),
        Effect.provideService(HttpEndpoint.SecretStore, secrets),
        Effect.provide(layerWebCrypto(globalThis.crypto)),
        Effect.orDie,
      );
      const ingressRuntime = yield* HttpIngressRuntime.make(
        [twitchDeployment, kofiDeployment],
        ingressRegistry,
        endpointHost,
      ).pipe(Effect.orDie);

      const loadDeployment = Effect.fnUntraced(function* (key: string) {
        const stored = yield* durableState.storage.get(key);
        if (stored === undefined) return Option.none<ActiveDeployment>();
        return yield* Schema.decodeUnknownEffect(ActiveDeployment)(stored).pipe(Effect.option);
      });

      const loadPreview = Effect.fnUntraced(function* () {
        const stored = yield* durableState.storage.get(previewDeploymentKey);
        if (stored === undefined) return Option.none<PreviewDeployment>();
        return yield* Schema.decodeUnknownEffect(PreviewDeployment)(stored).pipe(Effect.option);
      });

      const entryFor = (
        manifest: HttpIngress.Manifest,
        endpoint: HttpEndpoint.Routed,
      ): HttpIngress.ManifestEntry | undefined =>
        manifest.find(
          (candidate) =>
            candidate.pluginId ===
              ingressRegistry.definitions.find((definition) => definition.id === endpoint.handlerId)
                ?.pluginId &&
            candidate.handlerId === endpoint.handlerId &&
            candidate.instanceKey === endpoint.instanceKey,
        );

      const providerManifest = (
        production: Option.Option<ActiveDeployment>,
        preview: Option.Option<PreviewDeployment>,
      ) =>
        ingressRuntime.mergeManifests([
          Option.match(production, { onNone: () => [], onSome: (value) => value.manifest }),
          Option.match(preview, { onNone: () => [], onSome: (value) => value.manifest }),
        ]);

      const handleIngress = Effect.fnUntraced(function* (request: IngressRequest) {
        activeProjectId = request.projectId;
        yield* Effect.logInfo("Dispatching ingress request", {
          projectId: request.projectId,
          endpointId: request.endpointId,
          method: request.method,
        });
        const production = yield* loadDeployment(activeDeploymentKey);
        const preview = yield* loadPreview();
        if (Option.isNone(production) && Option.isNone(preview)) {
          yield* Effect.logWarning("HttpIngress request has no active deployment or preview", {
            projectId: request.projectId,
            endpointId: request.endpointId,
          });
          return {
            status: 404,
            receivedEvents: [],
            productionEvents: [],
            previewEvents: [],
          };
        }
        const current = yield* endpointHost
          .lookup(request.endpointId)
          .pipe(Effect.catch(() => Effect.succeed(Option.none())));
        if (Option.isNone(current)) {
          yield* Effect.logWarning("HttpIngress endpoint was not found", {
            projectId: request.projectId,
            endpointId: request.endpointId,
          });
          return {
            status: 404,
            receivedEvents: [],
            productionEvents: [],
            previewEvents: [],
          };
        }
        const provider = yield* providerManifest(production, preview).pipe(Effect.orDie);
        const providerEntry = entryFor(provider, current.value);
        if (providerEntry === undefined) {
          yield* Effect.logWarning("HttpIngress endpoint is not in the active manifest", {
            projectId: request.projectId,
            endpointId: request.endpointId,
            handlerId: current.value.handlerId,
            instanceKey: current.value.instanceKey,
          });
          return {
            status: 404,
            receivedEvents: [],
            productionEvents: [],
            previewEvents: [],
          };
        }
        const response = yield* ingressRuntime.handle({
          endpoint: current.value,
          configuration: providerEntry.configuration,
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body: request.body,
        });
        yield* Effect.logInfo("HttpIngress payload handled", {
          projectId: request.projectId,
          endpointId: request.endpointId,
          handlerId: current.value.handlerId,
          status: response.status,
          eventCount: response.events.length,
        });
        const encoded = yield* Effect.forEach(response.events, (event) =>
          Schema.encodeUnknownEffect(JsonPayload)(event.payload).pipe(
            Effect.map((payloadJson) => ({ ...event, payloadJson })),
          ),
        );
        const receivedEvents: ReadonlyArray<PreviewIngressEvent> = encoded.map((event) =>
          event.eventId === undefined
            ? {
                pluginId: event.pluginId,
                eventType: event.eventType,
                payloadJson: event.payloadJson,
              }
            : {
                pluginId: event.pluginId,
                eventType: event.eventType,
                eventId: event.eventId,
                payloadJson: event.payloadJson,
              },
        );
        const events = Option.isNone(production)
          ? []
          : yield* Effect.forEach(encoded, (event) => {
              const entry = entryFor(production.value.manifest, current.value);
              if (entry === undefined)
                return Effect.succeed<ReadonlyArray<ProductionIngressEvent>>([]);
              return ingressRuntime.allows(entry, event).pipe(
                Effect.map(
                  (allowed): ReadonlyArray<ProductionIngressEvent> =>
                    !allowed
                      ? []
                      : [
                          event.eventId === undefined
                            ? {
                                revisionId: production.value.revisionId,
                                r2Key: production.value.r2Key,
                                pluginId: event.pluginId,
                                eventType: event.eventType,
                                payloadJson: event.payloadJson,
                              }
                            : {
                                revisionId: production.value.revisionId,
                                r2Key: production.value.r2Key,
                                pluginId: event.pluginId,
                                eventType: event.eventType,
                                eventId: event.eventId,
                                payloadJson: event.payloadJson,
                              },
                        ],
                ),
              );
            }).pipe(
              Effect.map((items) => items.flat()),
              Effect.orDie,
            );
        const previewEvents = Option.isNone(preview)
          ? []
          : yield* Effect.forEach(encoded, (event) => {
              const entry = entryFor(preview.value.manifest, current.value);
              if (entry === undefined)
                return Effect.succeed<ReadonlyArray<PreviewIngressEvent>>([]);
              return ingressRuntime.allows(entry, event).pipe(
                Effect.map(
                  (allowed): ReadonlyArray<PreviewIngressEvent> =>
                    !allowed
                      ? []
                      : [
                          event.eventId === undefined
                            ? {
                                pluginId: event.pluginId,
                                eventType: event.eventType,
                                payloadJson: event.payloadJson,
                              }
                            : {
                                pluginId: event.pluginId,
                                eventType: event.eventType,
                                eventId: event.eventId,
                                payloadJson: event.payloadJson,
                              },
                        ],
                ),
              );
            }).pipe(
              Effect.map((items) => items.flat()),
              Effect.orDie,
            );
        return {
          status: response.status,
          ...(response.body === undefined ? {} : { body: response.body }),
          ...(response.contentType === undefined ? {} : { contentType: response.contentType }),
          receivedEvents,
          productionEvents: events,
          previewEvents,
        } satisfies IngressDispatch;
      });

      const deploy = Effect.fnUntraced(function* (request: DeployRequest) {
        activeProjectId = request.projectId;
        publicOrigin = request.publicOrigin;
        const desired = yield* ingressRuntime.resolveManifest(request.engines).pipe(Effect.orDie);
        const previous = yield* loadDeployment(activeDeploymentKey);
        const preview = yield* loadPreview();
        const previousProvider = yield* providerManifest(previous, preview).pipe(Effect.orDie);
        const active: ActiveDeployment = {
          revisionId: request.revisionId,
          r2Key: request.r2Key,
          manifest: desired,
          endpoints: [],
        };
        yield* durableState.storage.put(activeDeploymentKey, active);
        const desiredProvider = yield* providerManifest(Option.some(active), preview).pipe(
          Effect.orDie,
        );
        const endpoints = yield* ingressRuntime.reconcile(previousProvider, desiredProvider).pipe(
          Effect.catchCause((cause) =>
            Option.match(previous, {
              onNone: () => durableState.storage.delete(activeDeploymentKey),
              onSome: (value) => durableState.storage.put(activeDeploymentKey, value),
            }).pipe(Effect.andThen(Effect.failCause(cause))),
          ),
          Effect.orDie,
        );
        const deployed: ActiveDeployment = { ...active, endpoints };
        yield* durableState.storage.put(activeDeploymentKey, deployed);
        return { revisionId: deployed.revisionId, endpoints: deployed.endpoints };
      });

      const preview = Effect.fnUntraced(function* (request: PreviewRequest) {
        activeProjectId = request.projectId;
        publicOrigin = request.publicOrigin;
        const production = yield* loadDeployment(activeDeploymentKey);
        const previous = yield* loadPreview();
        const previousProvider = yield* providerManifest(production, previous).pipe(Effect.orDie);
        const manifest = yield* ingressRuntime.resolveManifest(request.engines).pipe(Effect.orDie);
        const next: PreviewDeployment = {
          previewIds: [
            ...new Set([
              ...Option.match(previous, {
                onNone: () => [],
                onSome: (value) => value.previewIds,
              }),
              request.previewId,
            ]),
          ],
          manifest,
          endpoints: [],
        };
        yield* durableState.storage.put(previewDeploymentKey, next);
        const desiredProvider = yield* providerManifest(production, Option.some(next)).pipe(
          Effect.orDie,
        );
        const endpoints = yield* ingressRuntime.reconcile(previousProvider, desiredProvider).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Failed to reconcile editor preview ingress", cause).pipe(
              Effect.as<ReadonlyArray<HttpEndpoint.Routed>>(
                Option.match(previous, {
                  onNone: () => [],
                  onSome: (value) => value.endpoints,
                }),
              ),
            ),
          ),
        );
        const active: PreviewDeployment = { ...next, endpoints };
        yield* durableState.storage.put(previewDeploymentKey, active);
        return { endpoints };
      });

      const stopPreview = Effect.fnUntraced(function* (request: StopPreviewRequest) {
        const preview = yield* loadPreview();
        if (Option.isNone(preview) || !preview.value.previewIds.includes(request.previewId)) return;
        const previewIds = preview.value.previewIds.filter((id) => id !== request.previewId);
        if (previewIds.length > 0) {
          yield* durableState.storage.put(previewDeploymentKey, {
            ...preview.value,
            previewIds,
          } satisfies PreviewDeployment);
          return;
        }
        const production = yield* loadDeployment(activeDeploymentKey);
        const previousProvider = yield* providerManifest(production, preview).pipe(Effect.orDie);
        yield* durableState.storage.delete(previewDeploymentKey);
        const desiredProvider = yield* providerManifest(production, Option.none()).pipe(
          Effect.orDie,
        );
        yield* ingressRuntime.reconcile(previousProvider, desiredProvider).pipe(Effect.orDie);
      });

      const undeploy = Effect.fnUntraced(function* () {
        const previous = yield* loadDeployment(activeDeploymentKey);
        const preview = yield* loadPreview();
        const previousProvider = yield* providerManifest(previous, preview).pipe(Effect.orDie);
        yield* durableState.storage.delete(activeDeploymentKey);
        const desiredProvider = yield* providerManifest(Option.none(), preview).pipe(Effect.orDie);
        yield* ingressRuntime.reconcile(previousProvider, desiredProvider).pipe(Effect.orDie);
      });

      const getEndpoint = (handlerId: string, instanceKey: string) =>
        endpointHost
          .get(HttpEndpoint.handler(handlerId, Schema.Unknown), instanceKey)
          .pipe(Effect.map(Option.getOrUndefined));

      const lookupEndpoint = (endpointId: string) =>
        endpointHost.lookup(endpointId).pipe(Effect.map(Option.getOrUndefined));

      const upsertEndpointSecret = (endpointId: string) =>
        secrets.upsert(endpointId).pipe(Effect.map(Redacted.value));

      const fetch = Layer.mergeAll(
        HttpRouter.add(
          "GET",
          "/projects/:routeProjectId",
          Effect.gen(function* () {
            const { routeProjectId } = yield* HttpRouter.schemaParams(
              Schema.Struct({ routeProjectId: Schema.String }),
            );
            activeProjectId = routeProjectId;
            const deployment = yield* loadDeployment(activeDeploymentKey);
            const previewDeployment = yield* loadPreview();
            return yield* HttpServerResponse.json({
              projectId: routeProjectId,
              deployment: Option.match(deployment, {
                onNone: () => undefined,
                onSome: (active) => ({
                  revisionId: active.revisionId,
                  endpoints: active.endpoints,
                }),
              }),
              preview: Option.match(previewDeployment, {
                onNone: () => undefined,
                onSome: (active) => ({ endpoints: active.endpoints }),
              }),
            });
          }).pipe(Effect.orDie),
        ),
      ).pipe(HttpRouter.toHttpEffect, Effect.provide(ObservabilityLayer));

      return {
        fetch,
        httpIngress: handleIngress,
        deploy,
        preview,
        stopPreview,
        undeploy,
        getEndpoint,
        lookupEndpoint,
        upsertEndpointSecret,
      };
    }).pipe(Effect.provide(endpointHostLayer), Effect.provide(FetchHttpClient.layer));
  }).pipe(Effect.provide(ObservabilityLayer)),
) {}
