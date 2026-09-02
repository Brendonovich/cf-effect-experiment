# Legacy Database Operations

The legacy web app uses the `macrograph_legacy` logical database on PlanetScale
organization/cluster `macrograph`, branch `main`. Development, preview, and
production share the same database. Development writes affect production data.

## Managed Resources

- `AppPostgresDatabase`: existing PostgreSQL 18.6 cluster.
- `LegacyLogicalDatabase`: fixed database name `macrograph_legacy` with retention.
- `LegacyDatabaseRuntimeRole`: dedicated application role with retention and no
  inherited admin roles. The production role supplies the shared web-app URL.
- `AppDatabaseAdminRole`: provisioning and schema-migration credentials.

The old web app owns its schema. Do not run the new cloud app's migrations against
this database. Use admin credentials for Drizzle schema changes; runtime
credentials provide application reads/writes, not schema administration.
The new cloud app's logical databases and runtime roles remain separate.

## Deployment

Vercel project `macrograph` (`prj_0LLoTgSKwDezCaEGsGj1KkYLE9QP`) belongs to scope
`brendan-allans-projects`. Its `DATABASE_URL` targets production, preview, and
development and uses the PlanetScale pooled endpoint on port 6432 with verified
TLS. The old driver already uses `prepare: false`.

The credential-cleanup deployment is `dpl_DSuVmo2B7rhKXXZN9B2qYTsB1bZc`, available
at `macrograph-gk9q8993q-brendan-allans-projects.vercel.app`. It was rebuilt from
the unchanged production source and promoted after authentication, user and
credentials API, and account-page smoke checks. Public authenticated checks on
`www.macrograph.app` also passed. Synthetic test records were removed.

All 13 retired Supabase/Postgres integration variables were removed from the
project. The active deployment was verified to contain none of those variables.
The orphaned integration configuration no longer exists. No project pause or
maintenance firewall was needed for credential cleanup.

## Native Connections

Private connection information is under `.alchemy/legacy-migration/`, which is
gitignored and permission-restricted. Never print or commit `target-database-url`
or `pgpass`.

```sh
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
export PGSERVICEFILE="$PWD/.alchemy/legacy-migration/pg_service.conf"
PGSERVICE=macrograph_legacy_runtime_pooled psql -X -c 'SELECT current_database();'
```

Available services are `macrograph_legacy_admin`, `macrograph_legacy_runtime`,
and `macrograph_legacy_runtime_pooled`. All verify TLS. The pooler rejects
`statement_timeout` as a startup parameter; use a client-side timeout or
`SET LOCAL` inside a transaction.

## Backups

The migration's final archive contains all eight app tables, enum values,
indexes/constraints, and three serial sequences. Schema, row counts, data
checksums, and sequence states were validated before release. Do not restore
an archive directly into the populated live database.

The logical database uses `C` collation/ctype rather than the former database's
`C.UTF-8`. No locale-sensitive SQL was found in the app; check non-ASCII case
conversion or character classification if future consumers depend on them.

The private backup directory is
`~/.local/share/macrograph/legacy-db-cutover-20260829-CMNDmk/`. Data archives,
manifests, and validation records were preserved during credential cleanup.
The archive is not encrypted or off-site; directories are `0700` and files
are `0600`. Arrange an encrypted off-site backup separately.

Source password exports, their backup copy, the original source environment
export, source passfile/service entries, the source CA certificate, and obsolete
source migration scripts were removed. The local Supabase CLI credential was
removed from macOS Keychain; no fallback credential or access-token environment
variable was present. Known obsolete password occurrences in the OpenCode text
log were redacted without truncating unrelated logs.

## Retained History

Historical Vercel deployments were explicitly retained at the user's request.
They retain their original credential snapshots. Promoting an old version can
reintroduce retired credentials; pre-migration versions also use an invalid
source password. Prefer a fresh staged build of the desired source against
current project variables instead of a one-click historical rollback.

The obsolete password also remains in OpenCode's active conversation database.
That database was not modified: complete redaction of user messages, retained
events, and SQLite/WAL remnants requires separate offline maintenance once
active sessions have stopped. Text-log redaction cannot guarantee that active
history will not be logged again. Provider retention, snapshots, and remote
logs are not covered by local file deletion.

The former database was not deleted. Its app writes remain blocked. Recovering
access would require fresh owner authentication/password reset; the exported
current source credentials have been deleted. Reconcile any real writes accepted
by PlanetScale before considering a source rollback.

Cleanup reports and smoke-test results are under
`.alchemy/legacy-migration/cleanup/`. Real-password login and third-party OAuth
refresh/consent with a real user's credentials were not exercised.
