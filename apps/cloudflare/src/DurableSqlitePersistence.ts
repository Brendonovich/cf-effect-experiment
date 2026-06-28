import { DrizzleDriver, schema } from "@macrograph/persistence-sqlite";
import * as Cloudflare from "alchemy/Cloudflare";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { Effect, Layer } from "effect";

export const layer = (migrations: Record<string, string>) =>
	Layer.effect(
		DrizzleDriver.Service,
		Effect.gen(function* () {
			const state = yield* Cloudflare.DurableObjectState;
			const client = {
				sql: state.storage.sql.raw,
				transactionSync: <T>(callback: () => T) => callback(),
			};

			const driver = drizzle(client, { schema });
      yield* state.blockConcurrencyWhile(() =>
        Effect.sync(() => {
          migrate(driver, { migrations });
        }),
      );

      return DrizzleDriver.Service.of({ driver });
    }),
  );

export * as DurableSqlitePersistence from "./DurableSqlitePersistence.ts";
