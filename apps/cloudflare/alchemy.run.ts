import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Drizzle from "alchemy/Drizzle";
import * as Output from "alchemy/Output";
import { Layer } from "effect";
import * as Effect from "effect/Effect";

import { DrizzleMigrationBundle } from "./src/DrizzleMigrationBundle.ts";
import MainWorkerLayer, { MainWorker, AssetsDir } from "./src/MainWorker.ts";

export default Alchemy.Stack(
  "Cloudflare",
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      Drizzle.providers(),
      DrizzleMigrationBundle.providers(),
    ),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const ctx = yield* Alchemy.AlchemyContext;

    const playgroundDev = ctx.dev
      ? yield* Command.Dev("PlaygroundDev", {
          command: "pnpm exec vite --host 0.0.0.0",
          cwd: "../playground",
          env: { VITE_WORKER_URL: "http://localhost:1337" },
        })
      : undefined;

    const playgroundBuild = !ctx.dev
      ? yield* Command.Build("PlaygroundBuild", {
          command: "pnpm run build",
          cwd: "../playground",
          outdir: "dist",
        })
      : undefined;

    const worker = yield* MainWorker.pipe(
      Effect.provide(MainWorkerLayer),
      Effect.provideService(AssetsDir, playgroundBuild?.outdir),
    );

    const playgroundUrl = playgroundDev
      ? Output.map(playgroundDev.url, (url) => {
          if (!url) return undefined;
          const parsed = new URL(url);
          parsed.hostname = "0.0.0.0";
          return parsed.href;
        })
      : undefined;

    return { url: playgroundUrl ?? worker.url };
  }),
);
