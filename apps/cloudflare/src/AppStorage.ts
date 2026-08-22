import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Planetscale from "alchemy/Planetscale";
import { Effect } from "effect";

export const AppDatabase = Planetscale.PostgresDatabase("AppPostgresDatabase", {
  clusterSize: "PS_5",
  region: { slug: "aws-ap-southeast-2" },
  replicas: 0,
  migrationsDir: "./migrations-postgres",
});

export const AppDatabaseRole = Planetscale.PostgresRole(
  "AppDatabaseRuntimeRole",
  AppDatabase.pipe(
    Effect.map((database) => ({
      database,
      inheritedRoles: ["pg_read_all_data", "pg_write_all_data"],
    })),
  ),
);

export const AppDatabaseHyperdrive = Cloudflare.Hyperdrive.Connection(
  "AppDatabaseHyperdrive",
  AppDatabaseRole.pipe(
    Effect.map((role) => ({
      origin: role.origin,
      dev: Output.map(role.pooledOrigin, (origin) => ({
        ...origin,
        sslmode: "verify-full" as const,
      })),
      mtls: { sslmode: "require" as const },
      caching: { disabled: true },
    })),
  ),
);

export const RevisionSnapshots = Cloudflare.R2.Bucket("RevisionSnapshots");

export const revisionObjectKey = (projectId: string, revisionId: string) =>
  `projects/${projectId}/revisions/${revisionId}.json`;
