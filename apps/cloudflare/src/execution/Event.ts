import { DeploymentNotFound, EventNotFound, ExecutionNotFound } from "@macrograph/cloud-api";
import { Policy } from "@macrograph/core";
import { HttpEndpoint } from "@macrograph/plugin";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer, Tracer } from "effect";

import type { Service as WorkerOperations } from "../worker/CloudWorkerOperations.ts";

import * as Database from "../database/Database.ts";
import {
  projectDeployments,
  projectEvents,
  projectExecutionNodes,
  projectExecutions,
  projectIngressEndpoints,
  projectIngressEvents,
  projects,
} from "../database/DatabaseSchema.ts";
import * as EventPolicy from "./EventPolicy.ts";

export const make = (workerOperations: Pick<WorkerOperations, "replayEvent">) =>
  Effect.gen(function* () {
    const database = yield* Database.Service;
    const eventPolicy = yield* EventPolicy.Service;
    const decodeEvent = (event: typeof projectEvents.$inferSelect) => ({
      ...event,
      eventPayload: JSON.parse(event.eventPayload),
    });

    return {
      replay: (projectId: string, eventId: string, kind: "event" | "ingress") =>
        Effect.gen(function* () {
          const table = kind === "event" ? projectEvents : projectIngressEvents;
          const rows = yield* database
            .select({
              pluginId: table.pluginId,
              eventType: table.eventType,
              eventPayload: table.eventPayload,
              ingressEventId:
                kind === "event" ? projectEvents.ingressEventId : projectIngressEvents.id,
              providerEventId:
                kind === "event" ? projectEvents.providerEventId : projectIngressEvents.eventId,
              traceContext: table.traceContext,
            })
            .from(table)
            .where(and(eq(table.projectId, projectId), eq(table.id, eventId)))
            .limit(1)
            .pipe(Effect.orDie);
          const event = rows[0];
          if (event === undefined) return yield* new EventNotFound();
          const deployments = yield* database
            .select({ deploymentId: projectDeployments.id, r2Key: projectDeployments.r2Key })
            .from(projects)
            .innerJoin(
              projectDeployments,
              and(
                eq(projectDeployments.id, projects.currentDeploymentId),
                eq(projectDeployments.projectId, projects.id),
              ),
            )
            .where(eq(projects.id, projectId))
            .limit(1)
            .pipe(Effect.orDie);
          const deployment = deployments[0];
          if (deployment === undefined) return yield* new DeploymentNotFound();
          // A new workflow ID reruns every step instead of resuming cached workflow results.
          const executionId = crypto.randomUUID();
          const projectEventId = crypto.randomUUID();
          yield* Effect.gen(function* () {
            const span = yield* Effect.currentSpan.pipe(Effect.orDie);
            const traceContext = {
              traceId: span.traceId,
              spanId: span.spanId,
              sampled: span.sampled,
            };
            yield* workerOperations.replayEvent({
              executionId,
              projectEventId,
              projectId,
              ...deployment,
              source: "replay",
              pluginId: event.pluginId,
              eventType: event.eventType,
              event: event.eventPayload,
              ...(event.ingressEventId === null ? {} : { ingressEventId: event.ingressEventId }),
              ...(event.providerEventId === null ? {} : { providerEventId: event.providerEventId }),
              traceContext,
              // Carry the original parent through replayed events, rather than chaining replays.
              eventTraceContext: event.traceContext ?? {
                ...traceContext,
                startedAt: new Date().toISOString(),
              },
            });
          }).pipe(
            Effect.withSpan("Event.replay", {
              kind: "producer",
              ...(event.traceContext === null
                ? { root: true }
                : { parent: Tracer.externalSpan(event.traceContext) }),
              attributes: {
                "macrograph.project.id": projectId,
                "macrograph.replay.event.id": eventId,
                "macrograph.project.event.id": projectEventId,
                "macrograph.execution.id": executionId,
                "macrograph.deployment.id": deployment.deploymentId,
              },
            }),
          );
          return { executionId, projectEventId, deploymentId: deployment.deploymentId };
        }).pipe(
          Policy.withPolicy(eventPolicy.canEdit(projectId)),
          Effect.withSpan("Event.replayRequest", {
            kind: "producer",
            attributes: {
              "macrograph.project.id": projectId,
              "macrograph.replay.event.id": eventId,
            },
          }),
        ),
      list: (projectId: string) =>
        Effect.gen(function* () {
          const ingressRows = yield* database
            .select()
            .from(projectIngressEvents)
            .where(eq(projectIngressEvents.projectId, projectId))
            .orderBy(desc(projectIngressEvents.receivedAt))
            .limit(200)
            .pipe(Effect.orDie);
          const eventRows = yield* database
            .select()
            .from(projectEvents)
            .where(eq(projectEvents.projectId, projectId))
            .orderBy(desc(projectEvents.receivedAt))
            .limit(200)
            .pipe(Effect.orDie);
          const executions =
            eventRows.length === 0
              ? []
              : yield* database
                  .select()
                  .from(projectExecutions)
                  .where(
                    and(
                      eq(projectExecutions.projectId, projectId),
                      inArray(
                        projectExecutions.projectEventId,
                        eventRows.map((event) => event.id),
                      ),
                    ),
                  )
                  .orderBy(desc(projectExecutions.receivedAt))
                  .pipe(Effect.orDie);
          const endpointRows = yield* database
            .select()
            .from(projectIngressEndpoints)
            .where(eq(projectIngressEndpoints.projectId, projectId))
            .pipe(Effect.orDie);
          const ingresses = endpointRows.map((endpoint) => ({
            id: HttpEndpoint.Id.make(endpoint.endpointId),
            url: endpoint.url,
            schema: {
              id: HttpEndpoint.HandlerId.make(endpoint.handlerId),
              displayName: endpoint.schemaDisplayName,
            },
            instanceKey: HttpEndpoint.InstanceKey.make(endpoint.instanceKey),
            ...(endpoint.displayName === null ? {} : { displayName: endpoint.displayName }),
            metadata: endpoint.metadata,
            deployed: endpoint.deployed,
            preview: endpoint.preview,
          }));
          return {
            ingresses,
            ingressEvents: ingressRows.map((event) => ({
              ...event,
              eventPayload: JSON.parse(event.eventPayload),
            })),
            events: eventRows.map(decodeEvent),
            executions,
          };
        }).pipe(Policy.withPolicy(eventPolicy.canView(projectId))),
      listExecutions: (projectId: string, deploymentId?: string) =>
        Effect.gen(function* () {
          const condition = deploymentId
            ? and(
                eq(projectExecutions.projectId, projectId),
                eq(projectExecutions.deploymentId, deploymentId),
              )
            : eq(projectExecutions.projectId, projectId);
          const executions = yield* database
            .select()
            .from(projectExecutions)
            .where(condition)
            .orderBy(desc(projectExecutions.receivedAt))
            .pipe(Effect.orDie);
          const events =
            executions.length === 0
              ? []
              : yield* database
                  .select()
                  .from(projectEvents)
                  .where(
                    and(
                      eq(projectEvents.projectId, projectId),
                      inArray(
                        projectEvents.id,
                        executions.map((execution) => execution.projectEventId),
                      ),
                    ),
                  )
                  .pipe(Effect.orDie);
          return { executions, events: events.map(decodeEvent) };
        }).pipe(Policy.withPolicy(eventPolicy.canView(projectId))),
      getExecution: (projectId: string, executionId: string) =>
        Effect.gen(function* () {
          const rows = yield* database
            .select()
            .from(projectExecutions)
            .where(
              and(
                eq(projectExecutions.id, executionId),
                eq(projectExecutions.projectId, projectId),
              ),
            )
            .limit(1)
            .pipe(Effect.orDie);
          const execution = rows[0];
          if (execution === undefined) return yield* new ExecutionNotFound();
          const events = yield* database
            .select()
            .from(projectEvents)
            .where(
              and(
                eq(projectEvents.id, execution.projectEventId),
                eq(projectEvents.projectId, projectId),
              ),
            )
            .limit(1)
            .pipe(Effect.orDie);
          const event = events[0];
          if (event === undefined) return yield* new ExecutionNotFound();
          const nodes = yield* database
            .select()
            .from(projectExecutionNodes)
            .where(eq(projectExecutionNodes.executionId, execution.id))
            .orderBy(projectExecutionNodes.startedAt)
            .pipe(Effect.orDie);
          return { execution, event: decodeEvent(event), nodes };
        }).pipe(Policy.withPolicy(eventPolicy.canView(projectId))),
    };
  });

export class Service extends Context.Service<Service, Effect.Success<ReturnType<typeof make>>>()(
  "macrograph/cloudflare/Event",
) {}

export const layer = (workerOperations: Pick<WorkerOperations, "replayEvent">) =>
  Layer.effect(Service)(make(workerOperations));
