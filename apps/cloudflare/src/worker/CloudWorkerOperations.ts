import { Project, Queue } from "@macrograph/core";
import { HttpEndpoint } from "@macrograph/plugin";
import UtilitiesPlugin from "@macrograph/plugin-utilities";
import * as Cloudflare from "alchemy/Cloudflare";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Cause, Effect, Schema } from "effect";

import type { DeploymentObjectKey } from "../deployment/DeploymentObjectKey.ts";

import * as Database from "../database/Database.ts";
import {
  projectDeployments,
  projectIngressDesired,
  projectIngressEndpoints,
  projectIngressEvents,
  projects,
} from "../database/DatabaseSchema.ts";
import GraphExecutionWorkflow, {
  type GraphExecutionWorkflowInput,
} from "../execution/GraphExecutionWorkflow.ts";
import ProjectIngressDO from "../ingress/ProjectIngressDO.ts";

interface DesiredDeployment {
  readonly deploymentId: string;
  readonly r2Key: DeploymentObjectKey;
}

export interface ReconcileProjectRequest {
  readonly projectId: string;
  readonly publicOrigin: string;
}

export interface HandleIngressRequest {
  readonly projectId: string;
  readonly endpointId: HttpEndpoint.Id;
  readonly method: string;
  readonly headers: ReadonlyArray<readonly [name: string, value: string]>;
  readonly body: Uint8Array;
}

export interface PreviewProjectRequest {
  readonly projectId: string;
  readonly publicOrigin: string;
  readonly previewId: string;
  readonly engines: Readonly<Record<string, unknown>>;
  readonly remount?: boolean;
}

