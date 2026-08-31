import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { DeploymentObjectKey } from "../src/deployment/DeploymentObjectKey.ts";
import * as Protocol from "../src/execution/FunctionQueueProtocol.ts";
import * as Scheduler from "../src/execution/ProjectFunctionQueues.ts";

const scope: Protocol.Scope = {
  projectId: "project",
  deploymentId: "deployment",
  r2Key: DeploymentObjectKey.make("projects/project/deployments/deployment.json"),
};
const work = (id: string, overrides: Partial<Protocol.Work> = {}): Protocol.Work => ({
  ...scope,
  id,
  queueId: "queue",
  functionId: "function",
  values: { value: id },
  queueLineage: [],
  executionPath: id,
  ...overrides,
});

const setup = Effect.gen(function* () {
  let stored: unknown;
  const deliveries: Protocol.Delivery[] = [];
  const starts: string[] = [];
  const statuses = new Map<string, Protocol.WorkflowStatus>();
  let failSend = false;
  let failCreate = false;
  const host: Scheduler.Host = {
    load: Effect.sync(() => structuredClone(stored)),
    save: (metadata) =>
      Effect.sync(() => {
        stored = structuredClone(metadata);
      }),
    wake: Effect.void,
    sleep: Effect.void,
    send: (delivery) =>
      Effect.sync(() => {
        if (failSend) throw new Error("transport down");
        deliveries.push(structuredClone(delivery));
      }),
    workflows: {
      create: async ({ id }) => {
        if (failCreate) throw new Error("create down");
        if (statuses.has(id)) throw new Error("duplicate Workflow");
        starts.push(id);
        statuses.set(id, { status: "running" });
      },
      get: async (id) => {
        if (!statuses.has(id)) throw new Error("Workflow not found");
        return {
          status: async () => statuses.get(id)!,
          terminate: async () => {
            statuses.set(id, { status: "terminated" });
          },
        };
      },
    },
  };
  const scheduler = yield* Scheduler.make(host);
  yield* scheduler.configure(scope, ["queue"]);
  return {
    scheduler,
    host,
    deliveries,
    starts,
    statuses,
    failSend: () => {
      failSend = true;
    },
    failCreate: () => {
      failCreate = true;
    },
    stored: () => stored,
  };
});

