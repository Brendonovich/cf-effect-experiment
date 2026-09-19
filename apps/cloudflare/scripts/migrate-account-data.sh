#!/usr/bin/env bash
set -euo pipefail

if [[ "${MIGRATION_CONFIRM:-}" != "writers-paused" ]]; then
	echo "Refusing to copy account data while writers may be active."
	echo "Pause the old app and Cloud credential writes, then set MIGRATION_CONFIRM=writers-paused."
	exit 1
fi

source_service="${LEGACY_AUTH_SOURCE_SERVICE:-macrograph_legacy_admin}"
target_service="${LEGACY_AUTH_TARGET_SERVICE:-macrograph_app_admin}"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/macrograph-account-cutover.XXXXXX")"
archive="$workdir/account-data.dump"
trap 'rm -rf "$workdir"' EXIT

for command in psql pg_dump pg_restore; do
	command -v "$command" >/dev/null || {
		echo "$command is required"
		exit 1
	}
done

tables=(
	user
	session
	oauth_credential
	device_code_sessions
	oauth_sessions
	oauth_apps
	server_registration_sessions
)

target_rows="$(
	PGSERVICE="$target_service" psql -X -v ON_ERROR_STOP=1 -Atc '
		SELECT
			(SELECT count(*) FROM "user") +
			(SELECT count(*) FROM "session") +
			(SELECT count(*) FROM oauth_credential) +
			(SELECT count(*) FROM device_code_sessions) +
			(SELECT count(*) FROM oauth_sessions) +
			(SELECT count(*) FROM oauth_apps) +
			(SELECT count(*) FROM server_registration_sessions)
	'
)"

if [[ "$target_rows" != "0" ]]; then
	echo "Target account tables are not empty; refusing to merge or overwrite data."
	exit 1
fi

dump_args=(
	--format=custom
	--data-only
	--no-owner
	--no-acl
	--file="$archive"
)
for table in "${tables[@]}"; do
	dump_args+=(--table="public.$table")
done

PGSERVICE="$source_service" pg_dump "${dump_args[@]}"
PGSERVICE="$target_service" pg_restore \
	--data-only \
	--no-owner \
	--no-acl \
	--single-transaction \
	--exit-on-error \
	--dbname="service=$target_service" \
	"$archive"

PGSERVICE="$target_service" psql -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT setval(
	pg_get_serial_sequence('oauth_sessions', 'id'),
	COALESCE((SELECT max(id) FROM oauth_sessions), 1),
	EXISTS (SELECT 1 FROM oauth_sessions)
);
SELECT setval(
	pg_get_serial_sequence('oauth_apps', 'pk'),
	COALESCE((SELECT max(pk) FROM oauth_apps), 1),
	EXISTS (SELECT 1 FROM oauth_apps)
);
SQL

source_counts="$(
	PGSERVICE="$source_service" psql -X -v ON_ERROR_STOP=1 -Atc '
		SELECT json_build_array(
			(SELECT count(*) FROM "user"),
			(SELECT count(*) FROM "session"),
			(SELECT count(*) FROM oauth_credential),
			(SELECT count(*) FROM device_code_sessions),
			(SELECT count(*) FROM oauth_sessions),
			(SELECT count(*) FROM oauth_apps),
			(SELECT count(*) FROM server_registration_sessions)
		)::text
	'
)"
target_counts="$(
	PGSERVICE="$target_service" psql -X -v ON_ERROR_STOP=1 -Atc '
		SELECT json_build_array(
			(SELECT count(*) FROM "user"),
			(SELECT count(*) FROM "session"),
			(SELECT count(*) FROM oauth_credential),
			(SELECT count(*) FROM device_code_sessions),
			(SELECT count(*) FROM oauth_sessions),
			(SELECT count(*) FROM oauth_apps),
			(SELECT count(*) FROM server_registration_sessions)
		)::text
	'
)"

if [[ "$source_counts" != "$target_counts" ]]; then
	echo "Row-count validation failed. Source: $source_counts Target: $target_counts"
	exit 1
fi

echo "Account data copied and row counts verified: $target_counts"
echo "Update the old app DATABASE_URL to the primary Cloud database before resuming writers."
