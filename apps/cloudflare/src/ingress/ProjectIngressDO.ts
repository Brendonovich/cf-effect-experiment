import { HttpIngressRuntime } from "@macrograph/http-ingress";
import { Queue } from "@macrograph/core";
import { HttpEndpoint, HttpIngress } from "@macrograph/plugin";
import kofiDeployment from "@macrograph/plugin-kofi/Deployment/Webhook";
import twitchDeployment from "@macrograph/plugin-twitch/Deployment/Webhook";
import { layerWebCrypto } from "@macrograph/plugin-twitch/EventSub/Webhook";
import UtilitiesPlugin from "@macrograph/plugin-utilities";
import { TickEvent } from "@macrograph/plugin-utilities/Definition";
import * as Cloudflare from "alchemy/Cloudflare";
import { Clock, Effect, Option, Redacted, Schema, Tracer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { serviceSpanAnnotations } from "../Observability.ts";
import { DeploymentObjectKey } from "../deployment/DeploymentObjectKey.ts";
import { AppCredentialsLayer as TwitchAppCredentialsLayer } from "../TwitchCredentials.ts";
import { DurableObjectHttpEndpointHost } from "./DurableObjectHttpEndpointHost.ts";
import * as FunctionQueueProtocol from "../execution/FunctionQueueProtocol.ts";
import * as ProjectFunctionQueues from "../execution/ProjectFunctionQueues.ts";

export interface IngressRequest {
  readonly projectId: string;
  readonly endpointId: HttpEndpoint.Id;
  readonly method: string;
  readonly headers: ReadonlyArray<readonly [name: string, value: string]>;
  readonly body: Uint8Array;
  readonly traceContext?: {
    readonly traceId: string;
    readonly spanId: string;
    readonly sampled: boolean;
  };
}

export interface RuntimeEvent {
  readonly deploymentId: string;
  readonly r2Key: DeploymentObjectKey;
  readonly ingressEventId: string;
  readonly pluginId: string;
  readonly eventType: string;
  readonly eventId?: string;
  readonly payloadJson: string;
}

export interface DeployRequest {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly r2Key: DeploymentObjectKey;
  readonly publicOrigin: string;
  readonly engines: Readonly<Record<string, unknown>>;
  readonly utilitiesTickEnabled: boolean;
  readonly queueIds?: ReadonlyArray<string>;
}

export interface PreviewRequest {
  readonly projectId: string;
  readonly publicOrigin: string;
  readonly previewId: string;
  readonly engines: Readonly<Record<string, unknown>>;
  readonly remount?: boolean;
}

export interface StopPreviewRequest {
  readonly previewId: string;
}

export interface IngressEvent {
  readonly id: string;
  readonly pluginId: string;
  readonly eventType: string;
  readonly eventId?: string;
  readonly payloadJson: string;
  readonly previewOnly: boolean;
  readonly previewGeneration?: string;
}

export interface IngressDispatch {
  readonly status: number;
  readonly body?: string;
  readonly contentType?: string;
  readonly previewGeneration?: string;
  readonly ingressEvents: ReadonlyArray<IngressEvent>;
  readonly events: ReadonlyArray<RuntimeEvent>;
}

const JsonPayload = Schema.fromJsonString(Schema.Unknown);
const MountedEndpoint = HttpEndpoint.Routed;
const AppliedDeployment = Schema.Struct({
  projectId: Schema.optionalKey(Schema.String),
  deploymentId: Schema.String,
  r2Key: DeploymentObjectKey,
  manifest: HttpIngress.Manifest,
  endpoints: Schema.Array(MountedEndpoint),
});
type AppliedDeployment = typeof AppliedDeployment.Type;
const PreviewDeployment = Schema.Struct({
  generation: Schema.optionalKey(Schema.String),
  reconciliationPending: Schema.optionalKey(Schema.Boolean),
  previewIds: Schema.Array(Schema.String),
  manifest: HttpIngress.Manifest,
  endpoints: Schema.Array(MountedEndpoint),
});
type PreviewDeployment = typeof PreviewDeployment.Type;
const appliedDeploymentKey = "active-deployment";
const previewDeploymentKey = "preview-deployment";
const utilitiesTickEventId = "utilities:tick";
const utilitiesTickCountKey = "utilities:tick-count";

interface WorkflowBinding {
  readonly create: (options: {
    readonly id: string;
    readonly params: Readonly<Record<string, unknown>>;
  }) => Promise<unknown>;
}

const isWorkflowBinding = (value: unknown): value is WorkflowBinding =>
  typeof value === "object" &&
  value !== null &&
  "create" in value &&
  typeof value.create === "function";

export const projectIngressImplementation = Effect.gen(function* () {
  const durableState = yield* Cloudflare.DurableObjectState;
  const workerEnvironment = yield* Cloudflare.WorkerEnvironment;
  const functionQueues = yield* ProjectFunctionQueues.make({
    load: durableState.storage.get(ProjectFunctionQueues.storageKey),
    save: (metadata) => durableState.storage.put(ProjectFunctionQueues.storageKey, metadata),
    wake: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      yield* Cloudflare.Workers.scheduleEvent(ProjectFunctionQueues.alarmId, new Date(now + 5_000), {}, 5_000);
    }),
    sleep: Cloudflare.Workers.cancelEvent(ProjectFunctionQueues.alarmId),
    send: (delivery) => Effect.tryPromise({
      try: () => FunctionQueueProtocol.queueBinding(workerEnvironment?.FunctionWorkQueue).send(delivery),
      catch: (error) => error,
    }),
    workflows: {
      create: (options) => FunctionQueueProtocol.workflowBinding(workerEnvironment?.FunctionExecutionWorkflow).create(options),
      get: (id) => FunctionQueueProtocol.workflowBinding(workerEnvironment?.FunctionExecutionWorkflow).get(id),
    },
  });
  let publicOrigin = "http://localhost:1338";
  let activeProjectId: string | undefined;
  const endpointHostLayer = DurableObjectHttpEndpointHost.layer({
    namespace: "ingress",
    makeUrl: (id) => `${publicOrigin}/ingress/${activeProjectId ?? "unknown"}/${id}`,
  });

  return Effect.gen(function* () {
    const endpointHost = yield* HttpEndpoint.Host;

    const ingressRegistry = yield* HttpIngress.makeRegistry([
      ...twitchDeployment.httpIngress.handlers,
      ...kofiDeployment.httpIngress.handlers,
    ]).pipe(Effect.provide(layerWebCrypto(globalThis.crypto)), Effect.orDie);
    const ingressRuntime = yield* HttpIngressRuntime.make(
      [twitchDeployment, kofiDeployment],
      ingressRegistry,
      endpointHost,
    ).pipe(Effect.orDie);

    const loadAppliedDeployment = Effect.fnUntraced(function* () {
      const stored = yield* durableState.storage.get(appliedDeploymentKey);
      if (stored === undefined) return Option.none<AppliedDeployment>();
      const deployment =
        typeof stored === "object" &&
        stored !== null &&
        !("deploymentId" in stored) &&
        "revisionId" in stored
          ? { ...stored, deploymentId: stored.revisionId }
          : stored;
      return yield* Schema.decodeUnknownEffect(AppliedDeployment)(deployment).pipe(Effect.option);
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
            ingressRegistry.definitions.find((definition) => definition.id === endpoint.schema.id)
              ?.pluginId &&
          candidate.handlerId === endpoint.schema.id &&
          candidate.instanceKey === endpoint.instanceKey,
      );

    const providerManifest = (
      production: Option.Option<AppliedDeployment>,
      preview: Option.Option<PreviewDeployment>,
    ) =>
      ingressRuntime.mergeManifests([
        Option.match(production, { onNone: () => [], onSome: (value) => value.manifest }),
        Option.match(preview, { onNone: () => [], onSome: (value) => value.manifest }),
      ]);

    const originChanged = (
      origin: string,
      production: Option.Option<AppliedDeployment>,
      preview: Option.Option<PreviewDeployment>,
    ) =>
      [
        ...Option.match(production, { onNone: () => [], onSome: (value) => value.endpoints }),
        ...Option.match(preview, { onNone: () => [], onSome: (value) => value.endpoints }),
      ].some((endpoint) => new URL(endpoint.url).origin !== origin);

    const handleIngressImpl = Effect.fnUntraced(function* (request: IngressRequest) {
      activeProjectId = request.projectId;
      yield* Effect.logInfo("Dispatching ingress request", {
        projectId: request.projectId,
        endpointId: request.endpointId,
        method: request.method,
      });
      const production = yield* loadAppliedDeployment();
      const preview = yield* loadPreview();
      if (Option.isNone(production) && Option.isNone(preview)) {
        yield* Effect.logWarning("HttpIngress request has no active deployment or preview", {
          projectId: request.projectId,
          endpointId: request.endpointId,
        });
        return {
          status: 404,
          ingressEvents: [],
          events: [],
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
          ingressEvents: [],
          events: [],
        };
      }
      const provider = yield* providerManifest(production, preview).pipe(Effect.orDie);
      const providerEntry = entryFor(provider, current.value);
      if (providerEntry === undefined) {
        yield* Effect.logWarning("HttpIngress endpoint is not in the active manifest", {
          projectId: request.projectId,
          endpointId: request.endpointId,
          handlerId: current.value.schema.id,
          instanceKey: current.value.instanceKey,
        });
        return {
          status: 404,
          ingressEvents: [],
          events: [],
        };
      }
      const response = yield* ingressRuntime
        .handle({
          endpoint: current.value,
          configuration: providerEntry.configuration,
          method: request.method,
          headers: Object.fromEntries(request.headers),
          body: request.body,
        })
        .pipe(Effect.withSpan("ProjectIngressDO.invokeIngressHandler"));
      yield* Effect.logInfo("HttpIngress payload handled", {
        projectId: request.projectId,
        endpointId: request.endpointId,
        handlerId: current.value.schema.id,
        status: response.status,
        eventCount: response.events.length,
      });
      const encoded = yield* Effect.forEach(response.events, (event) =>
        Schema.encodeUnknownEffect(JsonPayload)(event.payload).pipe(
          Effect.map((payloadJson) => ({ ...event, payloadJson })),
        ),
      );
      const identified = encoded.map((event) => ({
        ...event,
        ingressEventId: crypto.randomUUID(),
      }));
      const productionEntry = Option.isSome(production)
        ? entryFor(production.value.manifest, current.value)
        : undefined;
      const previewEntry = Option.isSome(preview)
        ? entryFor(preview.value.manifest, current.value)
        : undefined;
      const previewGeneration = Option.isSome(preview) ? preview.value.generation : undefined;
      const routed = yield* Effect.forEach(identified, (event) =>
        Effect.all({
          productionAllowed:
            productionEntry === undefined
              ? Effect.succeed(false)
              : ingressRuntime.allows(productionEntry, event),
          previewAllowed:
            previewEntry === undefined
              ? Effect.succeed(false)
              : ingressRuntime.allows(previewEntry, event),
        }).pipe(Effect.map((allowed) => ({ ...allowed, event }))),
      ).pipe(Effect.orDie);
      const ingressEvents: ReadonlyArray<IngressEvent> = routed.flatMap(
        ({ event, productionAllowed, previewAllowed }) =>
          !productionAllowed && !previewAllowed
            ? []
            : [
                event.eventId === undefined
                  ? {
                      id: event.ingressEventId,
                      pluginId: event.pluginId,
                      eventType: event.eventType,
                      payloadJson: event.payloadJson,
                      previewOnly: !productionAllowed,
                      ...(previewGeneration === undefined ? {} : { previewGeneration }),
                    }
                  : {
                      id: event.ingressEventId,
                      pluginId: event.pluginId,
                      eventType: event.eventType,
                      eventId: event.eventId,
                      payloadJson: event.payloadJson,
                      previewOnly: !productionAllowed,
                      ...(previewGeneration === undefined ? {} : { previewGeneration }),
                    },
              ],
      );
      const events: ReadonlyArray<RuntimeEvent> = Option.isNone(production)
        ? []
        : routed.flatMap(({ event, productionAllowed }) =>
            !productionAllowed
              ? []
              : [
                  event.eventId === undefined
                    ? {
                        deploymentId: production.value.deploymentId,
                        r2Key: production.value.r2Key,
                        ingressEventId: event.ingressEventId,
                        pluginId: event.pluginId,
                        eventType: event.eventType,
                        payloadJson: event.payloadJson,
                      }
                    : {
                        deploymentId: production.value.deploymentId,
                        r2Key: production.value.r2Key,
                        ingressEventId: event.ingressEventId,
                        pluginId: event.pluginId,
                        eventType: event.eventType,
                        eventId: event.eventId,
                        payloadJson: event.payloadJson,
                      },
                ],
          );
      return {
        status: response.status,
        ...(response.body === undefined ? {} : { body: response.body }),
        ...(response.contentType === undefined ? {} : { contentType: response.contentType }),
        ...(previewGeneration === undefined ? {} : { previewGeneration }),
        ingressEvents,
        events,
      } satisfies IngressDispatch;
    });

    const handleIngress = (request: IngressRequest) =>
      handleIngressImpl(request).pipe(
        Effect.withSpan("ProjectIngressDO.handleIngress", {
          kind: "consumer",
          ...(request.traceContext === undefined
            ? {}
            : { parent: Tracer.externalSpan(request.traceContext) }),
          annotations: serviceSpanAnnotations("macrograph-project-ingress-do"),
          attributes: {
            "macrograph.project.id": request.projectId,
            "macrograph.ingress.endpoint.id": request.endpointId,
          },
        }),
      );

    const deploy = Effect.fn("ProjectIngressDO.deploy")(function* (request: DeployRequest) {
      activeProjectId = request.projectId;
      publicOrigin = request.publicOrigin;
      const desired = yield* ingressRuntime.resolveManifest(request.engines).pipe(Effect.orDie);
      const previous = yield* loadAppliedDeployment();
      const preview = yield* loadPreview();
      const previousProvider = yield* providerManifest(previous, preview).pipe(Effect.orDie);
      const active: AppliedDeployment = {
        projectId: request.projectId,
        deploymentId: request.deploymentId,
        r2Key: request.r2Key,
        manifest: desired,
        endpoints: [],
      };
      yield* durableState.storage.put(appliedDeploymentKey, active);
      const desiredProvider = yield* providerManifest(Option.some(active), preview).pipe(
        Effect.orDie,
      );
      const endpoints = yield* ingressRuntime
        .reconcile(previousProvider, desiredProvider, {
          remount: originChanged(request.publicOrigin, previous, preview),
        })
        .pipe(
          Effect.catchCause((cause) =>
            Option.match(previous, {
              onNone: () => durableState.storage.delete(appliedDeploymentKey),
              onSome: (value) => durableState.storage.put(appliedDeploymentKey, value),
            }).pipe(Effect.andThen(Effect.failCause(cause))),
          ),
          Effect.orDie,
        );
      const deployed: AppliedDeployment = {
        ...active,
        endpoints: endpoints.filter((endpoint) => entryFor(desired, endpoint) !== undefined),
      };
      yield* durableState.storage.put(appliedDeploymentKey, deployed);
      yield* functionQueues.configure({ projectId: request.projectId, deploymentId: request.deploymentId,
        r2Key: request.r2Key }, request.queueIds ?? []);
      if (Option.isSome(preview)) {
        yield* durableState.storage.put(previewDeploymentKey, {
          ...preview.value,
          endpoints: endpoints.filter(
            (endpoint) => entryFor(preview.value.manifest, endpoint) !== undefined,
          ),
        } satisfies PreviewDeployment);
      }
      if (request.utilitiesTickEnabled) {
        const storedTick = yield* durableState.storage.get(utilitiesTickCountKey);
        if (typeof storedTick !== "number" || !Number.isSafeInteger(storedTick) || storedTick < 0) {
          yield* durableState.storage.put(utilitiesTickCountKey, 0);
        }
        const now = yield* Clock.currentTimeMillis;
        yield* Cloudflare.Workers.scheduleEvent(
          utilitiesTickEventId,
          new Date(now + 1_000),
          {},
          1_000,
        );
      } else {
        yield* Cloudflare.Workers.cancelEvent(utilitiesTickEventId);
      }
      return { deploymentId: deployed.deploymentId, endpoints: deployed.endpoints };
    });

    const preview = Effect.fn("ProjectIngressDO.preview")(function* (request: PreviewRequest) {
      activeProjectId = request.projectId;
      publicOrigin = request.publicOrigin;
      const production = yield* loadAppliedDeployment();
      const previous = yield* loadPreview();
      const previousProvider = yield* providerManifest(production, previous).pipe(Effect.orDie);
      const manifest = yield* ingressRuntime.resolveManifest(request.engines).pipe(Effect.orDie);
      const next: PreviewDeployment = {
        generation: crypto.randomUUID(),
        reconciliationPending: true,
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
        endpoints: Option.match(previous, {
          onNone: () => [],
          onSome: (value) =>
            value.endpoints.filter((endpoint) => entryFor(manifest, endpoint) !== undefined),
        }),
      };
      // Track both old and attempted resources until every mount and cleanup has succeeded.
      yield* durableState.storage.put(previewDeploymentKey, {
        ...next,
        manifest: yield* ingressRuntime.mergeManifests([
          Option.match(previous, { onNone: () => [], onSome: (value) => value.manifest }),
          manifest,
        ]).pipe(Effect.orDie),
      } satisfies PreviewDeployment);
      const desiredProvider = yield* providerManifest(production, Option.some(next)).pipe(
        Effect.orDie,
      );
      const endpoints = yield* ingressRuntime
        .reconcile(previousProvider, desiredProvider, {
          remount:
            request.remount === true ||
            (Option.isSome(previous) && previous.value.reconciliationPending === true) ||
            originChanged(request.publicOrigin, production, previous),
        })
        // Keep failed manifests for partial-subscription cleanup, but never reuse a failed mount.
        .pipe(Effect.orDie);
      const active: PreviewDeployment = {
        ...next,
        reconciliationPending: false,
        endpoints: endpoints.filter((endpoint) => entryFor(manifest, endpoint) !== undefined),
      };
      yield* durableState.storage.put(previewDeploymentKey, active);
      if (Option.isSome(production)) {
        yield* durableState.storage.put(appliedDeploymentKey, {
          ...production.value,
          endpoints: endpoints.filter(
            (endpoint) => entryFor(production.value.manifest, endpoint) !== undefined,
          ),
        } satisfies AppliedDeployment);
      }
      return { endpoints: active.endpoints };
    });

    const stopPreview = Effect.fn("ProjectIngressDO.stopPreview")(function* (
      request: StopPreviewRequest,
    ) {
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
      const production = yield* loadAppliedDeployment();
      const previousProvider = yield* providerManifest(production, preview).pipe(Effect.orDie);
      yield* durableState.storage.delete(previewDeploymentKey);
      const desiredProvider = yield* providerManifest(production, Option.none()).pipe(Effect.orDie);
      yield* ingressRuntime.reconcile(previousProvider, desiredProvider).pipe(Effect.orDie);
    });

    const undeploy = Effect.fn("ProjectIngressDO.undeploy")(function* () {
      const previous = yield* loadAppliedDeployment();
      const preview = yield* loadPreview();
      const previousProvider = yield* providerManifest(previous, preview).pipe(Effect.orDie);
      yield* durableState.storage.delete(appliedDeploymentKey);
      if (Option.isSome(previous) && previous.value.projectId !== undefined) yield* functionQueues.stop({
        projectId: previous.value.projectId, deploymentId: previous.value.deploymentId, r2Key: previous.value.r2Key,
      });
      const desiredProvider = yield* providerManifest(Option.none(), preview).pipe(Effect.orDie);
      yield* ingressRuntime.reconcile(previousProvider, desiredProvider).pipe(Effect.orDie);
      yield* Cloudflare.Workers.cancelEvent(utilitiesTickEventId);
    });

    const alarm = Effect.gen(function* () {
      const events = yield* Cloudflare.Workers.processScheduledEvents;
      if (events.some((event) => event.id === ProjectFunctionQueues.alarmId)) yield* functionQueues.reconcile;
      if (!events.some((event) => event.id === utilitiesTickEventId)) return;
      const deployment = yield* loadAppliedDeployment();
      if (Option.isNone(deployment) || deployment.value.projectId === undefined) {
        yield* Cloudflare.Workers.cancelEvent(utilitiesTickEventId);
        return;
      }
      const binding = workerEnvironment?.GraphExecutionWorkflow;
      if (!isWorkflowBinding(binding))
        return yield* Effect.die("GraphExecutionWorkflow binding is unavailable");
      const stored = yield* durableState.storage.get(utilitiesTickCountKey);
      const tick =
        typeof stored === "number" && Number.isSafeInteger(stored) && stored >= 0 ? stored + 1 : 1;
      if (!Number.isSafeInteger(tick))
        return yield* Effect.die("Utilities tick counter exceeded the safe integer range");
      yield* durableState.storage.put(utilitiesTickCountKey, tick);
      const executionId = `${deployment.value.projectId}:utilities:tick:${tick}`;
      yield* Effect.tryPromise({
        try: () =>
          binding.create({
            id: executionId,
            params: {
              executionId,
              projectId: deployment.value.projectId,
              projectEventId: executionId,
              source: "timer",
              deploymentId: deployment.value.deploymentId,
              r2Key: deployment.value.r2Key,
              pluginId: UtilitiesPlugin.id,
              eventType: "TickEvent",
              providerEventId: String(tick),
              event: JSON.stringify(new TickEvent({ tick })),
            },
          }),
        catch: (cause) => cause,
      });
    }).pipe(Effect.withSpan("ProjectIngressDO.alarm"), Effect.orDie);

    const getEndpoint = Effect.fn("ProjectIngressDO.getEndpoint")(
      (handlerId: string, instanceKey: string) =>
        endpointHost
          .get(HttpEndpoint.handler(handlerId, Schema.Unknown), instanceKey)
          .pipe(Effect.map(Option.getOrUndefined)),
    );

    const lookupEndpoint = Effect.fn("ProjectIngressDO.lookupEndpoint")(
      (endpointId: HttpEndpoint.Id) =>
        endpointHost.lookup(endpointId).pipe(Effect.map(Option.getOrUndefined)),
    );

    const endpointSecret = Effect.fn("ProjectIngressDO.endpointSecret")(
      (endpointId: HttpEndpoint.Id) =>
        endpointHost.secret(endpointId).pipe(Effect.map(Redacted.value)),
    );

    const ingressState = Effect.fn("ProjectIngressDO.ingressState")(function* () {
      const deployment = yield* loadAppliedDeployment();
      const previewDeployment = yield* loadPreview();
      return {
        deployment: Option.match(deployment, {
          onNone: () => undefined,
          onSome: (active) => ({
            deploymentId: active.deploymentId,
            endpoints: active.endpoints.filter(
              (endpoint) => entryFor(active.manifest, endpoint) !== undefined,
            ),
          }),
        }),
        preview: Option.match(previewDeployment, {
          onNone: () => undefined,
          onSome: (active) => ({
            endpoints: active.endpoints.filter(
              (endpoint) => entryFor(active.manifest, endpoint) !== undefined,
            ),
          }),
        }),
      };
    });

    return {
      alarm,
      httpIngress: handleIngress,
      deploy,
      preview,
      stopPreview,
      undeploy,
      ingressState,
      getEndpoint,
      lookupEndpoint,
      endpointSecret,
      queueEnqueue: functionQueues.enqueue,
      queueDeliver: functionQueues.deliver,
      queueInspect: functionQueues.inspect,
      queueSnapshot: functionQueues.snapshot,
      queuePause: functionQueues.pause,
      queueAdvance: functionQueues.advance,
      queueRemove: functionQueues.remove,
      queueClear: functionQueues.clear,
    };
  }).pipe(
    Effect.provide(endpointHostLayer),
    Effect.provide(FetchHttpClient.layer),
    Effect.provide(TwitchAppCredentialsLayer),
  );
});

export type ProjectIngressShape = Effect.Success<Effect.Success<typeof projectIngressImplementation>>;

/**
 * Owns each project's webhooks and shared production/preview subscriptions.
 * The DO provides one endpoint coordinator and durable alarms for recurring
 * ticks; stateless code plus a database would also need a scheduler.
 */
export default class ProjectIngressDO extends Cloudflare.DurableObject<
  ProjectIngressDO,
  ProjectIngressShape
>()("ProjectIngressDO", { transferredFrom: "CloudWorker" }) {}

export const ProjectIngressDOLayer = ProjectIngressDO.make<never>(projectIngressImplementation);
