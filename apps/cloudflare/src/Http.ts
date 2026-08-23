import {
  Authentication,
  CurrentUser,
  ExecutionNotFound,
  ProjectNotFound,
  RevisionNotFound,
  TeamNotFound,
} from "@macrograph/cloud-api";
import { Project } from "@macrograph/core";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { Effect, Layer, Redacted, Schema } from "effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";

import type { Service as RuntimeService } from "./runtime/Runtime.ts";

import { Api } from "./Api.ts";
import {
  type ProjectRecord,
  type ProjectRevisionRecord,
  projectMembers,
  projectExecutionNodes,
  projectExecutions,
  projectIngressEvents,
  projectRevisions,
  projects,
  teamMemberships,
  teams,
  users,
} from "./AppDatabaseSchema.ts";
import { AppDatabaseHyperdrive, RevisionSnapshots, revisionObjectKey } from "./AppStorage.ts";
import CloudAuth from "./editor/CloudAuth.ts";
import ProjectEditor from "./editor/ProjectEditor.ts";
import { requestOrigin } from "./HttpOrigin.ts";
import {
  canAccessProject,
  canAdministerTeam,
  canRemoveMember,
  canSetMemberRole,
} from "./TeamAccess.ts";

const sessionIdFromAuthorization = (authorization: string) =>
  authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : authorization;

const runtimeOrigin = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers["x-macrograph-public-origin"] ?? `${requestOrigin(request)}/runtime`;

