import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";

import { PersistenceError } from "@macrograph/persistence";
import { Context, Effect, Layer } from "effect";

export type DbDriver = NodeSQLiteDatabase;
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
      const driver = yield* Effect.sync(() => {
        const db = nodeDrizzle.drizzle(dbPath);
        migrator.migrate(db, { migrationsFolder });
        return db;
      }).pipe(PersistenceError.refail);

      return Service.of({ driver });
    }),
  );

export * as DrizzleDriver from "./DrizzleDriver.ts";
