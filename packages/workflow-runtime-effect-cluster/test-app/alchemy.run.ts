import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import { localState } from "alchemy/State";
import { Effect } from "effect";

export default Alchemy.Stack(
  "MacroGraphWorkflowClusterTest",
  {
    providers: Command.providers(),
    state: localState(),
  },
  Effect.gen(function* () {
    const server = yield* Command.Dev("Cluster", { command: "bun server.ts" });
    return { url: server.url };
  }),
);
