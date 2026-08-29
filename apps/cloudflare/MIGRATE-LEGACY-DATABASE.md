# Legacy MacroGraph Database Migration

Move the existing `macrograph/apps/web` database from Supabase into a separate
logical database on the PlanetScale Postgres cluster managed by this app. This
does not merge data into the new cloud app or change either app's schema.

## Cutover Records

**Completed on 2026-08-29 (Australia/Perth).** `macrograph.app` and
`www.macrograph.app` are live on `macrograph_legacy`. The tested and promoted
Vercel deployment is `dpl_GwNoY7EucNRhBy8AaTG94tpMupS4`
(`macrograph-g47vacz52-brendan-allans-projects.vercel.app`), rebuilt from the exact
original production source. The database URL is shared across Vercel production,
preview, and development.

The approved cutover has frozen Supabase's eight app tables and three serial
sequences by revoking write grants from the application role and its inherited
grantees. Original grants and a recovery SQL file are saved privately under
`.alchemy/legacy-migration/final/`. The source password has been rotated through
Supabase's Management API; the old password is rejected on ports 5432 and 6543.
Supabase-managed services were updated by the platform, and app data was retained.

The final read-only snapshot was captured at `2026-08-28T17:12:08.684Z`. Its
55,083-byte archive was restored into `macrograph_legacy`. Schema, row counts,
data hashes, sequence states, direct/pooled reads, and rolled-back runtime writes
passed validation. The write tests used explicit IDs so sequences were not advanced.
Vercel's `DATABASE_URL` now has the prepared target value across production,
preview, and development. No local `.env` was present in the attached old repo.

Vercel project pause blocks **all new builds**, including production deployments
with `autoAssignCustomDomains: false`. The two attempted builds were marked
`BLOCKED`, not built. With explicit approval, a temporary WAF deny rule was added
for the four public project domains and the project was unpaused to allow builds.
All public domains returned 403 after this change. A new staged production
deployment of the exact original source was then requested, without assigning
custom domains. It passed home/login-page, anonymous API, session authentication,
user/credentials API, and account-page checks using a target-only synthetic user.
Synthetic records were removed and all data hashes still matched the final dump.
All four public aliases were then verified against the tested deployment before
removing the maintenance rule. There are no remaining custom firewall rules.

All public project domains returned 200 after release. Authenticated checks on
`www.macrograph.app` independently confirmed target-database reads through the
user API, credentials API, and account page. The second synthetic user/session
was removed too. No real user's session or OAuth token was used for testing.
Real-password login and third-party OAuth refresh/consent were not exercised;
password hashes, existing sessions, and credential rows were verified by checksum.

The final archive, manifests, validation reports, saved source grants, and current
connection/recovery information have a private backup copy outside Alchemy's
cache at `~/.local/share/macrograph/legacy-db-cutover-20260829-CMNDmk/`.
Directories are mode `0700` and files are `0600`. The archive itself is not
encrypted, and this is a local backup, not an off-site copy. The location is also
recorded in `.alchemy/legacy-migration/final/backup-location.json`. Retain it and
the frozen Supabase database through the agreed rollback window.

Do not use the original Vercel secret or promote an older deployment as a rollback:
those deployments retain the invalid old source password. The current source
maintenance connection is in the private `source-database-url` and
`source-database-url.rotated` files; `pgpass` has been updated too. Before any
source rollback, first determine whether the target has accepted real writes,
reconcile them if needed, restore the saved source grants, and deploy the old app
with the **rotated** source credentials. Do not restore the exposed old password.

## Preparation Results

- Confirmed source: Supabase project `pbcldfcdqefnpnuwbuad`, PostgreSQL 15.1.
- Confirmed target: PlanetScale organization/cluster `macrograph`, branch `main`,
  PostgreSQL 18.6; Alchemy stack `MacroGraph`, stage `production`.
- Provisioned `macrograph_legacy` and the production legacy runtime role through
  a resource-only plan. Existing workers, migrations, and database resources were
  not deployed or changed. A subsequent resource-only plan reports four noops.
