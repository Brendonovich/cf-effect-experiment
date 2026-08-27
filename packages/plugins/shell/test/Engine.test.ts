import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { ChildProcessSpawner, type ChildProcess } from "effect/unstable/process";

import { makeRuntimeClient } from "../src/Engine.ts";
import plugin from "../src/Plugin.ts";

describe("Shell", () => {
  it.effect("is disabled by default without executing a command", () =>
    Effect.gen(function* () {
      let calls = 0;
      const rpc = yield* makeRuntimeClient().pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, {
          ...ChildProcessSpawner.make(() => Effect.die("unused")),
          exitCode: () =>
            Effect.sync(() => {
              calls++;
              return ChildProcessSpawner.ExitCode(0);
            }),
        }),
      );
      const result = yield* Effect.result(rpc.ShellExecute({ command: "exit 0" }));
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result))
        assert.include(result.failure.reason, "MACROGRAPH_ENABLE_SHELL=true");
      assert.strictEqual(calls, 0);
      assert.deepStrictEqual(
        (yield* Registration.collect(plugin.effect)).map((schema) => schema.id),
        ["ExecuteShellCommand"],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("waits for command completion and reports nonzero exit", () =>
    Effect.gen(function* () {
      const rpc = yield* makeRuntimeClient(true);
      yield* rpc.ShellExecute({ command: "exit 0" });
      const failure = yield* Effect.result(rpc.ShellExecute({ command: "exit 7" }));
      assert.isTrue(Result.isFailure(failure));
      if (Result.isFailure(failure))
        assert.strictEqual(failure.failure.reason, "Shell command exited with status 7");
      for (const command of ["", "  ", "invalid\0command"])
        assert.isTrue(Result.isFailure(yield* Effect.result(rpc.ShellExecute({ command }))));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("bounds execution time and interrupts the running command", () =>
    Effect.gen(function* () {
      let interrupted = false;
      let command: ChildProcess.Command | undefined;
      const rpc = yield* makeRuntimeClient(true).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, {
          ...ChildProcessSpawner.make(() => Effect.die("unused")),
          exitCode: (input) => {
            command = input;
            return Effect.never.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            );
          },
        }),
      );
      const fiber = yield* rpc
        .ShellExecute({ command: "long-running-command" })
        .pipe(Effect.result, Effect.forkChild);
      yield* TestClock.adjust("31 seconds");
      const result = yield* Fiber.join(fiber);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.include(result.failure.reason, "timed out");
      assert.isTrue(interrupted);
      assert.strictEqual(command?._tag, "StandardCommand");
      if (command?._tag === "StandardCommand") {
        assert.strictEqual(command.options.shell, true);
        assert.strictEqual(command.options.stdout, "ignore");
        assert.strictEqual(command.options.forceKillAfter, "2 seconds");
      }
    }).pipe(Effect.scoped),
  );
});
