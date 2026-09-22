import { assert, it } from "@effect/vitest";
import { GraphExecution } from "@macrograph/workflow-runtime";
import { input, makeModules } from "@macrograph/workflow-runtime-test/fixture";
import { Effect } from "effect";

import { CloudflareRuntime } from "../src/index.ts";

it.effect("replays native durable node results without repeating side effects", () =>
  Effect.gen(function* () {
    let executions = 0;
    const modules = makeModules(() =>
      Effect.sync(() => {
        executions++;
      }),
    );
    const cache = new Map<string, unknown>();
    const task = CloudflareRuntime.makeTask({
      async do<A>(name: string, callback: () => Promise<A>): Promise<A> {
        if (cache.has(name)) return structuredClone(cache.get(name)) as A;
        const value = await callback();
        cache.set(name, structuredClone(value));
        return value;
      },
    });
    const payload = input("replay");
    const run = GraphExecution.run(payload.project, payload, {
      modules,
      executionEnvironment: CloudflareRuntime.makeExecutionEnvironment(task),
    });
    yield* run;
    yield* run;
    assert.equal(executions, 1);
    assert.equal(cache.size, 1);
    assert.match([...cache.keys()][0]!, /^runtime-node-v2\//);
  }),
);

it.effect("propagates native step failure instead of completing the graph", () =>
  Effect.gen(function* () {
    const payload = input("failure");
    const task = CloudflareRuntime.makeTask({
      do: async () => {
        throw new Error("Step failed");
      },
    });
    const exit = yield* Effect.exit(
      GraphExecution.run(payload.project, payload, {
        modules: makeModules(),
        executionEnvironment: CloudflareRuntime.makeExecutionEnvironment(task),
      }),
    );
    assert.equal(exit._tag, "Failure");
  }),
);

it.effect("persists node lifecycle transitions in separate steps, including failures", () =>
  Effect.gen(function* () {
    for (const value of ["durable", "fail"]) {
      const names: string[] = [];
      const states: CloudflareRuntime.NodeState[] = [];
      const task: CloudflareRuntime.Task = (name, effect) =>
        Effect.suspend(() => {
          names.push(name);
          return effect;
        });
      const payload = input(value, value);
      const exit = yield* Effect.exit(
        GraphExecution.run(payload.project, payload, {
          modules: makeModules(),
          executionEnvironment: CloudflareRuntime.makeExecutionEnvironment(task, {
            onNodeState: (_key, _name, state) =>
              Effect.sync(() => {
                states.push(state);
              }),
          }),
        }),
      );
      assert.equal(exit._tag, value === "durable" ? "Success" : "Failure");
      assert.deepEqual(
        states.map((state) => state.status),
        ["running", value === "durable" ? "complete" : "errored"],
      );
      assert.lengthOf(names, 3);
      assert.equal(names[0], `${names[1]}/trace-start`);
      assert.equal(
        names[2],
        `${names[1]}/${value === "durable" ? "trace-complete" : "trace-error"}`,
      );
      assert.equal(states[0]!.startedAt, states[1]!.startedAt);
      assert.isString(states[1]!.completedAt);
      if (value === "fail") assert.equal(states[1]!.error, "NodeExecutionError");
    }
  }),
);
