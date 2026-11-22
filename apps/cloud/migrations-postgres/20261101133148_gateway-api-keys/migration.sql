CREATE TABLE "gateway_api_keys" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"last_used_at" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_api_keys_key_hash_unique" ON "gateway_api_keys" ("key_hash");--> statement-breakpoint
CREATE INDEX "gateway_api_keys_user_id_idx" ON "gateway_api_keys" ("user_id");