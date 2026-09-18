import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import { Effect, Layer } from "effect";

import WorkerLayer, { AutofixWorker } from "./src/worker.ts";

export default Alchemy.Stack(
  "MacroGraphOpenCodeBot",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* AutofixWorker.pipe(Effect.provide(WorkerLayer));
    return { url: worker.url };
  }),
);
