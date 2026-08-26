import {
  CurrentUser,
  DeploymentNotFound,
  ProjectNotFound,
  ProjectSnapshot,
} from "@macrograph/cloud-api";
import { Policy, RenderedProject } from "@macrograph/core";
import * as Cloudflare from "alchemy/Cloudflare";
import { and, desc, eq } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

import type { Service as WorkerOperations } from "../worker/CloudWorkerOperations.ts";

import { requestOrigin } from "../api/HttpOrigin.ts";
import * as Database from "../database/Database.ts";
import {
  projectDeployments,
  projects,
  type ProjectDeploymentRecord,
} from "../database/DatabaseSchema.ts";
import ProjectEditorDO from "../editor/ProjectEditorDO.ts";
import { deploymentObjectKey } from "./DeploymentObjectKey.ts";
import * as DeploymentPolicy from "./DeploymentPolicy.ts";

export const make = (
  workerOperations: WorkerOperations,
  deploymentsResource: Cloudflare.R2.Bucket,
) =>
  Effect.gen(function* () {
    const database = yield* Database.Service;
    const deploymentPolicy = yield* DeploymentPolicy.Service;
    const projectEditors = yield* ProjectEditorDO;
    const workerEnvironment = yield* Cloudflare.WorkerEnvironment;
    const deployments = yield* Cloudflare.R2.ReadWriteBucket(deploymentsResource);

    const loadProject = (projectId: string) =>
      Effect.gen(function* () {
        const rows = yield* database
          .select()
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1)
          .pipe(Effect.orDie);
        const project = rows[0];
        if (project === undefined) return yield* new ProjectNotFound();
        return project;
      });

    const publicOrigin = (request: HttpServerRequest.HttpServerRequest) =>
      request.headers["x-macrograph-public-origin"] ??
      (typeof workerEnvironment?.INGRESS_PUBLIC_ORIGIN === "string" &&
      workerEnvironment.INGRESS_PUBLIC_ORIGIN !== ""
        ? workerEnvironment.INGRESS_PUBLIC_ORIGIN
        : requestOrigin(request));

    return {
      publicOrigin,
      list: (projectId: string) =>
        Effect.gen(function* () {
          const rows = yield* database
            .select()
            .from(projectDeployments)
            .where(eq(projectDeployments.projectId, projectId))
            .orderBy(desc(projectDeployments.createdAt))
            .pipe(Effect.orDie);
          return { deployments: rows };
        }).pipe(Policy.withPolicy(deploymentPolicy.canView(projectId))),
      get: (projectId: string, deploymentId: string) =>
        Effect.gen(function* () {
          const rows = yield* database
            .select()
            .from(projectDeployments)
            .where(
              and(
                eq(projectDeployments.id, deploymentId),
                eq(projectDeployments.projectId, projectId),
              ),
            )
            .limit(1)
            .pipe(Effect.orDie);
          const deployment = rows[0];
          if (deployment === undefined) return yield* new DeploymentNotFound();
          const object = yield* deployments.get(deployment.r2Key).pipe(Effect.orDie);
          if (object === null) return yield* new DeploymentNotFound();
          const json = yield* object.text().pipe(Effect.orDie);
          const snapshot = yield* Effect.try({
            try: () => JSON.parse(json),
            catch: (cause) => cause,
          }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ProjectSnapshot)), Effect.orDie);
          return { deployment, snapshot };
        }).pipe(Policy.withPolicy(deploymentPolicy.canView(projectId))),
      deploy: (projectId: string, publicOrigin: string) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const project = yield* loadProject(projectId);
          const snapshot = yield* projectEditors
            .getByName(project.id)
            .snapshot(project.name)
            .pipe(Effect.orDie);
          const deploymentId = crypto.randomUUID();
          const r2Key = deploymentObjectKey(project.id, deploymentId);
          const createdAt = new Date().toISOString();
          const deployment: ProjectDeploymentRecord = {
            id: deploymentId,
            projectId: project.id,
            r2Key,
            createdBy: user.id,
            createdAt,
          };
          const encoded = yield* Schema.encodeUnknownEffect(RenderedProject.Model)(snapshot).pipe(
            Effect.orDie,
          );
          yield* deployments
            .put(r2Key, JSON.stringify(encoded), {
              httpMetadata: { contentType: "application/json" },
            })
            .pipe(Effect.orDie);
          yield* database
            .transaction((transaction) =>
              Effect.gen(function* () {
                yield* transaction.insert(projectDeployments).values(deployment);
                yield* transaction
                  .update(projects)
                  .set({
                    currentDeploymentId: deployment.id,
                    updatedAt: createdAt,
                  })
                  .where(eq(projects.id, project.id));
              }),
            )
            .pipe(Effect.orDie);

          const runtimeDeployment = yield* workerOperations
            .reconcileProjectDeployment({
              projectId: project.id,
              publicOrigin,
            })
            .pipe(
              Effect.catchCause((cause) =>
                database
                  .transaction((transaction) =>
                    Effect.gen(function* () {
                      yield* transaction
                        .update(projects)
                        .set({
                          currentDeploymentId: project.currentDeploymentId,
                          updatedAt: project.updatedAt,
                        })
                        .where(
                          and(
                            eq(projects.id, project.id),
                            eq(projects.currentDeploymentId, deployment.id),
                          ),
                        );
                      yield* transaction
                        .delete(projectDeployments)
                        .where(eq(projectDeployments.id, deployment.id));
                    }),
                  )
                  .pipe(
                    Effect.catchCause((cleanupCause) =>
                      Effect.logError(
                        "Failed to restore desired project deployment",
                        cleanupCause,
                      ).pipe(Effect.andThen(Effect.failCause(cause))),
                    ),
                    Effect.andThen(
                      deployments
                        .delete(r2Key)
                        .pipe(
                          Effect.catchCause((cleanupCause) =>
                            Effect.logError(
                              "Failed to remove rejected deployment snapshot",
                              cleanupCause,
                            ),
                          ),
                        ),
                    ),
                    Effect.andThen(Effect.failCause(cause)),
                  ),
              ),
            );
          return {
            projectId: project.id,
            deployment,
            endpoints: runtimeDeployment.endpoints,
          };
        }).pipe(Policy.withPolicy(deploymentPolicy.canEdit(projectId))),
      startPreview: (projectId: string, previewId: string, publicOrigin: string) =>
        Effect.gen(function* () {
          const project = yield* loadProject(projectId);
          const snapshot = yield* projectEditors
            .getByName(project.id)
            .snapshot(project.name)
            .pipe(Effect.orDie);
          const endpoints = yield* workerOperations.previewProject({
            projectId: project.id,
            publicOrigin,
            previewId,
            engines: snapshot.engines,
          });
          return { endpoints };
        }).pipe(Policy.withPolicy(deploymentPolicy.canEdit(projectId))),
      stopPreview: (projectId: string, previewId: string) =>
        Effect.gen(function* () {
          yield* workerOperations.stopPreview(projectId, previewId);
        }).pipe(Policy.withPolicy(deploymentPolicy.canEdit(projectId))),
    };
  });

export class Service extends Context.Service<Service, Effect.Success<ReturnType<typeof make>>>()(
  "macrograph/cloudflare/Deployment",
) {}

export const layer = (
  workerOperations: WorkerOperations,
  deploymentsResource: Cloudflare.R2.Bucket,
) => Layer.effect(Service)(make(workerOperations, deploymentsResource));
