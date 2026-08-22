import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Drizzle from "alchemy/Drizzle";
import * as Output from "alchemy/Output";
import * as Planetscale from "alchemy/Planetscale";
import { Layer } from "effect";
import * as Effect from "effect/Effect";

import { AppDatabaseHyperdrive, RevisionSnapshots } from "./src/AppStorage.ts";
import { DurableObjectMigrationBundle } from "./src/DurableObjectMigrationBundle.ts";
import AppWorkerLayer, { AppWorker, WebAssetsDirectory } from "./src/Worker.ts";

export default Alchemy.Stack(
  "Macrograph",
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      Drizzle.providers(),
      Planetscale.providers(),
      DurableObjectMigrationBundle.providers(),
    ),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const ctx = yield* Alchemy.AlchemyContext;
    yield* AppDatabaseHyperdrive;
    yield* RevisionSnapshots;

    const playgroundDev = ctx.dev
      ? yield* Command.Dev("WebAppDevServer", {
          command: "bun dev-tunnel.ts",
        })
      : undefined;

    const playgroundBuild = !ctx.dev
      ? yield* Command.Build("WebAppBuild", {
          command: "pnpm run build",
          cwd: "../playground",
          outdir: "dist",
        })
      : undefined;

    const appWorker = yield* AppWorker.pipe(
      Effect.provide(AppWorkerLayer),
      Effect.provideService(WebAssetsDirectory, playgroundBuild?.outdir),
    );
    const playgroundUrl = playgroundDev
      ? Output.map(playgroundDev.url, (url) => {
          if (!url) return undefined;
          const parsed = new URL(url);
          parsed.hostname = "0.0.0.0";
          return parsed.href;
        })
      : undefined;

    return {
      url: playgroundUrl ?? appWorker.url,
      ...(!ctx.dev && { publicWorkerUrl: appWorker.url }),
    };
  }),
);
