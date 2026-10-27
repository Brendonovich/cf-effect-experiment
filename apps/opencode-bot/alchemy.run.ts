import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Alchemy from "alchemy";
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
