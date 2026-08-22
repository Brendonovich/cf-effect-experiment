import { index, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

export type TeamRole = "owner" | "admin" | "member";
export type TeamKind = "personal" | "shared";
export type ProjectAccess = "team" | "restricted";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull().$type<TeamKind>(),
    personalOwnerUserId: text("personal_owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("teams_personal_owner_unique").on(table.personalOwnerUserId)],
);

export const teamMemberships = pgTable(
  "team_memberships",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<TeamRole>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index("team_memberships_user_team_idx").on(table.userId, table.teamId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    access: text("access").notNull().$type<ProjectAccess>(),
    name: text("name").notNull(),
    currentRevisionId: text("current_revision_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("projects_team_updated_idx").on(table.teamId, table.updatedAt)],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_members_user_project_idx").on(table.userId, table.projectId),
  ],
);

export const projectRevisions = pgTable(
  "project_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    r2Key: text("r2_key").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("project_revisions_r2_key_unique").on(table.r2Key),
    index("project_revisions_project_created_idx").on(table.projectId, table.createdAt),
  ],
);

export type ProjectExecutionStatus = "queued" | "running" | "complete" | "errored";

export const projectIngressEvents = pgTable(
  "project_ingress_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    endpointId: text("endpoint_id").notNull(),
    pluginId: text("plugin_id").notNull(),
    eventType: text("event_type").notNull(),
    eventId: text("event_id"),
    eventPayload: text("event_payload").notNull(),
    receivedAt: text("received_at").notNull(),
  },
  (table) => [
    index("project_ingress_events_project_received_idx").on(table.projectId, table.receivedAt),
  ],
);

export const projectExecutions = pgTable(
  "project_executions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => projectRevisions.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventId: text("event_id"),
    eventPayload: text("event_payload"),
    status: text("status").notNull().$type<ProjectExecutionStatus>(),
    receivedAt: text("received_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    error: text("error"),
  },
  (table) => [
    index("project_executions_project_received_idx").on(table.projectId, table.receivedAt),
    index("project_executions_revision_received_idx").on(table.revisionId, table.receivedAt),
  ],
);

export type ProjectExecutionNodeStatus = "running" | "complete" | "errored";

export const projectExecutionNodes = pgTable(
  "project_execution_nodes",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id")
      .notNull()
      .references(() => projectExecutions.id, { onDelete: "cascade" }),
    stepName: text("step_name").notNull(),
    graphId: text("graph_id").notNull(),
    eventNodeId: text("event_node_id").notNull(),
    nodeId: text("node_id").notNull(),
    kind: text("kind").notNull().$type<"event" | "exec">(),
    status: text("status").notNull().$type<ProjectExecutionNodeStatus>(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    error: text("error"),
  },
  (table) => [
    uniqueIndex("project_execution_nodes_execution_step_unique").on(
      table.executionId,
      table.stepName,
    ),
    index("project_execution_nodes_execution_started_idx").on(table.executionId, table.startedAt),
  ],
);

export type ProjectRecord = typeof projects.$inferSelect;
export type TeamRecord = typeof teams.$inferSelect;
export type TeamMembershipRecord = typeof teamMemberships.$inferSelect;
export type ProjectRevisionRecord = typeof projectRevisions.$inferSelect;
export type ProjectIngressEventRecord = typeof projectIngressEvents.$inferSelect;
export type ProjectExecutionRecord = typeof projectExecutions.$inferSelect;
export type ProjectExecutionNodeRecord = typeof projectExecutionNodes.$inferSelect;
