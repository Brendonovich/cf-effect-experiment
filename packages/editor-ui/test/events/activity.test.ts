import type { RuntimeActivity } from "@macrograph/execution";

import { describe, expect, it } from "vitest";

import { activityDuration, activityExecutions, filterActivity } from "../../src/events/activity";

const event: RuntimeActivity.Event = {
  id: "event-1",
  pluginId: "obs",
  name: "SceneChanged",
  source: "Engine",
  replayable: true,
  startedAt: 1000,
  finishedAt: 1100,
  status: "complete",
  payload: '{"scene":"Gameplay"}',
  error: null,
  nodes: [],
};

describe("live activity presentation", () => {
  it("combines search, plugin, and status filters without changing event order", () => {
    const failed: RuntimeActivity.Event = {
      ...event,
      id: "event-2",
      pluginId: "twitch",
      status: "failed",
      error: "Connection closed",
    };
    const events = [failed, event];
    expect(filterActivity(events, "  GAMEPLAY ", "obs", "complete")).toEqual([event]);
    expect(filterActivity(events, "closed", "", "")).toEqual([failed]);
    expect(filterActivity(events, "", "", "")).toEqual(events);
    expect(filterActivity(events, "", "obs", "failed")).toEqual([]);
    expect(filterActivity(events, "event-2", "", "")).toEqual([failed]);
  });

  it("groups interleaved nodes by execution rather than graph or node ID", () => {
    const node: RuntimeActivity.Event["nodes"][number] = {
      id: "step-1",
      graphId: "graph",
      nodeId: "node",
      executionId: "execution-1",
      startedAt: 0,
      finishedAt: 1,
      status: "complete",
      error: null,
    };
    const other = { ...node, id: "step-2", executionId: "execution-2" };
    const repeated = { ...node, id: "step-3" };
    const nodes = [node, other, repeated];
    expect(activityExecutions(nodes)).toEqual([
      { id: "execution-1", graphId: "graph", nodes: [node, repeated] },
      { id: "execution-2", graphId: "graph", nodes: [other] },
    ]);
    expect(nodes).toEqual([node, other, repeated]);
  });

  it("formats completed durations and leaves running events open-ended", () => {
    expect(activityDuration(100, null)).toBe("Running");
    expect(activityDuration(100, 112)).toBe("12 ms");
    expect(activityDuration(100, 1600)).toBe("1.50 s");
    expect(activityDuration(100, 99)).toBe("0 ms");
  });
});
