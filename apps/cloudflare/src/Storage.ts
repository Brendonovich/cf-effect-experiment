import * as PlanetscaleLogicalDb from "@macrograph/planetscale-logical-db";
import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Planetscale from "alchemy/Planetscale";
import { retain } from "alchemy/RemovalPolicy";
import { Effect } from "effect";

export const Database = Planetscale.PostgresDatabase("AppPostgresDatabase", {
	name: "macrograph",
	clusterSize: "PS_5",
	region: { slug: "aws-ap-southeast-2" },
	replicas: 0,
}).pipe(adopt(true), retain());

const DatabaseAdminRole = Planetscale.PostgresRole(
	"AppDatabaseAdminRole",
	Database.pipe(
		Effect.map((database) => ({
			database,
			inheritedRoles: ["postgres"],
			successor: "postgres",
		})),
	),
);

export const DatabaseRole = Planetscale.PostgresRole(
	"AppDatabaseRuntimeRole",
	Database.pipe(
		Effect.map((database) => ({
			database,
			inheritedRoles: [],
			successor: "postgres",
		})),
	),
);

const LogicalDatabase = PlanetscaleLogicalDb.PostgresLogicalDatabase(
	"AppLogicalDatabase",
	Effect.gen(function* () {
		const adminRole = yield* DatabaseAdminRole;
		const appRole = yield* DatabaseRole;

		return {
			adminOrigin: adminRole.origin,
			appRoleName: Output.map(
				appRole.username,
				PlanetscaleLogicalDb.postgresRoleNameFromUsername,
			),
			migrationsDir: "./migrations-postgres",
		};
	}),
);

export const LegacyDatabaseRole = Planetscale.PostgresRole(
	"LegacyDatabaseRuntimeRole",
	Database.pipe(
		Effect.map((database) => ({
			database,
			inheritedRoles: [],
			successor: "postgres",
		})),
	),
).pipe(retain());

// Dev and prod intentionally share this database; the old web app owns its schema.
export const LegacyLogicalDatabase = PlanetscaleLogicalDb.PostgresLogicalDatabase(
	"LegacyLogicalDatabase",
	Effect.gen(function* () {
		const adminRole = yield* DatabaseAdminRole;
		const appRole = yield* LegacyDatabaseRole;

		return {
			name: "macrograph_legacy",
			adminOrigin: adminRole.origin,
			appRoleName: Output.map(
				appRole.username,
				PlanetscaleLogicalDb.postgresRoleNameFromUsername,
			),
		};
	}),
).pipe(retain());

export const DatabaseHyperdrive = Cloudflare.Hyperdrive.Connection(
	"AppDatabaseHyperdrive",
	Effect.gen(function* () {
		const role = yield* DatabaseRole;
		const database = yield* LogicalDatabase;

		return {
			origin: Output.map(
				Output.all(role.origin, database.name),
				([origin, name]) => ({
					...origin,
					database: name,
				}),
			),
			dev: Output.map(
				Output.all(role.pooledOrigin, database.name),
				([origin, name]) => ({
					...origin,
					database: name,
					sslmode: "verify-full" as const,
				}),
			),
			mtls: { sslmode: "require" as const },
			caching: { disabled: true },
		};
	}),
);

export const DeploymentSnapshotsBucket =
	Cloudflare.R2.Bucket("RevisionSnapshots");