describe("Cloud function queue transport", () => {
  it.effect(
    "DO admission preserves FIFO despite reordered and duplicate transport deliveries",
    () =>
      Effect.gen(function* () {
        const { scheduler, starts, statuses } = yield* setup;
        yield* scheduler.enqueue(work("a"));
        yield* scheduler.enqueue(work("b"));
        yield* scheduler.deliver(work("b"));
        assert.deepStrictEqual(starts, []);
        yield* scheduler.deliver(work("a"));
        yield* scheduler.deliver(work("a"));
        yield* scheduler.deliver(work("b"));
        assert.deepStrictEqual(starts, ["a"]);
        statuses.set("a", { status: "complete", output: { ok: true, values: { value: 1 } } });
        yield* scheduler.reconcile;
        yield* scheduler.deliver(work("b"));
        assert.deepStrictEqual(starts, ["a", "b"]);
        yield* scheduler.enqueue(work("a"));
        assert.deepStrictEqual(
          (yield* scheduler.snapshot(scope))[0]?.running.map((item) => item.id),
          ["b"],
        );
      }),
  );

  it.effect("Advance overlaps once, then waits for every overlap; pause never interrupts", () =>
    Effect.gen(function* () {
      const { scheduler, starts, statuses } = yield* setup;
      for (const id of ["a", "b", "c"]) yield* scheduler.enqueue(work(id));
      yield* scheduler.deliver(work("a"));
      yield* scheduler.advance(scope, "queue");
      yield* scheduler.deliver(work("b"));
      statuses.set("b", { status: "errored" });
      yield* scheduler.reconcile;
      yield* scheduler.deliver(work("c"));
      assert.deepStrictEqual(starts, ["a", "b"]);
      yield* scheduler.pause(scope, "queue", true);
      assert.strictEqual(statuses.get("a")?.status, "running");
      statuses.set("a", { status: "complete" });
      yield* scheduler.reconcile;
      yield* scheduler.deliver(work("c"));
      assert.deepStrictEqual(starts, ["a", "b"]);
      yield* scheduler.pause(scope, "queue", false);
      yield* scheduler.deliver(work("c"));
      assert.deepStrictEqual(starts, ["a", "b", "c"]);
    }),
  );

  it.effect("restores live scheduling metadata without storing Workflow outputs", () =>
    Effect.gen(function* () {
      const { scheduler, host, starts, statuses, stored } = yield* setup;
      yield* scheduler.enqueue(work("a"));
      yield* scheduler.enqueue(work("b"));
      yield* scheduler.deliver(work("a"));
      const restored = yield* Scheduler.make(host);
      yield* restored.deliver(work("b"));
      assert.deepStrictEqual(starts, ["a"]);
      statuses.set("a", { status: "complete", output: { secretResult: "never-store-me" } });
      yield* restored.reconcile;
      assert.notInclude(JSON.stringify(stored()), "never-store-me");
      yield* restored.deliver(work("b"));
      assert.deepStrictEqual(starts, ["a", "b"]);
    }),
  );

  it.effect("rejects lineage cycles and isolates deployments", () =>
    Effect.gen(function* () {
      const { scheduler, starts } = yield* setup;
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(scheduler.enqueue(work("cycle", { queueLineage: ["queue"] }))),
        ),
      );
      const other = { ...scope, deploymentId: "other" };
      yield* scheduler.configure(other, ["queue"]);
      yield* scheduler.enqueue(work("a"));
      yield* scheduler.enqueue(work("b", other));
      yield* scheduler.deliver(work("a"));
      yield* scheduler.deliver(work("b", other));
      assert.deepStrictEqual(starts, ["a", "b"]);
    }),
  );

  it.effect(
    "remove and clear expose failure and prevent late messages from resurrecting work",
    () =>
      Effect.gen(function* () {
        const { scheduler, starts, statuses } = yield* setup;
        yield* scheduler.enqueue(work("a"));
        yield* scheduler.enqueue(work("b"));
        yield* scheduler.deliver(work("a"));
        yield* scheduler.remove(scope, "queue", "b");
        assert.deepStrictEqual(yield* scheduler.inspect(work("b")), { state: "absent" });
        yield* scheduler.deliver(work("b"));
        yield* scheduler.clear(scope, "queue");
        assert.strictEqual(statuses.get("a")?.status, "terminated");
        yield* scheduler.reconcile;
        yield* scheduler.enqueue(work("c"));
        yield* scheduler.deliver(work("c"));
        assert.deepStrictEqual(starts, ["a", "c"]);
      }),
  );

  it.effect("bounded dispatch failures release the head and can fail an awaiting caller", () =>
    Effect.gen(function* () {
      const { scheduler, failCreate } = yield* setup;
      yield* scheduler.enqueue(work("a"));
      yield* scheduler.enqueue(work("b"));
      failCreate();
      for (let attempt = 0; attempt < 5; attempt++)
        yield* Effect.exit(scheduler.deliver(work("a")));
      assert.propertyVal(
        yield* scheduler.inspect(work("a")),
        "error",
        "Function Workflow dispatch failed",
      );
      yield* scheduler.reconcile;
      assert.deepStrictEqual(yield* scheduler.inspect(work("a")), { state: "absent" });
      assert.propertyVal(yield* scheduler.inspect(work("b")), "state", "dispatching");
    }),
  );

  it.effect("pause gates an already dispatched message and transport contains identity only", () =>
    Effect.gen(function* () {
      const { scheduler, starts, deliveries } = yield* setup;
      yield* scheduler.enqueue(work("a"));
      assert.deepStrictEqual(Object.keys(deliveries[0]!).sort(), [
        "deploymentId",
        "id",
        "projectId",
        "queueId",
        "r2Key",
      ]);
      yield* scheduler.pause(scope, "queue", true);
      yield* scheduler.deliver(work("a"));
      assert.deepStrictEqual(starts, []);
      assert.isTrue(Exit.isFailure(yield* Effect.exit(scheduler.advance(scope, "queue"))));
      yield* scheduler.pause(scope, "queue", false);
      yield* scheduler.deliver(work("a"));
      assert.deepStrictEqual(starts, ["a"]);
    }),
  );

  it.effect("transport failure retries remain bounded and release blocked work", () =>
    Effect.gen(function* () {
      const { scheduler, failSend } = yield* setup;
      failSend();
      yield* scheduler.enqueue(work("a"));
      for (let attempt = 0; attempt < 4; attempt++) yield* scheduler.reconcile;
      assert.propertyVal(
        yield* scheduler.inspect(work("a")),
        "error",
        "Function queue transport failed",
      );
      yield* scheduler.reconcile;
      assert.deepStrictEqual(yield* scheduler.inspect(work("a")), { state: "absent" });
    }),
  );

  it("stable Workflow IDs include project, deployment, parent and execution path", async () => {
    assert.strictEqual(
      await Protocol.workId(scope, "parent", "path"),
      await Protocol.workId(scope, "parent", "path"),
    );
    assert.notStrictEqual(
      await Protocol.workId(scope, "parent", "path"),
      await Protocol.workId({ ...scope, deploymentId: "other" }, "parent", "path"),
    );
    assert.match(await Protocol.workId(scope, "parent", "path"), /^fq-[a-f0-9]{64}$/);
  });
});
