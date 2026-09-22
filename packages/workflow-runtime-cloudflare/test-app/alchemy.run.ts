import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { localState } from "alchemy/State";
import { Effect } from "effect";

import worker from "./worker.ts";

export default Alchemy.Stack(
  "MacroGraphWorkflowCloudflareTest",
  {
    providers: Cloudflare.providers(),
    state: localState(),
  },
  Effect.gen(function* () {
    return { url: (yield* worker).url };
  }),
);
