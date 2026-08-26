ALTER TABLE "project_ingress_events" ADD COLUMN "preview_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_ingress_events" ADD COLUMN "preview_generation" text;