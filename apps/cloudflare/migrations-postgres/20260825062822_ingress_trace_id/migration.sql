ALTER TABLE "project_ingress_events" ADD COLUMN "trace_id" text;--> statement-breakpoint
ALTER TABLE "project_ingress_events" DROP COLUMN "span_id";