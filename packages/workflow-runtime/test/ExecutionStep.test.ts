import { assert, describe, it } from "@effect/vitest";

import { nodeStepName } from "../src/ExecutionStep.ts";

describe("ExecutionStep", () => {
  it("creates a stable encoded name from the node identity independently of replay policy", () => {
    for (const replay of ["unsafe", "safe"] as const)
      assert.strictEqual(
        nodeStepName({
          projectId: "project",
          graphId: "graph/one",
          eventNodeId: "event node",
          nodeId: "node/two",
          kind: "exec",
          replay,
          executionPath: "event:one/exec:two",
          executionTraceId: "execution-trace",
          traceId: "trace",
        }),
        "runtime-node-v2/exec/graph%2Fone/event%20node/event%3Aone%2Fexec%3Atwo/node%2Ftwo",
      );
  });
});
