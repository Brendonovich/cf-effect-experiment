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
CREATE INDEX "gateway_approvals_user_created_idx" ON "gateway_approvals" ("user_id","created_at");