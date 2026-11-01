CREATE TABLE "gateway_api_keys" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"last_used_at" text
);
--> statement-breakpoint
CREATE TABLE "gateway_approvals" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"tool" text NOT NULL,
	"provider" text NOT NULL,
	"account_id" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"caller" text,
	"status" text NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"decided_at" text,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "gateway_tool_policies" (
	"user_id" text,
	"tool" text,
	"policy" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "gateway_tool_policies_pkey" PRIMARY KEY("user_id","tool")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_api_keys_key_hash_unique" ON "gateway_api_keys" ("key_hash");--> statement-breakpoint
CREATE INDEX "gateway_api_keys_user_id_idx" ON "gateway_api_keys" ("user_id");--> statement-breakpoint
CREATE INDEX "gateway_approvals_user_created_idx" ON "gateway_approvals" ("user_id","created_at");