CREATE TABLE "registry_packages" (
	"id" text PRIMARY KEY,
	"publisher" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_publishers" (
	"name" text PRIMARY KEY,
	"owner_user_id" text NOT NULL,
	"status" text NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registry_releases" (
	"id" text PRIMARY KEY,
	"package_id" text NOT NULL,
	"version" text NOT NULL,
	"api" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"integrity" text NOT NULL,
	"tarball_key" text NOT NULL,
	"trust_override" text,
	"status" text NOT NULL,
	"reason" text,
	"signed_record" jsonb NOT NULL,
	"signature" jsonb NOT NULL,
	"published_by" text NOT NULL,
	"published_at" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "registry_packages_publisher_name_unique" ON "registry_packages" ("publisher","name");--> statement-breakpoint
CREATE INDEX "registry_publishers_owner_idx" ON "registry_publishers" ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registry_releases_package_version_unique" ON "registry_releases" ("package_id","version");--> statement-breakpoint
ALTER TABLE "registry_packages" ADD CONSTRAINT "registry_packages_publisher_registry_publishers_name_fkey" FOREIGN KEY ("publisher") REFERENCES "registry_publishers"("name");--> statement-breakpoint
ALTER TABLE "registry_publishers" ADD CONSTRAINT "registry_publishers_owner_user_id_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "registry_releases" ADD CONSTRAINT "registry_releases_package_id_registry_packages_id_fkey" FOREIGN KEY ("package_id") REFERENCES "registry_packages"("id");--> statement-breakpoint
ALTER TABLE "registry_releases" ADD CONSTRAINT "registry_releases_published_by_users_id_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id");