- Created a consistent, read-only source snapshot using `pg_export_snapshot()`
  and `pg_dump --snapshot`. Its archive is 55,083 bytes and contains all eight app
  tables, the enum, indexes/constraints, and three serial sequences.
- Verified an isolated restore against snapshot row counts and SHA-256 data
  hashes, column types/defaults/nullability, indexes, constraints, enum values,
  and sequence states. Verified runtime reads and transactional writes through
  both direct and pooled connections, and runtime isolation from the new app.
  The successful rehearsal database and its idle pooled connections were removed.
- Tested the old app's exact Postgres.js 3.4.5 driver on Node 24 with
  `prepare: false`, pooled transactions, and `sslmode=verify-full`.
- At the end of preparation, the final database was empty and the old app was
  unchanged. These historical preparation results precede the cutover above.

Private artifacts and one-off tooling are under `.alchemy/legacy-migration/`,
which is gitignored. The directory is permission-restricted; sensitive files
are mode `0600`. `snapshot.json` records the snapshot inventory/checksums,
`rehearsal.dump` is the source archive, `rehearsal-report.json` records the passed
checks and cleanup, and `target-database-url` contains the prepared pooled URL.
`pg_service.conf` and `pgpass` configure private native-client connections.
`vercel-database-env.original.json` and
`vercel-deployment.original.json` retain rollback information. Do not print these
secret files or include them in a commit. `rehearsal.dump` is the preparation
snapshot, not the final migration dump. The final archive and phase reports are
under `final/`; use those for recovery. Retain an encrypted off-site backup as
well as the permission-restricted local copies.

The source database uses `C.UTF-8` collation/ctype; logical databases created by
the existing provider use `C`. Restored data/schema checks pass, but these are not
identical locale settings, especially for non-ASCII case conversion and character
classification. No locale-sensitive SQL was found in the old app's database
queries. Reassess this if there are other consumers relying on locale behavior.

## Managed Target

- `AppPostgresDatabase`: existing PlanetScale cluster named `macrograph`.
- `LegacyLogicalDatabase`: logical database named `macrograph_legacy`, shared by dev and prod.
- `LegacyDatabaseRuntimeRole`: stage-specific runtime role with no inherited admin roles.
- `AppDatabaseAdminRole`: existing admin role used to create the target and grant access.

The legacy database and runtime role have `retain()` policies. Removing them from
the stack will not delete them, but retention is not a backup or protection against
manual deletion. Normal deploy/dev runs resolve to the same legacy logical
database on the cluster's `main` branch, with separate managed roles per stage.
Use the existing production stage for the one-time migration. Do not restore
again for dev or run destructive tests against this shared database.

The old web app should use the same target `DATABASE_URL` in dev and prod,
preserving its existing shared-database setup. **Dev writes affect production
data.** The new cloud app's logical databases remain stage-specific.

Runtime grants are not an admin security boundary:
every stage's admin role inherits `postgres` on the shared cluster and can access
other logical databases. Restrict those credentials accordingly; use separate
clusters if non-production admins must not have production access.

There are deliberately no `migrationsDir` or `importFiles` on the legacy database.
Restore its real schema and data once, outside Alchemy. Future legacy schema
changes remain owned by the old app's Drizzle configuration, using an admin
connection. Never run the new app's migrations against the legacy database.

## Prerequisites

Run commands from `apps/cloudflare`. Check the cutover records above before
executing anything: the final database is now populated and must not be restored
again using the empty-target procedure below.

On this machine, PostgreSQL 18.6 client tools are installed separately from the
older default tools. Select them explicitly for subsequent commands:

```sh
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
export PGSERVICEFILE="$PWD/.alchemy/legacy-migration/pg_service.conf"
pg_dump --version
pg_restore --version
```

1. Identify the production Supabase project, PlanetScale organization/branch, and
   existing Alchemy stage. Confirm capacity for both apps on the shared cluster.
2. Obtain the source database credentials from the old app's deployment secrets or
   Supabase. The attached old repository has no local `.env`. Use a direct or
   session-pooler connection, not Supabase's transaction pooler, for dump/restore.
