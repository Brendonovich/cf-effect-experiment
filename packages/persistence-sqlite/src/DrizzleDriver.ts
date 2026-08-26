import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import { PersistenceError } from "@macrograph/persistence";
import { Context, Effect, Layer } from "effect";

export type DbDriver = NodeSQLiteDatabase;

/** Provides the managed Drizzle SQLite database driver. */
export class Service extends Context.Service<
  Service,
  {
    readonly driver: DbDriver;
  }
>()("macrograph/DrizzleDriver") {}

export const layerNodeSqlite = (dbPath: string, migrationsFolder: string) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const nodeDrizzle = yield* Effect.promise(() => import("drizzle-orm/node-sqlite"));
      const migrator = yield* Effect.promise(() => import("drizzle-orm/node-sqlite/migrator"));
      const driver = yield* Effect.acquireRelease(
        Effect.sync(() => nodeDrizzle.drizzle(dbPath)).pipe(PersistenceError.refail),
        (db) => Effect.sync(() => db.$client.close()),
      );
      yield* Effect.sync(() => migrator.migrate(driver, { migrationsFolder })).pipe(
        PersistenceError.refail,
      );

      return Service.of({ driver });
    }),
  );

export * as DrizzleDriver from "./DrizzleDriver.ts";
