import type { Registry as ModuleRegistry } from "@macrograph/project-host/ExecutorModules";

import { assert, it } from "@effect/vitest";
import { Project } from "@macrograph/core";
import { Executor } from "@macrograph/execution";
import { Effect } from "effect";

import { run } from "../src/GraphExecution.ts";

it.effect("runs an event through the app-provided executor catalog", () =>
  Effect.gen(function* () {
    let registered = false;
    let handled = false;
    const modules: ModuleRegistry = {
      entries: [],
      register: () => Effect.sync(() => void (registered = true)),
      handle: (_executor, moduleId, event) =>
        Effect.sync(() => {
          assert.strictEqual(moduleId, "module");
          assert.deepStrictEqual(event, { _tag: "Event" });
          handled = true;
        }),
    };
    yield* run(
      Project.empty(),
      {
        projectId: "project",
        moduleId: "module",
        event: { _tag: "Event" },
      },
      {
        executionEnvironment: Executor.inProcessExecution((key, executor) =>
          executor.executeNode(key),
        ),
        modules,
      },
    );
    assert.isTrue(registered);
    assert.isTrue(handled);
  }),
);