3. Check `SHOW server_version` on both servers. Use matching `pg_dump`/`pg_restore`
   tools at least as new as the source server, preferably matching the target
   major version, and do not migrate to an older server without compatibility
   testing. Use the installed PostgreSQL 18.6 tools for this 15.1-to-18.6 migration.
4. Arrange a maintenance window that stops **all** source writers: web replicas,
   local dev instances, OAuth token refreshes, background jobs, and other clients.
   A consistent dump does not include writes made after its snapshot. Do a
   rehearsal first.
5. Keep a Supabase backup and the original deployment configuration for rollback.

Inspect the actual source catalog, not just the TypeScript schema. The old app
uses `postgres`/Drizzle through `DATABASE_URL`, not the Supabase client or Supabase
Auth. Its code declares these eight `public` tables:

`user`, `session`, `oauth_credential`, `project`, `device_code_sessions`,
`oauth_sessions`, `oauth_apps`, `server_registration_sessions`.

It also declares the `ClientType` enum and serial sequences. Check for extra
tables, migration history (possibly in a `drizzle` schema), views, functions,
triggers, extensions, RLS policies, large objects, and dependencies on `auth`,
`storage`, `extensions`, or Supabase roles. Resolve any such dependencies before
using the `public`-only procedure below. Do not copy Supabase-managed schemas or
roles wholesale. `--no-acl` does not remove RLS policies or role references in
function bodies.

## Provision And Credentials

The production legacy resources are already provisioned. The full production
plan also contains unrelated worker/build/migration updates, so it was **not**
applied. The private `.alchemy/legacy-migration/provision.ts` helper selected only
the two legacy resources and their unchanged cluster/admin-role dependencies,
disabled deletions and stage-wide replacement cleanup, and preserved existing
stack outputs. It rejects replacements and unexpected changes to dependencies.
Do not apply unrelated stack updates merely to finish the database migration.

Set `STAGE` to the confirmed existing deployment stage, then review the plan:

```sh
pnpm alchemy deploy --stage "$STAGE" --dry-run
```

Stop if the plan replaces the existing cluster, database roles, or logical
database. This is a **whole-stack** command and may include unrelated worker or
migration changes. Once the complete plan is approved:

```sh
pnpm alchemy deploy --stage "$STAGE"
```

Confirm `legacyDatabaseName` from the stack output is `macrograph_legacy` in both
dev and prod. Do not rename the resource or point restore commands at `postgres`
or `AppLogicalDatabase`. If the earlier stage-specific configuration has already
been deployed, stop: the provider rejects database renames and an explicit
cutover is required rather than changing an existing database in place.

Use the production stage's deployed `AppDatabaseAdminRole` credentials for restore
and its `LegacyDatabaseRuntimeRole` credentials for both dev and prod of the old
web app. Role passwords are kept
in Alchemy state; PlanetScale may only return a new password once. To locate the
resource FQNs:

```sh
pnpm alchemy state resources --stack MacroGraph --stage "$STAGE"
```

`alchemy state get --stack MacroGraph --stage "$STAGE" --fqn <resource-fqn>`
includes **unwrapped secrets**. If needed, inspect it only in a private session
with output redirected to a permission-restricted location outside the repo.
Do not paste it into chat, commit it, or attach it to logs. Treat any local Alchemy
logs from credential retrieval as secret too.

The following libpq services are configured in the private service file, with
passwords in its permission-restricted passfile. Recheck credentials/identity
before cutover:

- `macrograph_supabase`: source direct/session-pooler connection and source dbname.
- `macrograph_legacy_admin`: target direct origin (port 5432), admin credentials,
  and `dbname` equal to the recorded `legacyDatabaseName`.
- `macrograph_legacy_runtime`: target direct origin, legacy runtime credentials,
  and that same logical database name.
- `macrograph_legacy_runtime_pooled`: the same runtime role/database via port 6432.

