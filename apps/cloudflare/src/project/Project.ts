import {
  CreateGraphRequest,
  CreateProjectRequest,
  CurrentUser,
  ProjectNotFound,
} from "@macrograph/cloud-api";
import { Connection, Node, Policy, ResourceConstant } from "@macrograph/core";
import * as Cloudflare from "alchemy/Cloudflare";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";

import type { Service as WorkerOperations } from "../worker/CloudWorkerOperations.ts";

import * as Database from "../database/Database.ts";
import {
  projectDeployments,
  projectMembers,
  projects,
  teamMemberships,
  teams,
  type ProjectAccess,
  type ProjectRecord,
} from "../database/DatabaseSchema.ts";
import ProjectEditorDO from "../editor/ProjectEditorDO.ts";
import * as Team from "../team/Team.ts";
import * as TeamPolicy from "../team/TeamPolicy.ts";
import * as ProjectPolicy from "./ProjectPolicy.ts";

export const make = (
  workerOperations: WorkerOperations,
  deploymentsResource: Cloudflare.R2.Bucket,
) =>
  Effect.gen(function* () {
    const database = yield* Database.Service;
    const projectPolicy = yield* ProjectPolicy.Service;
    const teamPolicy = yield* TeamPolicy.Service;
    const team = yield* Team.Service;
    const projectEditors = yield* ProjectEditorDO;
    const deployments = yield* Cloudflare.R2.ReadWriteBucket(deploymentsResource);

    const load = (projectId: string) =>
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

    return {
      list: () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          return yield* database
            .select()
            .from(projects)
            .innerJoin(
              teamMemberships,
              and(eq(teamMemberships.teamId, projects.teamId), eq(teamMemberships.userId, user.id)),
            )
            .leftJoin(
              projectMembers,
              and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, user.id)),
            )
            .where(
              or(
                eq(projects.access, "team"),
                eq(teamMemberships.role, "owner"),
                eq(projectMembers.userId, user.id),
              ),
            )
            .orderBy(desc(projects.updatedAt))
            .pipe(
              Effect.map((rows) => ({
                projects: rows.map((row) => row.projects),
              })),
              Effect.orDie,
            );
        }),
      create: (payload: typeof CreateProjectRequest.Type) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const now = new Date().toISOString();
          const access = payload.access ?? "team";
          const requestedUserIds =
            access === "restricted" ? [user.id, ...(payload.userIds ?? [])] : [];
          const explicitUserIds =
            payload.teamId !== undefined && access === "restricted"
              ? yield* team.validateMembers(payload.teamId, requestedUserIds)
              : [];
          const result = yield* database
            .transaction((transaction) =>
              Effect.gen(function* () {
                let teamId = payload.teamId;
                let userIds = explicitUserIds;
                if (teamId === undefined) {
                  yield* transaction
                    .insert(teams)
                    .values({
                      id: crypto.randomUUID(),
                      name: "Personal",
                      kind: "personal",
                      personalOwnerUserId: user.id,
                      createdAt: now,
                      updatedAt: now,
                    })
                    .onConflictDoNothing({ target: teams.personalOwnerUserId });
                  const personalTeams = yield* transaction
                    .select({ id: teams.id })
                    .from(teams)
                    .where(eq(teams.personalOwnerUserId, user.id))
                    .limit(1);
                  teamId = personalTeams[0]?.id;
                  if (teamId === undefined)
                    return yield* Effect.die("Personal team was not created");
                  yield* transaction
                    .insert(teamMemberships)
                    .values({
                      teamId,
                      userId: user.id,
                      role: "owner",
                      createdAt: now,
                    })
                    .onConflictDoNothing({
                      target: [teamMemberships.teamId, teamMemberships.userId],
                    });
                  if (access === "restricted") {
                    userIds = [...new Set(requestedUserIds)];
                    const members = yield* transaction
                      .select({ userId: teamMemberships.userId })
                      .from(teamMemberships)
                      .where(
                        and(
                          eq(teamMemberships.teamId, teamId),
                          inArray(teamMemberships.userId, userIds),
                        ),
                      );
                    if (members.length !== userIds.length)
                      return yield* new HttpApiError.BadRequest();
                  }
                }
                const project: ProjectRecord = {
                  id: crypto.randomUUID(),
                  teamId,
                  createdBy: user.id,
                  access,
                  name: payload.name,
                  currentDeploymentId: null,
                  createdAt: now,
                  updatedAt: now,
                };
                yield* transaction.insert(projects).values(project);
                if (userIds.length > 0)
                  yield* transaction.insert(projectMembers).values(
                    userIds.map((userId) => ({
                      projectId: project.id,
                      userId,
                      createdAt: now,
                    })),
                  );
                return { project };
              }),
            )
            .pipe(
              Effect.catchTag("BadRequest", (error) => Effect.succeed({ error })),
              Effect.orDie,
            );
          if ("error" in result) return yield* result.error;
          return result;
        }).pipe(
          Policy.withPolicy(
            payload.teamId === undefined ? Effect.void : teamPolicy.canEdit(payload.teamId),
          ),
        ),
      get: ({ projectId }: { readonly projectId: string }) =>
        Effect.gen(function* () {
          const project = yield* load(projectId);
          return { project };
        }).pipe(Policy.withPolicy(projectPolicy.canView(projectId))),
      listGraphs: ({ projectId }: { readonly projectId: string }) =>
        Effect.gen(function* () {
          const project = yield* load(projectId);
          const graphs = yield* projectEditors
            .getByName(project.id)
            .listGraphs()
            .pipe(Effect.orDie);
          return { graphs };
        }).pipe(Policy.withPolicy(projectPolicy.canView(projectId))),
      createGraph: ({
        projectId,
        ...payload
      }: CreateGraphRequest & { readonly projectId: string }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const project = yield* load(projectId);
          const graph = yield* projectEditors
            .getByName(project.id)
            .createGraph(payload, user.id)
            .pipe(
              Effect.catchTags({
                FunctionError: () => new HttpApiError.BadRequest(),
                SchemaNotFoundError: () => new HttpApiError.BadRequest(),
                InvalidPropertyError: () => new HttpApiError.BadRequest(),
                InvalidInputDefaultError: () => new HttpApiError.BadRequest(),
                InvalidConnectionError: () => new HttpApiError.BadRequest(),
                NodeNotFoundError: () => new HttpApiError.BadRequest(),
                GraphNotFoundError: () => Effect.die("New editor graph was not found"),
                ProjectNotFoundError: () => Effect.die("Editor project was not found"),
                PersistenceError: (error) => Effect.die(error),
              }),
            );
          return { graph };
        }).pipe(Policy.withPolicy(projectPolicy.canEdit(projectId))),
      getGraph: ({
        projectId,
        graphId,
      }: {
        readonly projectId: string;
        readonly graphId: string;
      }) =>
        Effect.gen(function* () {
          const project = yield* load(projectId);
          return yield* projectEditors
            .getByName(project.id)
            .getGraph(graphId)
            .pipe(
              Effect.catchTag("GraphNotFoundError", () => new HttpApiError.NotFound()),
              Effect.catchTags({
                ProjectNotFoundError: () => Effect.die("Editor project was not found"),
                PersistenceError: (error) => Effect.die(error),
              }),
            );
        }).pipe(Policy.withPolicy(projectPolicy.canView(projectId))),
      deleteGraph: ({
        projectId,
        graphId,
        force = false,
      }: {
        readonly projectId: string;
        readonly graphId: string;
        readonly force?: boolean;
      }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const project = yield* load(projectId);
          yield* projectEditors
            .getByName(project.id)
            .deleteGraph(graphId, project.id, user.id, force)
            .pipe(
              Effect.catchTags({
                ProjectNotFoundError: () => new HttpApiError.NotFound(),
                GraphNotFoundError: () => new HttpApiError.NotFound(),
                PersistenceError: (error) => Effect.die(error),
              }),
            );
          return { deleted: true };
        }).pipe(Policy.withPolicy(projectPolicy.canEdit(projectId))),
      searchSchemas: ({
        projectId,
        query,
        queries,
        limit,
      }: {
        readonly projectId: string;
        readonly query?: string;
        readonly queries?: ReadonlyArray<string>;
        readonly limit?: number;
      }) =>
        Effect.gen(function* () {
          const project = yield* load(projectId);
          const editor = projectEditors.getByName(project.id);
          const packages = yield* editor.getPackages();
          const resources = yield* editor.listResources().pipe(Effect.orDie);
          const searches = [...(query === undefined ? [] : [query]), ...(queries ?? [])]
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean);
          const schemas = packages.flatMap((pkg) =>
            pkg.schemas
              .map((schema) => {
                const fields = [
                  schema.id,
                  schema.name,
                  pkg.id,
                  pkg.name,
                  schema.description ?? "",
                ].map((value) => value.toLowerCase());
                const text = fields.join(" ");
                const scores = searches
                  .filter((search) => search.split(/\s+/).every((term) => text.includes(term)))
                  .map((search) => {
                    const exact = fields.findIndex((field) => field === search);
                    if (exact !== -1) return exact;
                    const prefix = fields.findIndex((field) => field.startsWith(search));
                    if (prefix !== -1) return fields.length + prefix;
                    const substring = fields.findIndex((field) => field.includes(search));
                    if (substring !== -1) return fields.length * 2 + substring;
                    return fields.length * 3;
                  });
                if (searches.length > 0 && scores.length === 0) return undefined;

                const matchingResources: Record<
                  string,
                  { id: ResourceConstant.Id; name: string }[]
                > = {};
                for (const property of schema.properties) {
                  if (!("resource" in property)) continue;
                  matchingResources[property.id] = resources
                    .filter(
                      (resource) =>
                        resource.resource.package === pkg.id &&
                        resource.resource.resource === property.resource,
                    )
                    .map(({ id, name }) => ({ id, name }));
                }

                return {
                  package: pkg.id,
                  schema,
                  resources: matchingResources,
                  score: scores.length === 0 ? 0 : Math.min(...scores),
                };
              })
              .filter((schema) => schema !== undefined),
          );
          schemas.sort(
            (left, right) =>
              left.score - right.score ||
              left.package.localeCompare(right.package) ||
              left.schema.id.localeCompare(right.schema.id),
          );
          return {
            schemas: schemas.slice(0, limit ?? 20).map(({ score: _, ...schema }) => schema),
          };
        }).pipe(Policy.withPolicy(projectPolicy.canView(projectId))),
      listResources: ({ projectId }: { readonly projectId: string }) =>
        Effect.gen(function* () {
          const project = yield* load(projectId);
          const resources = yield* projectEditors
            .getByName(project.id)
            .listResources()
            .pipe(Effect.orDie);
          return { resources };
        }).pipe(Policy.withPolicy(projectPolicy.canView(projectId))),
      createNode: ({
        projectId,
        graphId,
        ...payload
      }: Node.CreateInput & {
        readonly projectId: string;
        readonly graphId: string;
      }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const project = yield* load(projectId);
          const event = yield* projectEditors
            .getByName(project.id)
            .createNode(graphId, payload, user.id)
            .pipe(
              Effect.catchTags({
                FunctionError: () => new HttpApiError.BadRequest(),
                GraphNotFoundError: () => new HttpApiError.NotFound(),
                SchemaNotFoundError: () => new HttpApiError.BadRequest(),
                InvalidPropertyError: () => new HttpApiError.BadRequest(),
                InvalidInputDefaultError: () => new HttpApiError.BadRequest(),
                ProjectNotFoundError: () => Effect.die("Editor project was not found"),
                PersistenceError: (error) => Effect.die(error),
              }),
            );
          return { node: event.node, io: event.io };
        }).pipe(Policy.withPolicy(projectPolicy.canEdit(projectId))),
      createConnection: ({
        projectId,
        graphId,
        ...payload
      }: Connection.CreateInput & {
        readonly projectId: string;
        readonly graphId: string;
      }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const project = yield* load(projectId);
          const event = yield* projectEditors
            .getByName(project.id)
            .createConnection(graphId, payload, user.id)
            .pipe(
              Effect.catchTags({
                GraphNotFoundError: () => new HttpApiError.NotFound(),
                NodeNotFoundError: () => new HttpApiError.NotFound(),
                SchemaNotFoundError: () => new HttpApiError.BadRequest(),
                InvalidConnectionError: () => new HttpApiError.BadRequest(),
                ProjectNotFoundError: () => Effect.die("Editor project was not found"),
                PersistenceError: (error) => Effect.die(error),
              }),
            );
          return { connection: event.connection };
        }).pipe(Policy.withPolicy(projectPolicy.canEdit(projectId))),
      remove: (projectId: string) =>
        Effect.gen(function* () {
          const project = yield* load(projectId);
          const snapshots = yield* database
            .select({ r2Key: projectDeployments.r2Key })
            .from(projectDeployments)
            .where(eq(projectDeployments.projectId, project.id))
            .pipe(Effect.orDie);
          yield* workerOperations.undeployProject(project.id);
          yield* database.delete(projects).where(eq(projects.id, project.id)).pipe(Effect.orDie);
          yield* Effect.forEach(
            snapshots,
            (snapshot) =>
              deployments
                .delete(snapshot.r2Key)
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logError("Failed to remove project deployment snapshot", cause),
                  ),
                ),
            { discard: true },
          );
        }).pipe(Policy.withPolicy(projectPolicy.canManage(projectId))),
      getAccess: (projectId: string) =>
        Effect.gen(function* () {
          const project = yield* load(projectId);
          const rows = yield* database
            .select({ userId: projectMembers.userId })
            .from(projectMembers)
            .where(eq(projectMembers.projectId, project.id))
            .pipe(Effect.orDie);
          return {
            access: project.access,
            userIds: rows.map((row) => row.userId),
          };
        }).pipe(Policy.withPolicy(projectPolicy.canView(projectId))),
      setAccess: (
        projectId: string,
        access: ProjectAccess,
        requestedUserIds: ReadonlyArray<string>,
      ) =>
        Effect.gen(function* () {
          const project = yield* load(projectId);
          const userIds =
            access === "restricted"
              ? yield* team.validateMembers(project.teamId, requestedUserIds)
              : [];
          yield* database
            .transaction((transaction) =>
              Effect.gen(function* () {
                yield* transaction
                  .update(projects)
                  .set({ access })
                  .where(eq(projects.id, project.id));
                yield* transaction
                  .delete(projectMembers)
                  .where(eq(projectMembers.projectId, project.id));
                if (userIds.length > 0)
                  yield* transaction.insert(projectMembers).values(
                    userIds.map((userId) => ({
                      projectId: project.id,
                      userId,
                      createdAt: new Date().toISOString(),
                    })),
                  );
              }),
            )
            .pipe(Effect.orDie);
          yield* projectEditors.getByName(project.id).disconnectAll();
          return { project: { ...project, access }, userIds };
        }).pipe(Policy.withPolicy(projectPolicy.canManage(projectId))),
    };
  });

export class Service extends Context.Service<Service, Effect.Success<ReturnType<typeof make>>>()(
  "macrograph/cloudflare/Project",
) {}

export const layer = (
  workerOperations: WorkerOperations,
  deploymentsResource: Cloudflare.R2.Bucket,
) => Layer.effect(Service)(make(workerOperations, deploymentsResource));
