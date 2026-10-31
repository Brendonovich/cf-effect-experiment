import type * as SqlConnection from "effect/sql/SqlConnection";

import * as PgClient from "@effect/sql-pg/PgClient";
import { PGlite } from "@electric-sql/pglite";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Effect, Layer, Stream } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as SqlClient from "effect/sql/SqlClient";
import { readdirSync, readFileSync } from "node:fs";

import * as Database from "../src/database/Database.ts";

const migrationsDirectory = new URL("../migrations-postgres/", import.meta.url);

/** An in-memory Postgres with every migration applied, as the real database would have. */
export const make = Effect.acquireRelease(
  Effect.promise(async () => {
    const pg = new PGlite();
    await pg.waitReady;
    for (const migration of readdirSync(migrationsDirectory).sort())
      for (const statement of readFileSync(
        new URL(`${migration}/migration.sql`, migrationsDirectory),
        "utf8",
      ).split("--> statement-breakpoint"))
        if (statement.trim() !== "") await pg.exec(statement);
    return pg;
  }),
  (pg) => Effect.promise(() => pg.close()),
);

/** Provides `Database.Service` backed by the given PGlite instance. */
export const layer = (pg: PGlite) =>
  Layer.effect(Database.Service)(
    Effect.gen(function* () {
      const objects = (sql: string, params: ReadonlyArray<unknown>) =>
        Effect.promise(
          async () => (await pg.query<Record<string, unknown>>(sql, [...params])).rows,
        );
      const values = (sql: string, params: ReadonlyArray<unknown>) =>
        Effect.promise(
          async () =>
            (await pg.query<ReadonlyArray<unknown>>(sql, [...params], { rowMode: "array" })).rows,
        );
      const connection: SqlConnection.Connection = {
        execute: objects,
        executeRaw: objects,
        executeValues: values,
        executeUnprepared: objects,
        executeValuesUnprepared: values,
        executeStream: () => Stream.die("Unexpected SQL stream"),
      };
      const sql = yield* SqlClient.make({
        acquirer: Effect.succeed(connection),
        compiler: PgClient.makeCompiler(),
        spanAttributes: [],
      });
      const client: PgClient.PgClient = Object.assign(sql, {
        [PgClient.TypeId]: PgClient.TypeId,
        config: {},
        json: (value: unknown) => JSON.stringify(value),
        listen: () => Stream.die("Unexpected SQL listener"),
        notify: () => Effect.die("Unexpected SQL notify"),
      });
      return yield* PgDrizzle.makeWithDefaults().pipe(
        Effect.provideService(PgClient.PgClient, client),
      );
    }),
  ).pipe(Layer.provide(Reactivity.layer));

export * as PgliteDatabase from "./PgliteDatabase.ts";