Supabase's session pooler ignores the startup `options` setting: setting
`default_transaction_read_only` through a service file or `PGOPTIONS` did not
take effect. Use explicit `BEGIN READ ONLY` transactions for interactive source
validation. The backup helper uses `BEGIN ISOLATION LEVEL REPEATABLE READ READ
ONLY`, and `pg_dump` manages its own read-only transaction. No global libpq
configuration or source database settings were modified.

Use `sslmode=verify-full` with the appropriate CA configuration. Supabase's
published CA was downloaded from
`https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`
to `.alchemy/legacy-migration/supabase-ca.crt`; set `sslrootcert` to that file for
the source. For the target, PostgreSQL 18's `sslrootcert=system` works.
Use the full
PlanetScale connection username, including its suffix, for authentication. Alchemy
strips the suffix only for SQL grants. Check each connection's identity:

```sh
PGSERVICE=macrograph_supabase psql -X -v ON_ERROR_STOP=1 -c 'SELECT current_database(), current_user, version();'
PGSERVICE=macrograph_legacy_admin psql -X -v ON_ERROR_STOP=1 -c 'SELECT current_database(), current_user, version();'
PGSERVICE=macrograph_legacy_runtime psql -X -v ON_ERROR_STOP=1 -c 'SELECT current_database(), current_user;'
```

## Dump And Restore

For the final migration, keep all source writers stopped from before the dump
until validation and cutover finish. For a rehearsal, use a separately managed,
empty logical database and do not let it refresh real OAuth tokens or serve users.
The dev stage is not a rehearsal target: it points at the same `macrograph_legacy`
database as prod. Never reuse a populated rehearsal database for the final restore.

Create a private working directory outside the repo. Dumps contain password
hashes, live sessions, access/refresh tokens, and project contents:

```sh
umask 077
WORKDIR="$(mktemp -d "${TMPDIR%/}/macrograph-migration.XXXXXX")"
PGSERVICE=macrograph_supabase pg_dump --format=custom --schema=public --no-owner --no-acl --file="$WORKDIR/legacy.dump"
pg_restore --list "$WORKDIR/legacy.dump" > "$WORKDIR/restore.list"
pg_restore --schema-only --no-owner --no-acl --file="$WORKDIR/schema.sql" "$WORKDIR/legacy.dump"
```

Review `schema.sql` and `restore.list` privately for the dependencies described
above. Include any required app-owned non-public schema/migration history in the
dump after auditing it; the commands here assume all required objects are public.
Do not expose dump contents in terminal recordings or diagnostics.

The target must contain only Alchemy's bookkeeping tables before restore:

```sh
PGSERVICE=macrograph_legacy_admin psql -X -v ON_ERROR_STOP=1 -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2;"
PGSERVICE=macrograph_legacy_admin psql -X -v ON_ERROR_STOP=1 -c 'TABLE public.__alchemy_logical_database_ownership;'
```

Confirm the database name exactly matches the intended stage's recorded
`legacyDatabaseName`, the ownership record belongs to `LegacyLogicalDatabase`,
and no application tables exist. The ownership row alone does not identify the
stage. Stop on any mismatch. The `public` schema
already exists and contains Alchemy's ownership table, so omit its creation from
the restore TOC while preserving tables, enums, sequences, data, and constraints:

```sh
awk '!/ SCHEMA - public /' "$WORKDIR/restore.list" > "$WORKDIR/restore-without-public.list"
PGSERVICE=macrograph_legacy_admin pg_restore --use-list="$WORKDIR/restore-without-public.list" --no-owner --no-acl --no-comments --single-transaction --exit-on-error --dbname="service=macrograph_legacy_admin" "$WORKDIR/legacy.dump"
```

Never add `--clean`, `--create`, or `--disable-triggers` to force a restore through.
If it fails, investigate the error before retrying. A single-transaction restore
into an empty target avoids leaving a partially imported application schema.

Restore as `AppDatabaseAdminRole` so its default table/sequence privileges apply
to the runtime role. A subsequent reviewed Alchemy deployment also reconciles
grants on restored public tables and sequences. If you restore with a different
admin, reconcile grants before cutover and configure default privileges for that
schema owner's future objects. Do not give the runtime role `postgres` privileges
to work around grant errors.