export const make = (deploymentsResource: Cloudflare.R2.Bucket) =>
  Effect.gen(function* () {
    const executionWorkflow = yield* GraphExecutionWorkflow;
    const projectIngressDos = yield* ProjectIngressDO;
    const database = yield* Database.Service;
    const deployments = yield* Cloudflare.R2.ReadBucket(deploymentsResource);

    // Durable object state is provided inside the remote object, not by its RPC caller.
    const callIngress = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect as Effect.Effect<A, E, Exclude<R, Cloudflare.DurableObjectState>>;

    const endpointFromRow = (
      row: typeof projectIngressEndpoints.$inferSelect,
    ): HttpEndpoint.Routed => ({
      id: HttpEndpoint.Id.make(row.endpointId),
      url: row.url,
      schema: {
        id: HttpEndpoint.HandlerId.make(row.handlerId),
        displayName: row.schemaDisplayName,
      },
      instanceKey: HttpEndpoint.InstanceKey.make(row.instanceKey),
      ...(row.displayName === null ? {} : { displayName: row.displayName }),
      metadata: row.metadata,
    });

    const updateActualEndpoints = Effect.fnUntraced(function* (projectId: string) {
      const state = yield* projectIngressDos.getByName(projectId).ingressState().pipe(Effect.orDie);
      const deployed = state.deployment?.endpoints ?? [];
      const preview = state.preview?.endpoints ?? [];
      const endpoints = [
        ...deployed,
        ...preview.filter(
          (endpoint) => !deployed.some((candidate) => candidate.id === endpoint.id),
        ),
      ];
      yield* database
        .transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction
              .delete(projectIngressEndpoints)
              .where(eq(projectIngressEndpoints.projectId, projectId));
            if (endpoints.length > 0) {
              yield* transaction.insert(projectIngressEndpoints).values(
                endpoints.map((endpoint) => ({
                  projectId,
                  endpointId: endpoint.id,
                  handlerId: endpoint.schema.id,
                  instanceKey: endpoint.instanceKey,
                  url: endpoint.url,
                  schemaDisplayName: endpoint.schema.displayName,
                  displayName: endpoint.displayName ?? null,
                  metadata: endpoint.metadata,
                  deployed: deployed.some((candidate) => candidate.id === endpoint.id),
                  preview: preview.some((candidate) => candidate.id === endpoint.id),
                })),
              );
            }
            yield* transaction
              .update(projectIngressDesired)
              .set({ status: "applied", error: null })
              .where(eq(projectIngressDesired.projectId, projectId));
          }),
        )
        .pipe(Effect.orDie);
    });

    const recordReconciliationFailure = <A, E, R>(
      projectId: string,
      effect: Effect.Effect<A, E, R>,
    ) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          database
            .update(projectIngressDesired)
            .set({ status: "error", error: String(Cause.squash(cause)) })
            .where(eq(projectIngressDesired.projectId, projectId))
            .pipe(Effect.orDie, Effect.andThen(Effect.failCause(cause))),
        ),
      );

    const loadDesiredDeployment = Effect.fnUntraced(function* (projectId: string) {
      const rows = yield* database
        .select({
          deploymentId: projectDeployments.id,
          r2Key: projectDeployments.r2Key,
        })
        .from(projects)
        .innerJoin(projectDeployments, eq(projectDeployments.id, projects.currentDeploymentId))
        .where(eq(projects.id, projectId))
        .limit(1)
        .pipe(Effect.orDie);
      const deployment: DesiredDeployment | undefined = rows[0];
      if (deployment === undefined)
        return yield* Effect.die(`Project ${projectId} has no desired deployed deployment`);
      const object = yield* deployments.get(deployment.r2Key).pipe(Effect.orDie);
      if (object === null)
        return yield* Effect.die(`Project deployment ${deployment.r2Key} not found`);
      const json = yield* object.text().pipe(Effect.orDie);
      const project = yield* Effect.try({
        try: () => JSON.parse(json),
        catch: (cause) => cause,
      }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Project.Model)), Effect.orDie);
      return { ...deployment, project };
    });

    const reconcileProjectDeployment = Effect.fnUntraced(function* (
      request: ReconcileProjectRequest,
    ) {
      yield* database
        .insert(projectIngressDesired)
        .values({ projectId: request.projectId, publicOrigin: request.publicOrigin, generation: 1 })
        .onConflictDoUpdate({
          target: projectIngressDesired.projectId,
          set: {
            publicOrigin: request.publicOrigin,
            generation: sql`${projectIngressDesired.generation} + 1`,
            status: "pending",
            error: null,
          },
        })
        .pipe(Effect.orDie);
      return yield* recordReconciliationFailure(
        request.projectId,
        Effect.gen(function* () {
          const deployment = yield* loadDesiredDeployment(request.projectId);
          const result = yield* projectIngressDos
            .getByName(request.projectId)
            .deploy({
              projectId: request.projectId,
              deploymentId: deployment.deploymentId,
              r2Key: deployment.r2Key,
              publicOrigin: request.publicOrigin,
              engines: deployment.project.engines,
              queueIds: Object.keys(deployment.project.queues),
              utilitiesTickEnabled: Object.values(deployment.project.graphs).some((graph) =>
                Object.values(graph.nodes).some(
                  (node) =>
                    node.schema.package === UtilitiesPlugin.id && node.schema.schema === "Tick",
                ),
              ),
            })
            .pipe(callIngress, Effect.orDie);
          yield* updateActualEndpoints(request.projectId);
          return result;
        }),
      );
    });

    const previewProject = Effect.fnUntraced(function* (request: PreviewProjectRequest) {
      const existing = yield* database
        .select({ previewIds: projectIngressDesired.previewIds })
        .from(projectIngressDesired)
        .where(eq(projectIngressDesired.projectId, request.projectId))
        .limit(1)
        .pipe(Effect.orDie);
      const previewIds = [...new Set([...(existing[0]?.previewIds ?? []), request.previewId])];
      yield* database
        .insert(projectIngressDesired)
        .values({
          projectId: request.projectId,
          publicOrigin: request.publicOrigin,
          previewEngines: request.engines,
          previewIds,
          generation: 1,
        })
        .onConflictDoUpdate({
          target: projectIngressDesired.projectId,
          set: {
            publicOrigin: request.publicOrigin,
            previewEngines: request.engines,
            previewIds,
            generation: sql`${projectIngressDesired.generation} + 1`,
            status: "pending",
            error: null,
          },
        })
        .pipe(Effect.orDie);
      return yield* recordReconciliationFailure(
        request.projectId,
        Effect.gen(function* () {
          const result = yield* projectIngressDos
            .getByName(request.projectId)
            .preview(request)
            .pipe(Effect.orDie);
          yield* updateActualEndpoints(request.projectId);
          return result.endpoints;
        }),
      );
    });

    const reconcileDeployments = Effect.fn("CloudWorker.reconcileDeployments")(function* (
      publicOrigin: string,
    ) {
      yield* database.update(projectIngressDesired).set({ publicOrigin }).pipe(Effect.orDie);
      const deployedProjects = yield* database
        .select({ id: projects.id })
        .from(projects)
        .where(isNotNull(projects.currentDeploymentId))
        .pipe(Effect.orDie);
      const desiredProjects = yield* database
        .select()
        .from(projectIngressDesired)
        .pipe(Effect.orDie);
      const projectIds = new Set([
        ...deployedProjects.map((project) => project.id),
        ...desiredProjects.map((project) => project.projectId),
      ]);
      const deployedProjectIds = new Set(deployedProjects.map((project) => project.id));
      yield* Effect.forEach(
        projectIds,
        (projectId) =>
          Effect.gen(function* () {
            if (deployedProjectIds.has(projectId))
              yield* reconcileProjectDeployment({ projectId, publicOrigin });
            const desired = desiredProjects.find((project) => project.projectId === projectId);
            const previewEngines = desired?.previewEngines;
            if (desired !== undefined && previewEngines !== null && previewEngines !== undefined) {
              yield* Effect.forEach(
                desired.previewIds,
                (previewId) =>
                  previewProject({
                    projectId,
                    publicOrigin,
                    previewId,
                    engines: previewEngines,
                  }),
                { discard: true },
              );
            }
          }),
        { discard: true },
      );
      return projectIds.size;
    });

    const handleIngressImpl = Effect.fnUntraced(function* (request: HandleIngressRequest) {
      const ingressSpan = yield* Effect.currentSpan;
      const response = yield* projectIngressDos
        .getByName(request.projectId)
        .httpIngress({
          ...request,
          traceContext: {
            traceId: ingressSpan.traceId,
            spanId: ingressSpan.spanId,
            sampled: ingressSpan.sampled,
          },
        })
        .pipe(Effect.orDie);
      yield* Effect.logInfo("HttpIngress dispatch completed", {
        projectId: request.projectId,
        endpointId: request.endpointId,
        status: response.status,
        ingressEventCount: response.ingressEvents.length,
      });
      const traceId = ingressSpan.traceId;
      const receivedAt = new Date().toISOString();
      const eventTraceContext = {
        traceId,
        spanId: ingressSpan.spanId,
        sampled: ingressSpan.sampled,
        startedAt: receivedAt,
      };
      const ingressRecorded = yield* Effect.forEach(
        response.ingressEvents,
        (event) => {
          return database.insert(projectIngressEvents).values({
            id: event.id,
            projectId: request.projectId,
            endpointId: request.endpointId,
            pluginId: event.pluginId,
            eventType: event.eventType,
            eventId: event.eventId ?? null,
            eventPayload: event.payloadJson,
            traceId,
            traceContext: eventTraceContext,
            previewOnly: event.previewOnly,
            previewGeneration: event.previewGeneration ?? null,
            receivedAt,
          });
        },
        { discard: true },
      ).pipe(
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.logError("Failed to record ingress events", cause).pipe(Effect.as(false)),
        ),
      );
      yield* Effect.forEach(
        response.events,
        (event) => {
          const executionId = crypto.randomUUID();
          const projectEventId = crypto.randomUUID();
          return Effect.gen(function* () {
            const dispatchSpan = yield* Effect.currentSpan;
            return yield* executionWorkflow
              .create({
                id: executionId,
                params: {
                  executionId,
                  projectId: request.projectId,
                  projectEventId,
                  source: "ingress",
                  ...(ingressRecorded ? { ingressEventId: event.ingressEventId } : {}),
                  deploymentId: event.deploymentId,
                  r2Key: event.r2Key,
                  pluginId: event.pluginId,
                  eventType: event.eventType,
                  ...(event.eventId === undefined ? {} : { providerEventId: event.eventId }),
                  event: event.payloadJson,
                  eventTraceContext,
                  traceContext: {
                    traceId: dispatchSpan.traceId,
                    spanId: dispatchSpan.spanId,
                    sampled: dispatchSpan.sampled,
                  },
                },
              })
              .pipe(
                Effect.tap((instance) =>
                  Effect.log(
                    `Started graph execution ${instance.id} for project ${request.projectId} deployment ${event.deploymentId} event ${event.eventType}`,
                  ),
                ),
                Effect.orDie,
              );
          }).pipe(
            Effect.withSpan("CloudWorker.startExecutionWorkflow", {
              kind: "producer",
              attributes: {
                "macrograph.project.id": request.projectId,
                "macrograph.project.event.id": projectEventId,
                "macrograph.execution.id": executionId,
                "macrograph.ingress.event.id": event.ingressEventId,
                "macrograph.event.type": event.eventType,
              },
            }),
          );
        },
        { discard: true },
      );
      return {
        status: response.status,
        ...("body" in response && response.body !== undefined ? { body: response.body } : {}),
        ...("contentType" in response && response.contentType !== undefined
          ? { contentType: response.contentType }
          : {}),
      };
    });

    const handleIngress = (request: HandleIngressRequest) =>
      handleIngressImpl(request).pipe(
        Effect.withSpan("CloudWorker.handleIngress", {
          attributes: {
            "macrograph.project.id": request.projectId,
            "macrograph.ingress.endpoint.id": request.endpointId,
          },
        }),
      );

    const stopPreview = Effect.fnUntraced(function* (projectId: string, previewId: string) {
      const desired = yield* database
        .select({ previewIds: projectIngressDesired.previewIds })
        .from(projectIngressDesired)
        .where(eq(projectIngressDesired.projectId, projectId))
        .limit(1)
        .pipe(Effect.orDie);
      const previewIds = desired[0]?.previewIds.filter((id) => id !== previewId) ?? [];
      yield* database
        .update(projectIngressDesired)
        .set({
          previewIds,
          ...(previewIds.length === 0 ? { previewEngines: null } : {}),
          generation: sql`${projectIngressDesired.generation} + 1`,
          status: "pending",
          error: null,
        })
        .where(eq(projectIngressDesired.projectId, projectId))
        .pipe(Effect.orDie);
      yield* recordReconciliationFailure(
        projectId,
        Effect.gen(function* () {
          yield* projectIngressDos
            .getByName(projectId)
            .stopPreview({ previewId })
            .pipe(Effect.orDie);
          yield* updateActualEndpoints(projectId);
        }),
      );
    });

    const listIngress = Effect.fnUntraced(function* (projectId: string) {
      const rows = yield* database
        .select()
        .from(projectIngressEndpoints)
        .where(eq(projectIngressEndpoints.projectId, projectId))
        .pipe(Effect.orDie);
      return rows.map((row) => ({
        ...endpointFromRow(row),
        deployed: row.deployed,
        preview: row.preview,
      }));
    });

    const getEndpoint = Effect.fnUntraced(function* (
      projectId: string,
      handlerId: HttpEndpoint.HandlerId,
      instanceKey: string,
    ) {
      const rows = yield* database
        .select()
        .from(projectIngressEndpoints)
        .where(
          and(
            eq(projectIngressEndpoints.projectId, projectId),
            eq(projectIngressEndpoints.handlerId, handlerId),
            eq(projectIngressEndpoints.instanceKey, instanceKey),
          ),
        )
        .limit(1)
        .pipe(Effect.orDie);
      return rows[0] === undefined ? undefined : endpointFromRow(rows[0]);
    });

    const lookupEndpoint = Effect.fnUntraced(function* (
      projectId: string,
      endpointId: HttpEndpoint.Id,
    ) {
      const rows = yield* database
        .select()
        .from(projectIngressEndpoints)
        .where(
          and(
            eq(projectIngressEndpoints.projectId, projectId),
            eq(projectIngressEndpoints.endpointId, endpointId),
          ),
        )
        .limit(1)
        .pipe(Effect.orDie);
      return rows[0] === undefined ? undefined : endpointFromRow(rows[0]);
    });

    const undeployProject = Effect.fnUntraced(function* (projectId: string) {
      const desired = yield* database
        .select({ previewIds: projectIngressDesired.previewIds })
        .from(projectIngressDesired)
        .where(eq(projectIngressDesired.projectId, projectId))
        .limit(1)
        .pipe(Effect.orDie);
      yield* database
        .update(projectIngressDesired)
        .set({
          previewIds: [],
          previewEngines: null,
          generation: sql`${projectIngressDesired.generation} + 1`,
          status: "pending",
          error: null,
        })
        .where(eq(projectIngressDesired.projectId, projectId))
        .pipe(Effect.orDie);
      yield* recordReconciliationFailure(
        projectId,
        Effect.gen(function* () {
          yield* Effect.forEach(
            desired[0]?.previewIds ?? [],
            (previewId) =>
              projectIngressDos
                .getByName(projectId)
                .stopPreview({ previewId })
                .pipe(callIngress, Effect.orDie),
            { discard: true },
          );
          yield* projectIngressDos.getByName(projectId).undeploy().pipe(callIngress, Effect.orDie);
          yield* updateActualEndpoints(projectId);
        }),
      );
    });

    const queueScope = Effect.fnUntraced(function* (projectId: string, queueId: string) {
      const deployment = yield* loadDesiredDeployment(projectId).pipe(Effect.catchCause((cause) =>
        Effect.fail(new Queue.OperationError({ queueId,
          reason: `Project deployment queue runtime unavailable: ${String(Cause.squash(cause))}` })),
      ));
      return { projectId, deploymentId: deployment.deploymentId, r2Key: deployment.r2Key };
    });

    return {
      reconcileDeployments,
      reconcileProjectDeployment,
      handleIngress,
      replayEvent: (input: GraphExecutionWorkflowInput) =>
        executionWorkflow
          .create({ id: input.executionId, params: { ...input, source: "replay" } })
          .pipe(Effect.asVoid, Effect.orDie),
      previewProject,
      stopPreview,
      listIngress,
      getEndpoint,
      lookupEndpoint,
      undeployProject,
      queueSnapshot: (projectId: string) => queueScope(projectId, "").pipe(
        Effect.flatMap((scope) => projectIngressDos.getByName(projectId).queueSnapshot(scope)),
        Effect.catch(() => Effect.succeed([])),
      ),
      queuePause: (projectId: string, queueId: string, paused: boolean) => queueScope(projectId, queueId).pipe(
        Effect.flatMap((scope) => projectIngressDos.getByName(projectId).queuePause(scope, queueId, paused)),
      ),
      queueAdvance: (projectId: string, queueId: string) => queueScope(projectId, queueId).pipe(
        Effect.flatMap((scope) => projectIngressDos.getByName(projectId).queueAdvance(scope, queueId)),
      ),
      queueRemove: (projectId: string, queueId: string, itemId: string) => queueScope(projectId, queueId).pipe(
        Effect.flatMap((scope) => projectIngressDos.getByName(projectId).queueRemove(scope, queueId, itemId)),
      ),
      queueClear: (projectId: string, queueId: string) => queueScope(projectId, queueId).pipe(
        Effect.flatMap((scope) => projectIngressDos.getByName(projectId).queueClear(scope, queueId)),
      ),
    };
  });

export type Service = Effect.Success<ReturnType<typeof make>>;
