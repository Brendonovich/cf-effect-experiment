import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle/Postgres";
import { Context, Effect, Layer } from "effect";

export class Service extends Context.Service<
  Service,
  Effect.Success<ReturnType<typeof Drizzle.Postgres>>
>()("macrograph/cloudflare/Database") {}

export const layer = (databaseResource: Cloudflare.Hyperdrive.Connection) =>
  Layer.effect(Service)(
    Effect.gen(function* () {
      const hyperdrive = yield* Cloudflare.Hyperdrive.Connect(databaseResource);
      return yield* Drizzle.Postgres(hyperdrive.connectionString);
    }),
  );
