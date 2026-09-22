# Account Tables Cutover

This cutover moves the old app's account and OAuth tables from
`macrograph_legacy` into the primary production Cloud logical database. It does
not move the old `project` table. After cutover, the old app may continue serving
authentication, device registration, server registration, and credential routes;
its legacy project routes are not supported.

## Cutover Record

**Completed on 2026-09-19.** The seven account tables were copied to
`macrograph_applogicaldatabase_production_zrkrfranxqdw63gh`. Source and target
row counts were `[108, 245, 78, 14, 79, 130, 144]`, and deterministic hashes for
all seven tables matched after the copy. Writes were revoked from the retained
legacy runtime role before the application cutover.

The schema was applied by GitHub Actions run `35427123129`. The old app was
rebuilt as production deployment `dpl_9yjLyALFZJvvPGLgK3umWS45wNLs` with a
sensitive `DATABASE_URL` targeting the primary database. Public checks returned
`200` for the application, the expected `403` for anonymous credential access,
and `200` for credential access through an existing migrated session. The
retained `macrograph_legacy` database is now a read-only rollback source.

## Tables

- `user`
- `session`
- `oauth_credential`
- `device_code_sessions`
- `oauth_sessions`
- `oauth_apps`
- `server_registration_sessions`

The table names and columns intentionally match the old app so its existing
Drizzle schema remains compatible. Cloud's newer `users` and `projects` tables
remain separate.

## Preconditions

1. Configure libpq services for an admin connection to `macrograph_legacy` and
   an admin connection to the primary production Cloud logical database. The
   script defaults to `macrograph_legacy_admin` and `macrograph_app_admin`; use
   `LEGACY_AUTH_SOURCE_SERVICE` and `LEGACY_AUTH_TARGET_SERVICE` to override them.
   The source service must use the direct Postgres port (`5432`), because
   PlanetScale rejects `pg_dump` over pooled connections.
2. Use PostgreSQL client tools with a major version at least as new as the
   server. The completed cutover used PostgreSQL 18 tools.
3. Pause the old web app and prevent Cloud credential writes. Do not deploy the
   Cloud cutover or run the copy while either database has active writers.
4. Deploy the generated Postgres migration and Cloud worker. This creates all
   seven target tables and switches Cloud credential access to them; keep Cloud
   traffic paused because the tables remain empty until the copy finishes.
5. Confirm the target account tables are empty. The script also enforces this and
   will never merge into or overwrite populated tables.

## Copy And Validate

From `apps/cloud`, run:

```sh
MIGRATION_CONFIRM=writers-paused pnpm db:migrate-accounts
```

The script:

- creates a restricted temporary custom-format dump containing only the seven
  account tables;
- restores it into the primary database in one target transaction;
- restores the two serial sequence positions; and
- compares per-table source and target row counts without logging row contents.

The temporary archive is deleted on exit. Treat the terminal and machine as
sensitive while the command runs because the archive contains password hashes,
OAuth tokens, and active sessions.

## Cut Over The Old App

After validation, update the old app's `DATABASE_URL` to the primary production
Cloud logical database using a runtime role with table and sequence privileges.
Restart every old-app instance before resuming traffic. Keep writers paused until
Cloud credential listing, credential refresh, device login, and server
registration have been exercised against the target.

Do not resume the old legacy project UI: its `project` table remains in
`macrograph_legacy` by design.

## Rollback

Before target writes begin, point the old app back to `macrograph_legacy` and
redeploy the previous Cloud worker. After any target write, the databases have
diverged; pause writers and reconcile account rows before changing either
connection. Keep the retained legacy logical database until the rollback window
has closed.
