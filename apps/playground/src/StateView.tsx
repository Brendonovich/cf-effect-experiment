import { Graph, Project } from "@macrograph/core";
import { Show, type Component } from "solid-js";

interface StateViewProps {
  project: Project.Model | null;
}

export const StateView: Component<StateViewProps> = (props) => {
  const stats = () => {
    const graphs = props.project?.graphs ?? {};
    const graphEntries = Object.entries(graphs) as Array<[string, Graph.Model]>;
    const nodeCount = graphEntries.reduce((acc, [, g]) => acc + Object.keys(g.nodes).length, 0);
    const connectionCount = graphEntries.reduce((acc, [, g]) => acc + g.connections.length, 0);
    return { graphCount: graphEntries.length, nodeCount, connectionCount };
  };

  return (
    <Show
      when={props.project}
      fallback={<div class="p-4 text-gray-400 text-sm italic">Loading project state...</div>}
    >
      <div class="p-3">
        <div class="mb-2 text-xs text-gray-500 font-mono">
          {stats().graphCount} graph{stats().graphCount !== 1 ? "s" : ""}, {stats().nodeCount} node
          {stats().nodeCount !== 1 ? "s" : ""}, {stats().connectionCount} connection
          {stats().connectionCount !== 1 ? "s" : ""}
        </div>
        <pre class="text-xs font-mono text-gray-700 bg-gray-50 rounded p-3 overflow-x-auto">
          {JSON.stringify(props.project, null, 2)}
        </pre>
      </div>
    </Show>
  );
};
