import { type InputProps, Resource } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

export interface BundleProps {
	readonly migrationsDir: string;
}

export interface BundleAttributes {
	readonly migrations: Record<string, string>;
}

type Bundle = Resource<
	"Macrograph.DrizzleMigrationBundle.Bundle",
	BundleProps,
	BundleAttributes
>;

export interface BundleBindingClient {
	readonly migrations: Effect.Effect<Record<string, string>>;
}

const Bundle = Resource<Bundle>("Macrograph.DrizzleMigrationBundle.Bundle")({
	bind: (bundle: Bundle) =>
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
			} satisfies BundleBindingClient;
		}),
});

export const bindBundle = Effect.fnUntraced(function* (...[name, props]: [string, InputProps<BundleProps>]) {
	const { migrations } = yield* Bundle.bind(yield* Bundle(name, props));
	return migrations
})

export const providers = () =>
	Provider.effect(
		Bundle,
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

			const readMigrations = (props: BundleProps) =>
				Effect.gen(function* () {
					const entries = yield* readMigrationEntries(props.migrationsDir);
					return Object.fromEntries(entries);
				});

			return Bundle.Provider.of({
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

export * as DrizzleMigrationBundle from "./DrizzleMigrationBundle.ts";
