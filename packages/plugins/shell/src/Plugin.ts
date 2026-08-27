import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import { ShellEngine } from "./Definition.ts";

const ShellPlugin = Plugin.make({
  id: "shell",
  name: "Shell",
  engine: ShellEngine,
  effect: (context) =>
    context.schema.register({
      id: "ExecuteShellCommand",
      name: "Execute Shell Command",
      description:
        "Executes a trusted command on the runtime host. Requires MACROGRAPH_ENABLE_SHELL=true.",
      io: (io) => ({ command: io.data.in("command", DataType.String, { name: "Command" }) }),
      run: ({ io, engine }) => engine.ShellExecute({ command: io.command }).pipe(Effect.asVoid),
    }),
});

export default ShellPlugin;
