ALTER TABLE "project_executions" ADD COLUMN "ingress_event_id" text;--> statement-breakpoint
ALTER TABLE "project_executions" ADD COLUMN "plugin_id" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
CREATE INDEX "project_executions_ingress_event_idx" ON "project_executions" ("ingress_event_id");--> statement-breakpoint
ALTER TABLE "project_executions" ADD CONSTRAINT "project_executions_f5OncwmHGuBs_fkey" FOREIGN KEY ("ingress_event_id") REFERENCES "project_ingress_events"("id") ON DELETE SET NULL;