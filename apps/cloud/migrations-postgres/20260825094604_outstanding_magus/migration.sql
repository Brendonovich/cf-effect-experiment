CREATE TABLE "project_events" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"ingress_event_id" text,
	"plugin_id" text NOT NULL,
	"event_type" text NOT NULL,
	"provider_event_id" text,
	"event_payload" text NOT NULL,
	"received_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_executions" ADD COLUMN "project_event_id" text;--> statement-breakpoint
INSERT INTO "project_events" (
	"id",
	"project_id",
	"source",
	"ingress_event_id",
	"plugin_id",
	"event_type",
	"provider_event_id",
	"event_payload",
	"received_at"
)
SELECT
	"id",
	"project_id",
	CASE
		WHEN "ingress_event_id" IS NOT NULL THEN 'ingress'
		WHEN "plugin_id" = 'utilities' AND "event_type" = 'TickEvent' THEN 'timer'
		ELSE 'internal'
	END,
	"ingress_event_id",
	"plugin_id",
	"event_type",
	"event_id",
	COALESCE("event_payload", 'null'),
	"received_at"
FROM "project_executions";--> statement-breakpoint
UPDATE "project_executions" SET "project_event_id" = "id";--> statement-breakpoint
ALTER TABLE "project_executions" ALTER COLUMN "project_event_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "project_events_project_received_idx" ON "project_events" ("project_id","received_at");--> statement-breakpoint
CREATE INDEX "project_events_ingress_event_idx" ON "project_events" ("ingress_event_id");--> statement-breakpoint
CREATE INDEX "project_executions_project_event_idx" ON "project_executions" ("project_event_id");--> statement-breakpoint
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_ingress_event_id_project_ingress_events_id_fkey" FOREIGN KEY ("ingress_event_id") REFERENCES "project_ingress_events"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "project_executions" ADD CONSTRAINT "project_executions_project_event_id_project_events_id_fkey" FOREIGN KEY ("project_event_id") REFERENCES "project_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_executions" DROP CONSTRAINT "project_executions_f5OncwmHGuBs_fkey";--> statement-breakpoint
DROP INDEX "project_executions_ingress_event_idx";--> statement-breakpoint
ALTER TABLE "project_executions" DROP COLUMN "ingress_event_id";--> statement-breakpoint
ALTER TABLE "project_executions" DROP COLUMN "plugin_id";--> statement-breakpoint
ALTER TABLE "project_executions" DROP COLUMN "event_type";--> statement-breakpoint
ALTER TABLE "project_executions" DROP COLUMN "event_id";--> statement-breakpoint
ALTER TABLE "project_executions" DROP COLUMN "event_payload";