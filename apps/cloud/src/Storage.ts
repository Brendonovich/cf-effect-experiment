import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Planetscale from "@alchemy.run/planetscale";
import * as PlanetscaleLogicalDb from "@macrograph/planetscale-logical-db";
import { adopt } from "alchemy/AdoptPolicy";
import * as Output from "alchemy/Output";
import { retain } from "alchemy/RemovalPolicy";
import { Effect } from "effect";

const pullRequest = process.env.PULL_REQUEST;
const previewLogicalDatabaseName =
  pullRequest !== undefined && /^\d+$/.test(pullRequest)
    ? `macrograph_pr_${pullRequest}`
    : undefined;

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
      ...(previewLogicalDatabaseName === undefined ? {} : { name: previewLogicalDatabaseName }),
      adminOrigin: adminRole.origin,
      appRoleName: Output.map(appRole.username, PlanetscaleLogicalDb.postgresRoleNameFromUsername),
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

// Retained read-only rollback source. Omitting appRoleName prevents future
// deployments from re-granting writes to the retired legacy runtime role.
export const LegacyLogicalDatabase = PlanetscaleLogicalDb.PostgresLogicalDatabase(
  "LegacyLogicalDatabase",
  Effect.gen(function* () {
    const adminRole = yield* DatabaseAdminRole;

    return {
      name: "macrograph_legacy",
      adminOrigin: adminRole.origin,
    };
  }),
).pipe(retain());

export const DatabaseHyperdrive = Cloudflare.Hyperdrive.Connection(
  "AppDatabaseHyperdrive",
  Effect.gen(function* () {
    const role = yield* DatabaseRole;
    const database = yield* LogicalDatabase;

    return {
      origin: Output.map(Output.all(role.origin, database.name), ([origin, name]) => ({
        ...origin,
        database: name,
      })),
      dev: Output.map(Output.all(role.pooledOrigin, database.name), ([origin, name]) => ({
        ...origin,
        database: name,
        sslmode: "verify-full" as const,
      })),
      mtls: { sslmode: "require" as const },
      caching: { disabled: true },
    };
  }),
);

export const DeploymentObjectsBucket = Cloudflare.R2.Bucket("RevisionSnapshots");

/**
 * Shared projects from the original website's playground. Production adopts and retains the
 * namespace the website has always used; other stages get their own.
 */
export const PlaygroundShares = (production: boolean) =>
  production
    ? Cloudflare.KV.Namespace("PlaygroundShares", { title: "macrograph-saved-shares" }).pipe(
        adopt(true),
        retain(),
      )
    : Cloudflare.KV.Namespace("PlaygroundShares");
