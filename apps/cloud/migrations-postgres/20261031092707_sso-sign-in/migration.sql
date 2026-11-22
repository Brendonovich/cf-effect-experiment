CREATE TABLE "user_identity" (
	"provider_id" varchar(255),
	"provider_user_id" varchar(255),
	"user_id" varchar(255) NOT NULL,
	"email" varchar(255),
	"display_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_identity_pkey" PRIMARY KEY("provider_id","provider_user_id")
);
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "hashed_password" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "user_identity_user_idx" ON "user_identity" ("user_id");--> statement-breakpoint
ALTER TABLE "user_identity" ADD CONSTRAINT "user_identity_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;