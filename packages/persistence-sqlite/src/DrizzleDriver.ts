import type { EmptyRelations } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { PersistenceError } from "@macrograph/persistence";
import { drizzle as nodeDrizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { Context, Effect, Layer } from "effect";

import * as schema from "./schema.ts";

export type DbDriver = BaseSQLiteDatabase<"sync", unknown, typeof schema, EmptyRelations>;
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
      const driver = yield* Effect.sync(() => {
        const db = nodeDrizzle(dbPath, { schema });
        migrate(db, { migrationsFolder });
        return db;
      }).pipe(PersistenceError.refail);

      return Service.of({ driver });
    }),
  );

export * as DrizzleDriver from "./DrizzleDriver.ts";