If using another stage's runtime role instead of the shared web-app connection,
review and deploy that stage after restore to grant access to the restored objects.
Default privileges belong to the creating admin role; future DDL from one stage
does not automatically grant access to every other stage's runtime role.

## Validate And Cut Over

1. Compare exact row counts and deterministic, primary-key-ordered data checksums
   for every app table against the still-frozen source. Retain private results;
   do not log raw credential rows. Check enum values, defaults, indexes, unique
   constraints, timestamps, and JSON project/token data as well as counts.
2. Compare each serial sequence's `last_value` and `is_called` against the source.
   A full dump includes sequence state; do not replace it with a guessed max ID.
3. Connect as the legacy runtime role and verify reads and transactional writes
   on every app table and access to sequences. Roll back test writes, but note
   that sequence increments are not rolled back. Confirm the legacy role cannot
   access the new app's logical database and vice versa.
4. Construct the old app's new `DATABASE_URL` from the legacy role's pooled origin
   (port 6432), replacing its default database path with `legacyDatabaseName` and
   requiring verified TLS. Percent-encode username/password/database components.
   Use this same URL for the old web app's local dev and production configurations.
   Keep it in private local/deployment secrets, not stack outputs. The old app
   already sets `prepare: false`, suitable for transaction pooling; no driver
   change is needed. PlanetScale's pooler rejects `statement_timeout` as a startup
   parameter; use a client-side timeout or `SET LOCAL` inside a transaction instead.
5. Switch only the old app's `DATABASE_URL`, leaving signing/session secrets and
   other environment variables unchanged. Restart **all** dev and prod instances
   so cached connections cannot continue writing to Supabase. Keep traffic paused
   until all instances use the target.
6. Smoke-test existing sessions, login, project load/save, OAuth credentials and
   refresh, device-code auth, and server registration. Resume traffic and jobs
   only after validation. Monitor database errors, pool saturation, and shared
   cluster capacity. Do not retire Supabase until the agreed rollback window ends.

## Vercel Cutover Notes

The old app is Vercel project `macrograph`
(`prj_0LLoTgSKwDezCaEGsGj1KkYLE9QP`) in scope `brendan-allans-projects`.
Its root directory is `apps/web`. The active production deployment recorded
during preparation is `dpl_FF9ykVfqjyAUv1YM3DJzd3x9huBR`; recheck it immediately
before cutover. `macrograph.app` redirects to `www.macrograph.app`. Also account
for the project's `macrograph.brendonovich.dev` and Vercel domain aliases.

Before cutover, the `DATABASE_URL` record targeted production and preview. It now
also targets development, as approved, with the same target URL in all three.
A Vercel secret update does not alter already built deployments. Rebuild the
recorded production deployment using current environment variables rather than
deploying an unrelated working tree.

Vercel's project pause endpoint pauses the active production deployment, not
every old/preview deployment or local client. The project has no configured
Vercel crons, and generated deployment URLs have SSO protection, but authenticated
team members can still access older deployments. Before the final snapshot,
confirm that **all** source writers are stopped and in-flight work has drained.
Coordinate source password rotation and stale pooler-session invalidation during
the maintenance window if needed to prevent old credentials from resuming writes;
do not indiscriminately terminate Supabase's internal service connections.

These operations were not performed during preparation; they were subsequently
approved and executed during cutover. The source password has already been
rotated. Use the cutover records and private phase reports as the current state.

## Rollback

Before target writes begin, restore the original `DATABASE_URL`, restart all old
app instances, and resume source writers. Leave the target intact for diagnosis.

After **any** target writes (including OAuth refreshes), the source is stale.
Pause all writers and reconcile changes before switching back; simply reverting
the URL can lose projects or revive invalid refresh tokens. Never allow both
databases to serve independent writers. Retain encrypted/restricted backups for
the rollback window and remove local dumps and credential exports according to
the agreed retention policy afterward.
