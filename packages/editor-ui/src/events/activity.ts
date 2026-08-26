import type { RuntimeActivity } from "@macrograph/execution";

export const filterActivity = (
  events: ReadonlyArray<RuntimeActivity.Event>,
  search: string,
  pluginId: string,
  status: string,
) => {
  const query = search.trim().toLowerCase();
  return events.filter(
    (event) =>
      (pluginId === "" || event.pluginId === pluginId) &&
      (status === "" || event.status === status) &&
      (query === "" ||
        [event.id, event.name, event.pluginId, event.error ?? "", event.payload].some((value) =>
          value.toLowerCase().includes(query),
        )),
  );
};

export const activityExecutions = (nodes: RuntimeActivity.Event["nodes"]) => {
  const groups = new Map<
    string,
    {
      readonly id: string;
      readonly graphId: string;
      readonly nodes: Array<RuntimeActivity.Event["nodes"][number]>;
    }
  >();
  for (const node of nodes) {
    const group = groups.get(node.executionId);
    if (group !== undefined) group.nodes.push(node);
    else
      groups.set(node.executionId, { id: node.executionId, graphId: node.graphId, nodes: [node] });
  }
  return [...groups.values()];
};

export const activityDuration = (startedAt: number, finishedAt: number | null) => {
  if (finishedAt === null) return "Running";
  const milliseconds = Math.max(0, finishedAt - startedAt);
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(2)} s`;
};
