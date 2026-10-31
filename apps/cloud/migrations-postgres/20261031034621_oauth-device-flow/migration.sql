CREATE TABLE "auth_access_tokens" (
	"token_hash" varchar(64) PRIMARY KEY,
	"grant_id" varchar(64) NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_clients" (
	"id" varchar(64) PRIMARY KEY,
	"secret_hash" varchar(64) NOT NULL,
	"registration_token_hash" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"software_id" varchar(255),
	"software_version" varchar(255),
	"token_endpoint_auth_method" varchar(32) NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"created_ip" varchar(64)
);
--> statement-breakpoint
CREATE TABLE "auth_device_authorizations" (
	"device_code_hash" varchar(64) PRIMARY KEY,
	"user_code" varchar(8) NOT NULL UNIQUE,
	"client_id" varchar(64) NOT NULL,
	"scope" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"user_id" varchar(255),
	"interval_seconds" integer NOT NULL,
	"last_polled_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"request_ip" varchar(64),
	"request_country" varchar(8)
);
--> statement-breakpoint
CREATE TABLE "auth_grants" (
	"id" varchar(64) PRIMARY KEY,
	"client_id" varchar(64) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"key" varchar(255) PRIMARY KEY,
	"window_start" timestamp NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_refresh_tokens" (
	"token_hash" varchar(64) PRIMARY KEY,
	"grant_id" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"rotated_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "auth_access_tokens_grant_idx" ON "auth_access_tokens" ("grant_id");--> statement-breakpoint
CREATE INDEX "auth_device_authorizations_client_idx" ON "auth_device_authorizations" ("client_id");--> statement-breakpoint
CREATE INDEX "auth_grants_user_idx" ON "auth_grants" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_grants_client_idx" ON "auth_grants" ("client_id");--> statement-breakpoint
CREATE INDEX "auth_refresh_tokens_grant_idx" ON "auth_refresh_tokens" ("grant_id");--> statement-breakpoint
ALTER TABLE "auth_access_tokens" ADD CONSTRAINT "auth_access_tokens_grant_id_auth_grants_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "auth_grants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_device_authorizations" ADD CONSTRAINT "auth_device_authorizations_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_grants" ADD CONSTRAINT "auth_grants_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_refresh_tokens" ADD CONSTRAINT "auth_refresh_tokens_grant_id_auth_grants_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "auth_grants"("id") ON DELETE CASCADE;