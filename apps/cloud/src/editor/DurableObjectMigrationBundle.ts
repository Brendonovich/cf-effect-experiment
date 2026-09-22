import { type InputProps, Resource } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export interface MigrationBundleProps {
  readonly migrationsDir: string;
}

export interface MigrationBundleAttributes {
  readonly migrations: Record<string, string>;
}

type MigrationBundle = Resource<
  "MacroGraph.DurableObjectMigrationBundle.Bundle",
  MigrationBundleProps,
  MigrationBundleAttributes
>;

export interface MigrationBundleBindingClient {
  readonly migrations: Effect.Effect<Record<string, string>>;
}

const MigrationBundle = Resource<MigrationBundle>("MacroGraph.DurableObjectMigrationBundle.Bundle")(
  {
    bind: (bundle: MigrationBundle) =>
      Effect.gen(function* () {
        const worker = yield* Cloudflare.Worker;
        const env = yield* Cloudflare.WorkerEnvironment;
        yield* worker.bind`${bundle}`({
          bindings: [
            {
              type: "json",
              name: bundle.LogicalId,
              json: bundle.migrations,
            },
          ],
        });

        return {
          migrations: Effect.sync(() => {
            const migrations = (env as Record<string, unknown>)[bundle.LogicalId];
            if (isMigrationRecord(migrations)) return migrations;
            throw new Error(`Durable SQLite migrations binding '${bundle.LogicalId}' is missing`);
          }),
        } satisfies MigrationBundleBindingClient;
      }),
  },
);

export const bindMigrations = Effect.fnUntraced(function* (
  ...[name, props]: [string, InputProps<MigrationBundleProps>]
) {
  const { migrations } = yield* MigrationBundle.bind(yield* MigrationBundle(name, props));
  return migrations;
});

export const providers = () =>
  Provider.effect(
    MigrationBundle,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const resolve = (filePath: string) =>
        path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

      const readMigrationEntries = (migrationsDir: string) =>
        Effect.gen(function* () {
          const dir = resolve(migrationsDir);
          const exists = yield* fs.exists(dir);
          if (!exists) return [] as ReadonlyArray<readonly [string, string]>;

          const entries = yield* fs.readDirectory(dir);
          const migrations: Array<readonly [string, string]> = [];

          for (const name of entries.filter((entry) => /^\d+_/.test(entry)).sort()) {
            const migrationPath = path.join(dir, name, "migration.sql");
            const migrationExists = yield* fs.exists(migrationPath);
            if (!migrationExists) continue;

            const sql = yield* fs.readFileString(migrationPath);
            migrations.push([name, sql]);
          }

          return migrations;
        });

      const readMigrations = (props: MigrationBundleProps) =>
        Effect.gen(function* () {
          const entries = yield* readMigrationEntries(props.migrationsDir);
          return Object.fromEntries(entries);
        });

      return MigrationBundle.Provider.of({
        list: () => Effect.succeed([]),
        diff: Effect.fn(function* ({ news }) {
          if (!isResolved(news)) return undefined;
          return { action: "update" as const };
        }),
        read: Effect.fn(function* ({ olds, output }) {
          if (!output) return undefined;

          return {
            migrations: yield* readMigrations(olds),
          };
        }),
        reconcile: Effect.fn(function* ({ news, output, session }) {
          yield* session.note(`${output ? "Reading" : "Loading"} Durable Object SQLite migrations`);

          return {
            migrations: yield* readMigrations(news),
          };
        }),
        delete: Effect.fn(function* () {
          // Local migration files are source artifacts; there is no remote resource to delete.
        }),
      });
    }),
  );

const isMigrationRecord = (value: unknown): value is Record<string, string> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((migration) => typeof migration === "string");
};

export * as DurableObjectMigrationBundle from "./DurableObjectMigrationBundle.ts";
