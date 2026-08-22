import type { HttpServerRequest } from "effect/unstable/http";

import { Project } from "@macrograph/core";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import {
  projectExecutions,
  projectIngressEvents,
  projectRevisions,
  projects,
} from "../AppDatabaseSchema.ts";
import GraphExecutionWorkflow from "./GraphExecutionWorkflow.ts";
import ProjectRuntime from "./ProjectRuntime.ts";

interface DeployedRevision {
  readonly revisionId: string;
  readonly r2Key: string;
}

export interface DeployProjectRequest {
  readonly projectId: string;
  readonly revisionId?: string;
  readonly publicOrigin: string;
}

export interface HandleIngressRequest {
  readonly projectId: string;
  readonly endpointId: string;
  readonly method: string;
  readonly headers: ReadonlyArray<readonly [name: string, value: string]>;
  readonly body: Uint8Array;
}

export interface PreviewProjectRequest {
  readonly projectId: string;
  readonly publicOrigin: string;
  readonly previewId: string;
  readonly engines: Readonly<Record<string, unknown>>;
}

export const make = (
  databaseResource: Cloudflare.Hyperdrive.Connection,
  revisionsResource: Cloudflare.R2.Bucket,
) =>
  Effect.gen(function* () {
    const executionWorkflow = yield* GraphExecutionWorkflow;
    const projectRuntimes = yield* ProjectRuntime;
    const hyperdrive = yield* Cloudflare.Hyperdrive.Connect(databaseResource);
    const database = yield* Drizzle.Postgres(hyperdrive.connectionString);
    const revisions = yield* Cloudflare.R2.ReadWriteBucket(revisionsResource);

    const loadRevision = Effect.fnUntraced(function* (projectId: string, revisionId?: string) {
      const rows = yield* (
        revisionId === undefined
          ? database
              .select({
                revisionId: projectRevisions.id,
                r2Key: projectRevisions.r2Key,
              })
              .from(projects)
              .innerJoin(projectRevisions, eq(projectRevisions.id, projects.currentRevisionId))
              .where(eq(projects.id, projectId))
              .limit(1)
          : database
              .select({
                revisionId: projectRevisions.id,
                r2Key: projectRevisions.r2Key,
              })
              .from(projectRevisions)
              .where(
                and(eq(projectRevisions.projectId, projectId), eq(projectRevisions.id, revisionId)),
              )
              .limit(1)
      ).pipe(Effect.orDie);
      const revision: DeployedRevision | undefined = rows[0];
      if (revision === undefined)
        return yield* Effect.die(
          revisionId === undefined
            ? `Project ${projectId} has no deployed revision`
            : `Project ${projectId} revision ${revisionId} is not deployed`,
        );
      const object = yield* revisions.get(revision.r2Key).pipe(Effect.orDie);
      if (object === null) return yield* Effect.die(`Project revision ${revision.r2Key} not found`);
      const json = yield* object.text().pipe(Effect.orDie);
      const project = yield* Effect.try({
        try: () => JSON.parse(json),
        catch: (cause) => cause,
      }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Project.Model)), Effect.orDie);
      return { ...revision, project };
    });

    const deployProject = Effect.fnUntraced(function* (request: DeployProjectRequest) {
      const revision = yield* loadRevision(request.projectId, request.revisionId);
      return yield* projectRuntimes
        .getByName(request.projectId)
        .deploy({
          projectId: request.projectId,
          revisionId: revision.revisionId,
          r2Key: revision.r2Key,
          publicOrigin: request.publicOrigin,
          engines: revision.project.engines,
        })
        .pipe(Effect.orDie);
    });

    const handleIngress = Effect.fnUntraced(function* (request: HandleIngressRequest) {
      const response = yield* projectRuntimes
        .getByName(request.projectId)
        .httpIngress(request)
        .pipe(Effect.orDie);
      yield* Effect.logInfo("HttpIngress dispatch completed", {
        projectId: request.projectId,
        endpointId: request.endpointId,
        status: response.status,
        receivedEventCount: response.receivedEvents.length,
        previewEventCount: response.previewEvents.length,
      });
      yield* Effect.forEach(
        response.productionEvents,
        (event) => {
          const executionId = crypto.randomUUID();
          return executionWorkflow
            .create({
              id: executionId,
              params: {
                executionId,
                projectId: request.projectId,
                revisionId: event.revisionId,
                r2Key: event.r2Key,
                pluginId: event.pluginId,
                eventType: event.eventType,
                ...(event.eventId === undefined ? {} : { eventId: event.eventId }),
                event: event.payloadJson,
              },
            })
            .pipe(
              Effect.tap((instance) =>
                Effect.log(
                  `Started graph execution ${instance.id} for project ${request.projectId} revision ${event.revisionId} event ${event.eventType}`,
                ),
              ),
              Effect.orDie,
            );
        },
        { discard: true },
      );
      yield* Effect.forEach(
        response.receivedEvents,
        (event) =>
          database.insert(projectIngressEvents).values({
            id: crypto.randomUUID(),
            projectId: request.projectId,
            endpointId: request.endpointId,
            pluginId: event.pluginId,
            eventType: event.eventType,
            eventId: event.eventId ?? null,
            eventPayload: event.payloadJson,
            receivedAt: new Date().toISOString(),
          }),
        { discard: true },
      ).pipe(
        Effect.catchCause((cause) => Effect.logError("Failed to record ingress events", cause)),
      );
      return {
        status: response.status,
        ...("body" in response && response.body !== undefined ? { body: response.body } : {}),
        ...("contentType" in response && response.contentType !== undefined
          ? { contentType: response.contentType }
          : {}),
        previewEvents: response.previewEvents,
      };
    });

    const previewProject = Effect.fnUntraced(function* (request: PreviewProjectRequest) {
      const result = yield* projectRuntimes
        .getByName(request.projectId)
        .preview(request)
        .pipe(Effect.orDie);
      return result.endpoints;
    });

    const stopPreview = (projectId: string, previewId: string) =>
      projectRuntimes.getByName(projectId).stopPreview({ previewId }).pipe(Effect.orDie);

    const workflowStatus = Effect.fnUntraced(function* (instanceId: string) {
      const instance = yield* executionWorkflow.get(instanceId);
      const status = yield* instance.status();
      if (status.status === "errored") {
        yield* database
          .update(projectExecutions)
          .set({
            status: "errored",
            completedAt: new Date().toISOString(),
            error: status.error?.message ?? "Workflow errored",
          })
          .where(eq(projectExecutions.id, instanceId))
          .pipe(Effect.orDie);
      } else if (status.status === "complete") {
        yield* database
          .update(projectExecutions)
          .set({ status: "complete", completedAt: new Date().toISOString() })
          .where(eq(projectExecutions.id, instanceId))
          .pipe(Effect.orDie);
      }
      return status;
    });

    return {
      deployProject,
      handleIngress,
      previewProject,
      stopPreview,
      workflowStatus,
      fetchProject: (projectId: string, request: HttpServerRequest.HttpServerRequest) =>
        projectRuntimes.getByName(projectId).fetch(request).pipe(Effect.orDie),
      undeployProject: (projectId: string) =>
        projectRuntimes.getByName(projectId).undeploy().pipe(Effect.orDie),
    };
  });

export type Service = Effect.Success<ReturnType<typeof make>>;