export const make = (
  runtime: RuntimeService,
  databaseResource: Effect.Success<typeof AppDatabaseHyperdrive>,
  revisionsResource: Effect.Success<typeof RevisionSnapshots>,
) =>
  Effect.gen(function* () {
    const projectEditors = yield* ProjectEditor;
    const cloudAuths = yield* CloudAuth;
    const hyperdrive = yield* Cloudflare.Hyperdrive.Connect(databaseResource);
    const database = yield* Drizzle.Postgres(hyperdrive.connectionString);
    const revisions = yield* Cloudflare.R2.ReadWriteBucket(revisionsResource);
    const cloudAuth = (authorization: string) =>
      cloudAuths.getByName(sessionIdFromAuthorization(authorization));

    const provisionedUsers = new Map<string, string>();

    const ensureUser = Effect.fnUntraced(function* (userId: string) {
      const provisionedTeamId = provisionedUsers.get(userId);
      if (provisionedTeamId !== undefined) return provisionedTeamId;
      const now = new Date().toISOString();
      const candidateTeamId = crypto.randomUUID();
      const teamId = yield* database
        .transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction
              .insert(users)
              .values({ id: userId, createdAt: now })
              .onConflictDoNothing();
            yield* transaction
              .insert(teams)
              .values({
                id: candidateTeamId,
                name: "Personal",
                kind: "personal",
                personalOwnerUserId: userId,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing({ target: teams.personalOwnerUserId });
            const personalTeams = yield* transaction
              .select({ id: teams.id })
              .from(teams)
              .where(eq(teams.personalOwnerUserId, userId))
              .limit(1);
            const teamId = personalTeams[0]?.id;
            if (teamId === undefined) return yield* Effect.die("Personal team was not created");
            yield* transaction
              .insert(teamMemberships)
              .values({ teamId, userId, role: "owner", createdAt: now })
              .onConflictDoNothing();
            return teamId;
          }),
        )
        .pipe(Effect.orDie);
      provisionedUsers.set(userId, teamId);
      return teamId;
    });

    const getMembership = Effect.fnUntraced(function* (teamId: string, userId: string) {
      const rows = yield* database
        .select()
        .from(teamMemberships)
        .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)))
        .limit(1)
        .pipe(Effect.orDie);
      return rows[0];
    });

    const requireMembership = Effect.fnUntraced(function* (teamId: string, userId: string) {
      const membership = yield* getMembership(teamId, userId);
      if (membership === undefined) return yield* new TeamNotFound();
      return membership;
    });

    const requireTeamAdmin = Effect.fnUntraced(function* (teamId: string, userId: string) {
      const membership = yield* requireMembership(teamId, userId);
      if (!canAdministerTeam(membership.role)) return yield* new HttpApiError.Forbidden();
      return membership;
    });

    const validateProjectMembers = Effect.fnUntraced(function* (
      teamId: string,
      userIds: ReadonlyArray<string>,
    ) {
      const uniqueUserIds = [...new Set(userIds)];
      if (uniqueUserIds.length === 0) return uniqueUserIds;
      const rows = yield* database
        .select({ userId: teamMemberships.userId })
        .from(teamMemberships)
        .where(
          and(eq(teamMemberships.teamId, teamId), inArray(teamMemberships.userId, uniqueUserIds)),
        )
        .pipe(Effect.orDie);
      if (rows.length !== uniqueUserIds.length) return yield* new HttpApiError.BadRequest();
      return uniqueUserIds;
    });

    const getAccessibleProject = Effect.fnUntraced(function* (projectId: string, userId: string) {
      const rows = yield* database
        .select({ project: projects, role: teamMemberships.role })
        .from(projects)
        .innerJoin(
          teamMemberships,
          and(eq(teamMemberships.teamId, projects.teamId), eq(teamMemberships.userId, userId)),
        )
        .where(eq(projects.id, projectId))
        .limit(1)
        .pipe(Effect.orDie);
      const row = rows[0];
      if (row === undefined) return undefined;
      if (canAccessProject(row.role, row.project.access, false)) return row.project;
      const grants = yield* database
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
        .limit(1)
        .pipe(Effect.orDie);
      return canAccessProject(row.role, row.project.access, grants[0] !== undefined)
        ? row.project
        : undefined;
    });

    const decodeExecution = (execution: typeof projectExecutions.$inferSelect) => ({
      ...execution,
      eventPayload: execution.eventPayload === null ? null : JSON.parse(execution.eventPayload),
    });

    const handleRpc = ({ request }: { readonly request: HttpServerRequest.HttpServerRequest }) =>
      Effect.gen(function* () {
        const url = new URL(request.url, "http://main.local");
        const sessionId = url.searchParams.get("sessionId");
        const projectId = url.searchParams.get("projectId");
        if (sessionId === null) return HttpServerResponse.empty({ status: 401 });
        const userId = yield* cloudAuths.getByName(sessionId).userId();
        if (userId === undefined) return HttpServerResponse.empty({ status: 401 });
        yield* ensureUser(userId);
        if (projectId === null) return HttpServerResponse.empty({ status: 400 });
        const project = yield* getAccessibleProject(projectId, userId);
        if (project === undefined) return HttpServerResponse.empty({ status: 404 });
        const editor = projectEditors.getByName(project.id);
        return yield* editor
          .fetch(
            request.modify({
              headers: Headers.set(
                Headers.set(
                  Headers.set(
                    Headers.set(request.headers, "x-macrograph-project-name", project.name),
                    "x-macrograph-user-id",
                    userId,
                  ),
                  "x-macrograph-session-id",
                  sessionId,
                ),
                "x-macrograph-public-origin",
                url.searchParams.get("publicOrigin") ?? runtimeOrigin(request),
              ),
            }),
          )
          .pipe(Effect.orDie);
      });

    const deployRevision = Effect.fnUntraced(function* ({
      params,
      request,
    }: {
      readonly params: { readonly projectId: string };
      readonly request: HttpServerRequest.HttpServerRequest;
    }) {
      const user = yield* CurrentUser;
      const project = yield* getAccessibleProject(params.projectId, user.id);
      if (project === undefined) return yield* new ProjectNotFound();

      const editor = projectEditors.getByName(project.id);
      const snapshot = yield* editor.snapshot(project.name).pipe(Effect.orDie);

      const revisionId = crypto.randomUUID();
      const r2Key = revisionObjectKey(project.id, revisionId);
      const createdAt = new Date().toISOString();
      const revision: ProjectRevisionRecord = {
        id: revisionId,
        projectId: project.id,
        r2Key,
        createdBy: user.id,
        createdAt,
      };
      const encoded = yield* Schema.encodeUnknownEffect(Project.Model)(snapshot).pipe(Effect.orDie);
      yield* revisions
        .put(r2Key, JSON.stringify(encoded), {
          httpMetadata: { contentType: "application/json" },
        })
        .pipe(Effect.orDie);

      yield* database.insert(projectRevisions).values(revision).pipe(Effect.orDie);

      const deployment = yield* runtime
        .deployProject({
          projectId: project.id,
          revisionId: revision.id,
          publicOrigin: runtimeOrigin(request),
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.all(
              [
                database
                  .delete(projectRevisions)
                  .where(eq(projectRevisions.id, revision.id))
                  .pipe(
                    Effect.catchCause((cleanupCause) =>
                      Effect.logError("Failed to remove rejected revision record", cleanupCause),
                    ),
                  ),
                revisions
                  .delete(r2Key)
                  .pipe(
                    Effect.catchCause((cleanupCause) =>
                      Effect.logError("Failed to remove rejected revision snapshot", cleanupCause),
                    ),
                  ),
              ],
              { discard: true },
            ).pipe(Effect.andThen(Effect.failCause(cause))),
          ),
        );

      yield* database
        .update(projects)
        .set({ currentRevisionId: revision.id, updatedAt: createdAt })
        .where(eq(projects.id, project.id))
        .pipe(Effect.orDie);
      return { projectId: project.id, revision, endpoints: deployment.endpoints };
    });

    const startPreview = Effect.fnUntraced(function* ({
      params,
      payload,
      request,
    }: {
      readonly params: { readonly projectId: string };
      readonly payload: { readonly previewId: string };
      readonly request: HttpServerRequest.HttpServerRequest;
    }) {
      const user = yield* CurrentUser;
      const project = yield* getAccessibleProject(params.projectId, user.id);
      if (project === undefined) return yield* new ProjectNotFound();
      const snapshot = yield* projectEditors
        .getByName(project.id)
        .snapshot(project.name)
        .pipe(Effect.orDie);
      const endpoints = yield* runtime.previewProject({
        projectId: project.id,
        publicOrigin: runtimeOrigin(request),
        previewId: payload.previewId,
        engines: snapshot.engines,
      });
      return { endpoints };
    });

    const stopPreview = Effect.fnUntraced(function* ({
      params,
      payload,
    }: {
      readonly params: { readonly projectId: string };
      readonly payload: { readonly previewId: string };
    }) {
      const user = yield* CurrentUser;
      const project = yield* getAccessibleProject(params.projectId, user.id);
      if (project === undefined) return yield* new ProjectNotFound();
      yield* runtime.stopPreview(project.id, payload.previewId);
    });

    const sessionHandlers = HttpApiBuilder.group(Api, "session", (handlers) =>
      handlers
        .handle("get", ({ headers }) => cloudAuth(headers.authorization).status())
        .handle("start", ({ headers }) => cloudAuth(headers.authorization).start())
        .handle("poll", ({ headers }) => cloudAuth(headers.authorization).poll())
        .handle("disconnect", ({ headers }) => cloudAuth(headers.authorization).disconnect()),
    );

    const teamsHandlers = HttpApiBuilder.group(Api, "teams", (handlers) =>
      handlers
        .handle("list", () =>
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            const rows = yield* database
              .select({
                id: teams.id,
                name: teams.name,
                kind: teams.kind,
                personalOwnerUserId: teams.personalOwnerUserId,
                role: teamMemberships.role,
                createdAt: teams.createdAt,
                updatedAt: teams.updatedAt,
              })
              .from(teamMemberships)
              .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
              .where(eq(teamMemberships.userId, user.id))
              .orderBy(teams.name)
              .pipe(Effect.orDie);
            return { teams: rows };
          }),
        )
        .handle(
          "create",
          Effect.fnUntraced(function* ({ payload }) {
            const user = yield* CurrentUser;
            const now = new Date().toISOString();
            const team = {
              id: crypto.randomUUID(),
              name: payload.name,
              kind: "shared" as const,
              personalOwnerUserId: null,
              createdAt: now,
              updatedAt: now,
            };
            yield* database
              .transaction((transaction) =>
                Effect.gen(function* () {
                  yield* transaction.insert(teams).values(team);
                  yield* transaction.insert(teamMemberships).values({
                    teamId: team.id,
                    userId: user.id,
                    role: "owner",
                    createdAt: now,
                  });
                }),
              )
              .pipe(Effect.orDie);
            return { team: { ...team, role: "owner" as const } };
          }),
        )
        .handle(
          "listMembers",
          Effect.fnUntraced(function* ({ params }) {
            const user = yield* CurrentUser;
            yield* requireMembership(params.teamId, user.id);
            const members = yield* database
              .select({
                userId: teamMemberships.userId,
                role: teamMemberships.role,
                createdAt: teamMemberships.createdAt,
              })
              .from(teamMemberships)
              .where(eq(teamMemberships.teamId, params.teamId))
              .orderBy(teamMemberships.createdAt)
              .pipe(Effect.orDie);
            return { members };
          }),
        )
        .handle(
          "setMember",
          Effect.fnUntraced(function* ({ params, payload }) {
            const user = yield* CurrentUser;
            const actor = yield* requireTeamAdmin(params.teamId, user.id);
            const target = yield* getMembership(params.teamId, params.userId);
            if (!canSetMemberRole(actor.role, target?.role, payload.role))
              return yield* new HttpApiError.Forbidden();

            yield* ensureUser(params.userId);
            const createdAt = target?.createdAt ?? new Date().toISOString();
            yield* database
              .insert(teamMemberships)
              .values({
                teamId: params.teamId,
                userId: params.userId,
                role: payload.role,
                createdAt,
              })
              .onConflictDoUpdate({
                target: [teamMemberships.teamId, teamMemberships.userId],
                set: { role: payload.role },
              })
              .pipe(Effect.orDie);
            return { member: { userId: params.userId, role: payload.role, createdAt } };
          }),
        )
        .handle(
          "removeMember",
          Effect.fnUntraced(function* ({ params }) {
            const user = yield* CurrentUser;
            const actor = yield* requireTeamAdmin(params.teamId, user.id);
            const target = yield* getMembership(params.teamId, params.userId);
            if (!canRemoveMember(actor.role, target?.role))
              return yield* new HttpApiError.Forbidden();
            const teamProjects = yield* database
              .select({ id: projects.id })
              .from(projects)
              .where(eq(projects.teamId, params.teamId))
              .pipe(Effect.orDie);
            yield* database
              .transaction((transaction) =>
                Effect.gen(function* () {
                  if (teamProjects.length > 0)
                    yield* transaction.delete(projectMembers).where(
                      and(
                        eq(projectMembers.userId, params.userId),
                        inArray(
                          projectMembers.projectId,
                          teamProjects.map((project) => project.id),
                        ),
                      ),
                    );
                  yield* transaction
                    .delete(teamMemberships)
                    .where(
                      and(
                        eq(teamMemberships.teamId, params.teamId),
                        eq(teamMemberships.userId, params.userId),
                      ),
                    );
                }),
              )
              .pipe(Effect.orDie);
          }),
        ),
    );

    const projectsHandlers = HttpApiBuilder.group(Api, "projects", (handlers) =>
      handlers
        .handle("list", () =>
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            return yield* database
              .select()
              .from(projects)
              .innerJoin(
                teamMemberships,
                and(
                  eq(teamMemberships.teamId, projects.teamId),
                  eq(teamMemberships.userId, user.id),
                ),
              )
              .leftJoin(
                projectMembers,
                and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, user.id)),
              )
              .where(
                or(
                  eq(projects.access, "team"),
                  inArray(teamMemberships.role, ["owner", "admin"]),
                  eq(projectMembers.userId, user.id),
                ),
              )
              .orderBy(desc(projects.updatedAt))
              .pipe(
                Effect.map((rows) => ({ projects: rows.map((row) => row.projects) })),
                Effect.orDie,
              );
          }),
        )
        .handle(
          "create",
          Effect.fnUntraced(function* ({ payload }) {
            const user = yield* CurrentUser;
            const now = new Date().toISOString();
            const teamId = payload.teamId ?? (yield* ensureUser(user.id));
            yield* requireMembership(teamId, user.id);
            const access = payload.access ?? "team";
            const userIds =
              access === "restricted"
                ? yield* validateProjectMembers(teamId, [user.id, ...(payload.userIds ?? [])])
                : [];
            const project: ProjectRecord = {
              id: crypto.randomUUID(),
              teamId,
              createdBy: user.id,
              access,
              name: payload.name,
              currentRevisionId: null,
              createdAt: now,
              updatedAt: now,
            };
            yield* database
              .transaction((transaction) =>
                Effect.gen(function* () {
                  yield* transaction.insert(projects).values(project);
                  if (userIds.length > 0)
                    yield* transaction.insert(projectMembers).values(
                      userIds.map((userId) => ({
                        projectId: project.id,
                        userId,
                        createdAt: now,
                      })),
                    );
                }),
              )
              .pipe(Effect.orDie);
            return { project };
          }),
        )
        .handle(
          "get",
          Effect.fnUntraced(function* ({ params }) {
            const user = yield* CurrentUser;
            const project = yield* getAccessibleProject(params.projectId, user.id);
            if (project === undefined) return yield* new ProjectNotFound();
            return { project };
          }),
        )
        .handle(
          "remove",
          Effect.fnUntraced(function* ({ params }) {
            const user = yield* CurrentUser;
            const rows = yield* database
              .select({ project: projects, role: teamMemberships.role })
              .from(projects)
              .innerJoin(
                teamMemberships,
                and(
                  eq(teamMemberships.teamId, projects.teamId),
                  eq(teamMemberships.userId, user.id),
                ),
              )
              .where(eq(projects.id, params.projectId))
              .limit(1)
              .pipe(Effect.orDie);
            const row = rows[0];
            if (row === undefined) return yield* new ProjectNotFound();
            if (!canAdministerTeam(row.role)) return yield* new HttpApiError.Forbidden();
            const snapshots = yield* database
              .select({ r2Key: projectRevisions.r2Key })
              .from(projectRevisions)
              .where(eq(projectRevisions.projectId, row.project.id))
              .pipe(Effect.orDie);
            yield* runtime.undeployProject(row.project.id);
            yield* database.delete(projects).where(eq(projects.id, row.project.id)).pipe(Effect.orDie);
            yield* Effect.forEach(
              snapshots,
              (snapshot) =>
                revisions.delete(snapshot.r2Key).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logError("Failed to remove project revision snapshot", cause),
                  ),
                ),
              { discard: true },
            );
          }),
        )
        .handle(
          "getAccess",
          Effect.fnUntraced(function* ({ params }) {
            const user = yield* CurrentUser;
            const project = yield* getAccessibleProject(params.projectId, user.id);
            if (project === undefined) return yield* new ProjectNotFound();
            const rows = yield* database
              .select({ userId: projectMembers.userId })
              .from(projectMembers)
              .where(eq(projectMembers.projectId, project.id))
              .pipe(Effect.orDie);
            return { access: project.access, userIds: rows.map((row) => row.userId) };
          }),
        )
        .handle(
          "setAccess",
          Effect.fnUntraced(function* ({ params, payload }) {
            const user = yield* CurrentUser;
            const rows = yield* database
              .select({ project: projects, role: teamMemberships.role })
              .from(projects)
              .innerJoin(
                teamMemberships,
                and(
                  eq(teamMemberships.teamId, projects.teamId),
                  eq(teamMemberships.userId, user.id),
                ),
              )
              .where(eq(projects.id, params.projectId))
              .limit(1)
              .pipe(Effect.orDie);
            const row = rows[0];
            if (row === undefined) return yield* new ProjectNotFound();
            if (row.role === "member") return yield* new HttpApiError.Forbidden();
            const userIds =
              payload.access === "restricted"
                ? yield* validateProjectMembers(row.project.teamId, payload.userIds)
                : [];
            yield* database
              .transaction((transaction) =>
                Effect.gen(function* () {
                  yield* transaction
                    .update(projects)
                    .set({ access: payload.access })
                    .where(eq(projects.id, row.project.id));
                  yield* transaction
                    .delete(projectMembers)
                    .where(eq(projectMembers.projectId, row.project.id));
                  if (userIds.length > 0)
                    yield* transaction.insert(projectMembers).values(
                      userIds.map((userId) => ({
                        projectId: row.project.id,
                        userId,
                        createdAt: new Date().toISOString(),
                      })),
                    );
                }),
              )
              .pipe(Effect.orDie);
            return { project: { ...row.project, access: payload.access }, userIds };
          }),
        ),
    );

    const revisionsHandlers = HttpApiBuilder.group(Api, "revisions", (handlers) =>
      handlers
        .handle(
          "list",
          Effect.fnUntraced(function* ({ params }) {
            const user = yield* CurrentUser;
            const project = yield* getAccessibleProject(params.projectId, user.id);
            if (project === undefined) return yield* new ProjectNotFound();
            const rows = yield* database
              .select()
              .from(projectRevisions)
              .where(eq(projectRevisions.projectId, project.id))
              .orderBy(desc(projectRevisions.createdAt))
              .pipe(Effect.orDie);
            return { revisions: rows };
          }),
        )
        .handle(
          "get",
          Effect.fnUntraced(function* ({ params }) {
            const user = yield* CurrentUser;
            const project = yield* getAccessibleProject(params.projectId, user.id);
            if (project === undefined) return yield* new ProjectNotFound();
            const rows = yield* database
              .select()
              .from(projectRevisions)
              .where(
                and(
                  eq(projectRevisions.id, params.revisionId),
                  eq(projectRevisions.projectId, project.id),
                ),
              )
              .limit(1)
              .pipe(Effect.orDie);
            const revision = rows[0];
            if (revision === undefined) return yield* new RevisionNotFound();
            const object = yield* revisions.get(revision.r2Key).pipe(Effect.orDie);
            if (object === null) return yield* new RevisionNotFound();
            const json = yield* object.text().pipe(Effect.orDie);
            const value = yield* Effect.try({
              try: () => JSON.parse(json),
              catch: (cause) => cause,
            }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Project.Model)), Effect.orDie);
            return { revision, snapshot: value };
          }),
        )
        .handle("deploy", deployRevision),
    );

    const ingressEventsHandlers = HttpApiBuilder.group(Api, "ingressEvents", (handlers) =>
      handlers.handle(
        "list",
        Effect.fnUntraced(function* ({ params }) {
          const user = yield* CurrentUser;
          const project = yield* getAccessibleProject(params.projectId, user.id);
          if (project === undefined) return yield* new ProjectNotFound();
          const rows = yield* database
            .select()
            .from(projectIngressEvents)
            .where(eq(projectIngressEvents.projectId, project.id))
            .orderBy(desc(projectIngressEvents.receivedAt))
            .limit(200)
            .pipe(Effect.orDie);
          return {
            events: rows.map((event) => ({
              ...event,
              eventPayload: JSON.parse(event.eventPayload),
            })),
          };
        }),
      ),
    );

    const executionsHandlers = HttpApiBuilder.group(Api, "executions", (handlers) =>
      handlers
        .handle(
          "list",
          Effect.fnUntraced(function* ({ params, query }) {
            const user = yield* CurrentUser;
            const project = yield* getAccessibleProject(params.projectId, user.id);
            if (project === undefined) return yield* new ProjectNotFound();
            const condition = query.revisionId
              ? and(
                  eq(projectExecutions.projectId, project.id),
                  eq(projectExecutions.revisionId, query.revisionId),
                )
              : eq(projectExecutions.projectId, project.id);
            const rows = yield* database
              .select()
              .from(projectExecutions)
              .where(condition)
              .orderBy(desc(projectExecutions.receivedAt))
              .pipe(Effect.orDie);
            return { executions: rows.map(decodeExecution) };
          }),
        )
        .handle(
          "get",
          Effect.fnUntraced(function* ({ params }) {
            const user = yield* CurrentUser;
            const project = yield* getAccessibleProject(params.projectId, user.id);
            if (project === undefined) return yield* new ProjectNotFound();
            const rows = yield* database
              .select()
              .from(projectExecutions)
              .where(
                and(
                  eq(projectExecutions.id, params.executionId),
                  eq(projectExecutions.projectId, project.id),
                ),
              )
              .limit(1)
              .pipe(Effect.orDie);
            const execution = rows[0];
            if (execution === undefined) return yield* new ExecutionNotFound();
            const nodes = yield* database
              .select()
              .from(projectExecutionNodes)
              .where(eq(projectExecutionNodes.executionId, execution.id))
              .orderBy(projectExecutionNodes.startedAt)
              .pipe(Effect.orDie);
            return { execution: decodeExecution(execution), nodes };
          }),
        ),
    );

    const previewsHandlers = HttpApiBuilder.group(Api, "previews", (handlers) =>
      handlers.handle("start", startPreview).handle("stop", stopPreview),
    );

    const rpcRoute = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return yield* handleRpc({ request });
    });
    const rpcRoutes = Layer.mergeAll(
      HttpRouter.add("GET", "/rpc", rpcRoute),
      HttpRouter.add("POST", "/rpc", rpcRoute),
    );

    const authentication = Layer.succeed(Authentication)({
      session: (effect, { credential }) =>
        Effect.gen(function* () {
          const userId = yield* cloudAuths.getByName(Redacted.value(credential)).userId();
          if (userId === undefined) return yield* new HttpApiError.Unauthorized();
          yield* ensureUser(userId);
          return yield* effect.pipe(
            Effect.provideService(CurrentUser, {
              id: userId,
              sessionId: Redacted.value(credential),
            }),
          );
        }),
    });

    const handlers = Layer.mergeAll(
      sessionHandlers,
      teamsHandlers,
      projectsHandlers,
      revisionsHandlers,
      executionsHandlers,
      ingressEventsHandlers,
      previewsHandlers,
    );

    return { authentication, handlers, rpcRoutes };
  });
