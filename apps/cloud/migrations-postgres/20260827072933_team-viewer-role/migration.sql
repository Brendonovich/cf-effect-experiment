-- Preserve existing restricted-project access when admins become members.
INSERT INTO "project_members" ("project_id", "user_id", "created_at")
SELECT "projects"."id", "team_memberships"."user_id", "team_memberships"."created_at"
FROM "projects"
INNER JOIN "team_memberships" ON "team_memberships"."team_id" = "projects"."team_id"
WHERE "team_memberships"."role" = 'admin' AND "projects"."access" = 'restricted'
ON CONFLICT ("project_id", "user_id") DO NOTHING;
--> statement-breakpoint
UPDATE "team_memberships" SET "role" = 'member' WHERE "role" = 'admin';
