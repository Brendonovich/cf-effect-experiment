CREATE TABLE "project_execution_nodes" (
	"id" text PRIMARY KEY,
	"execution_id" text NOT NULL,
	"step_name" text NOT NULL,
	"graph_id" text NOT NULL,
	"event_node_id" text NOT NULL,
	"node_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"completed_at" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "project_executions" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"event_type" text NOT NULL,
	"event_id" text,
	"event_payload" text,
	"status" text NOT NULL,
	"received_at" text NOT NULL,
	"started_at" text,
	"completed_at" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "project_ingress_events" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"event_type" text NOT NULL,
	"event_id" text,
	"event_payload" text NOT NULL,
	"received_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" text,
	"user_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "project_members_pkey" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_revisions" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY,
	"team_id" text NOT NULL,
	"created_by" text NOT NULL,
	"access" text NOT NULL,
	"name" text NOT NULL,
	"current_revision_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"team_id" text,
	"user_id" text,
	"role" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "team_memberships_pkey" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"personal_owner_user_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_execution_nodes_execution_step_unique" ON "project_execution_nodes" ("execution_id","step_name");--> statement-breakpoint
CREATE INDEX "project_execution_nodes_execution_started_idx" ON "project_execution_nodes" ("execution_id","started_at");--> statement-breakpoint
CREATE INDEX "project_executions_project_received_idx" ON "project_executions" ("project_id","received_at");--> statement-breakpoint
CREATE INDEX "project_executions_revision_received_idx" ON "project_executions" ("revision_id","received_at");--> statement-breakpoint
CREATE INDEX "project_ingress_events_project_received_idx" ON "project_ingress_events" ("project_id","received_at");--> statement-breakpoint
CREATE INDEX "project_members_user_project_idx" ON "project_members" ("user_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_revisions_r2_key_unique" ON "project_revisions" ("r2_key");--> statement-breakpoint
CREATE INDEX "project_revisions_project_created_idx" ON "project_revisions" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_team_updated_idx" ON "projects" ("team_id","updated_at");--> statement-breakpoint
CREATE INDEX "team_memberships_user_team_idx" ON "team_memberships" ("user_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_personal_owner_unique" ON "teams" ("personal_owner_user_id");--> statement-breakpoint
ALTER TABLE "project_execution_nodes" ADD CONSTRAINT "project_execution_nodes_execution_id_project_executions_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "project_executions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_executions" ADD CONSTRAINT "project_executions_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_executions" ADD CONSTRAINT "project_executions_revision_id_project_revisions_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "project_revisions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_ingress_events" ADD CONSTRAINT "project_ingress_events_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_revisions" ADD CONSTRAINT "project_revisions_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_personal_owner_user_id_users_id_fkey" FOREIGN KEY ("personal_owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE;