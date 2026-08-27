import { Config, Effect, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { RpcTest } from "effect/unstable/rpc";

import { ClientRpcs, CommandFailure, RuntimeRpcs, ShellEngine } from "./Definition.ts";

export const make = Effect.fnUntraced(function* (enabled = false) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return ShellEngine.of({
    resources: Layer.empty,
    rpcs: RuntimeRpcs.toLayer({
      ShellExecute: Effect.fnUntraced(function* ({ command }) {
        if (!enabled)
          return yield* new CommandFailure({
            reason:
              "Shell execution is disabled. Set MACROGRAPH_ENABLE_SHELL=true on the runtime host to enable it.",
          });
        if (command.trim() === "" || command.includes("\0"))
          return yield* new CommandFailure({ reason: "A valid command is required" });
        const code = yield* spawner
          .exitCode(
            ChildProcess.make(command, {
              shell: true,
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
              forceKillAfter: "2 seconds",
            }),
          )
          .pipe(
            Effect.mapError(
              () => new CommandFailure({ reason: "Unable to execute the shell command" }),
            ),
            Effect.timeoutOrElse({
              duration: "30 seconds",
              orElse: () =>
                new CommandFailure({ reason: "Shell command timed out after 30 seconds" }),
            }),
          );
        if (code !== 0)
          return yield* new CommandFailure({ reason: `Shell command exited with status ${code}` });
      }),
    }),
    client: { state: Effect.succeed({ enabled }), rpcs: ClientRpcs.toLayer({}) },
  });
});

export const layer = Layer.effect(ShellEngine)(
  Effect.gen(function* () {
    const enabled = yield* Config.boolean("MACROGRAPH_ENABLE_SHELL").pipe(
      Config.withDefault(false),
    );
    return yield* make(enabled);
  }),
);

export const makeRuntimeClient = Effect.fnUntraced(function* (enabled = false) {
  const engine = yield* make(enabled);
  return yield* RpcTest.makeClient(RuntimeRpcs).pipe(Effect.provide(engine.rpcs));
});

export default layer;
