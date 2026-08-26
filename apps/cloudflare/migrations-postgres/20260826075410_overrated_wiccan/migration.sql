CREATE TABLE "project_ingress_desired" (
	"project_id" text PRIMARY KEY,
	"public_origin" text NOT NULL,
	"preview_engines" jsonb,
	"preview_ids" jsonb DEFAULT '[]' NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "project_ingress_endpoints" (
	"project_id" text,
	"endpoint_id" text,
	"handler_id" text NOT NULL,
	"instance_key" text NOT NULL,
	"url" text NOT NULL,
	"schema_display_name" text NOT NULL,
	"display_name" text,
	"metadata" jsonb NOT NULL,
	"deployed" boolean DEFAULT false NOT NULL,
	"preview" boolean DEFAULT false NOT NULL,
	CONSTRAINT "project_ingress_endpoints_pkey" PRIMARY KEY("project_id","endpoint_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_ingress_endpoints_handler_instance_unique" ON "project_ingress_endpoints" ("project_id","handler_id","instance_key");--> statement-breakpoint
ALTER TABLE "project_ingress_desired" ADD CONSTRAINT "project_ingress_desired_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_ingress_endpoints" ADD CONSTRAINT "project_ingress_endpoints_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;