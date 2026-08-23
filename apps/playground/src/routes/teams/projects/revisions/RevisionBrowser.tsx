import type {
  ProjectExecutionNodeRecord as ExecutionNodeRecord,
  ProjectExecutionRecord as ExecutionRecord,
} from "@macrograph/cloud-api";

import { createQuery } from "@tanstack/solid-query";
import { For, Show, createEffect, createMemo, createSignal, type Component } from "solid-js";

import type { ExecutionsApiClient, ProjectsApiClient, RevisionsApiClient } from "../../../../api";

import { runApi } from "../../../../api";
import { LoadingState } from "../../../../LoadingState";

interface ExecutionDetail {
  readonly execution: ExecutionRecord;
  readonly nodes: ReadonlyArray<ExecutionNodeRecord>;
}

interface RevisionBrowserProps {
  projectId: string;
  projectsApi: ProjectsApiClient;
  revisionsApi: RevisionsApiClient;
  executionsApi: ExecutionsApiClient;
  revisionId: string | undefined;
  graphId: string | undefined;
  onSelectionChange: (revisionId: string | undefined, graphId?: string, replace?: boolean) => void;
}

const NODE_WIDTH = 176;
const NODE_HEIGHT = 62;

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export const RevisionBrowser: Component<RevisionBrowserProps> = (props) => {
  const projectQuery = createQuery(() => ({
    queryKey: ["project", props.projectId],
    queryFn: async () => {
      const body = await runApi(props.projectsApi.get({ params: { projectId: props.projectId } }));
      if (body === undefined) throw new Error("Could not load project");
      return body.project;
    },
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  }));
  const currentRevisionId = () => projectQuery.data?.currentRevisionId;

  const revisionsQuery = createQuery(() => ({
    queryKey: ["revisions", props.projectId],
    queryFn: async () => {
      const body = await runApi(
        props.revisionsApi.list({ params: { projectId: props.projectId } }),
      );
      if (body === undefined) throw new Error("Could not load revisions");
      return body.revisions;
    },
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  }));
  const revisions = () => revisionsQuery.data ?? [];

  const executionsQuery = createQuery(() => ({
    queryKey: ["executions", props.projectId],
    queryFn: async () => {
      const body = await runApi(
        props.executionsApi.list({ params: { projectId: props.projectId }, query: {} }),
      );
      if (body === undefined) throw new Error("Could not load executions");
      return body.executions;
    },
    refetchInterval: 5000,
    staleTime: 5000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  }));
  const executions = () => executionsQuery.data ?? [];

  const selectedRevision = createMemo(
    () =>
      revisions().find((revision) => revision.id === props.revisionId) ??
      revisions().find((revision) => revision.id === currentRevisionId()) ??
      revisions()[0],
  );
  const selectedRevisionId = () => selectedRevision()?.id;

  const snapshotQuery = createQuery(() => {
    const revisionId = selectedRevisionId();
    return {
      queryKey: ["revision", props.projectId, revisionId],
      queryFn: async () => {
        if (revisionId === undefined) return undefined;
        const body = await runApi(
          props.revisionsApi.get({
            params: { projectId: props.projectId, revisionId },
          }),
        );
        if (body === undefined) throw new Error("Could not load revision");
        return body;
      },
      enabled: revisionId !== undefined,
      staleTime: Infinity,
      gcTime: 5 * 60 * 1000,
      retry: false,
    };
  });
  const snapshotData = () => snapshotQuery.data;
  const snapshot = () => snapshotData()?.snapshot;

  const selectedGraphId = createMemo(() => {
    const project = snapshot();
    if (project === undefined) return undefined;
    const graphIds = Object.keys(project.graphs);
    return props.graphId !== undefined && graphIds.includes(props.graphId)
      ? props.graphId
      : graphIds[0];
  });

  const [selectedExecutionId, setSelectedExecutionId] = createSignal<string>();
  const executionDetailQuery = createQuery(() => {
    const executionId = selectedExecutionId();
    return {
      queryKey: ["execution", props.projectId, executionId],
      queryFn: async (): Promise<ExecutionDetail | undefined> => {
        if (executionId === undefined) return undefined;
        const body = await runApi(
          props.executionsApi.get({
            params: { projectId: props.projectId, executionId },
          }),
        );
        if (body === undefined) throw new Error("Could not load execution");
        return body;
      },
      enabled: executionId !== undefined,
      staleTime: Infinity,
      gcTime: 5 * 60 * 1000,
      retry: false,
    };
  });
  const executionDetail = () => executionDetailQuery.data;

  const toggleExecution = (execution: ExecutionRecord) =>
    setSelectedExecutionId((current) => (current === execution.id ? undefined : execution.id));

  createEffect(
    () => ({
      graphId: props.graphId,
      onSelectionChange: props.onSelectionChange,
      pending:
        revisionsQuery.isPending || (selectedRevisionId() !== undefined && snapshotQuery.isPending),
      revisionId: props.revisionId,
      selectedGraphId: selectedGraphId(),
      selectedRevisionId: selectedRevisionId(),
    }),
    (state) => {
      if (state.pending) return;
      if (state.selectedRevisionId === undefined) {
        if (state.revisionId !== undefined || state.graphId !== undefined) {
          state.onSelectionChange(undefined, undefined, true);
        }
        return;
      }
      if (
        state.revisionId !== state.selectedRevisionId ||
        state.graphId !== state.selectedGraphId
      ) {
        state.onSelectionChange(state.selectedRevisionId, state.selectedGraphId, true);
      }
    },
  );

  const selectedGraph = () => {
    const project = snapshot();
    const graphId = selectedGraphId();
    return project && graphId ? project.graphs[graphId] : undefined;
  };
  const selectedExecutions = () =>
    executions().filter((execution) => execution.revisionId === selectedRevisionId());
  const revisionExecutions = (revisionId: string) =>
    executions().filter((execution) => execution.revisionId === revisionId);

  const statusClass = (status: ExecutionRecord["status"]) => {
    switch (status) {
      case "complete":
        return "bg-emerald-400/15 text-emerald-300";
      case "running":
        return "bg-blue-400/15 text-blue-300";
      case "errored":
        return "bg-red-400/15 text-red-300";
      default:
        return "bg-amber-400/15 text-amber-300";
    }
  };
  const nodeName = (node: ExecutionNodeRecord) =>
    snapshot()?.graphs[node.graphId]?.nodes[node.nodeId]?.name ?? node.nodeId;

  const canvasOffset = () => {
    const graph = selectedGraph();
    const nodes = graph ? Object.values(graph.nodes) : [];
    if (nodes.length === 0) return { x: 80, y: 80 };
    return {
      x: 80 - Math.min(...nodes.map((node) => node.position.x)),
      y: 80 - Math.min(...nodes.map((node) => node.position.y)),
    };
  };

  const nodePosition = (nodeId: string) => {
    const node = selectedGraph()?.nodes[nodeId];
    const offset = canvasOffset();
    return node ? { x: node.position.x + offset.x, y: node.position.y + offset.y } : undefined;
  };

  const edges = () =>
    (selectedGraph()?.connections ?? []).flatMap((connection) => {
      const from = nodePosition(connection.outNodeId);
      const to = nodePosition(connection.inNodeId);
      if (!from || !to) return [];
      return [
        {
          id: connection.id,
          from: { x: from.x + NODE_WIDTH, y: from.y + NODE_HEIGHT / 2 },
          to: { x: to.x, y: to.y + NODE_HEIGHT / 2 },
        },
      ];
    });

  const edgePath = (edge: ReturnType<typeof edges>[number]) => {
    const control = Math.min(180, Math.max(60, Math.abs(edge.to.x - edge.from.x) / 2));
    return `M ${edge.from.x} ${edge.from.y} C ${edge.from.x + control} ${edge.from.y}, ${edge.to.x - control} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`;
  };

  return (
    <div class="flex h-full min-h-0 bg-gray-2">
      <aside class="w-72 shrink-0 overflow-y-auto border-r border-gray-5 bg-gray-3 p-3 text-gray-12">
        <div class="mb-3 px-2">
          <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-11">
            Deployed revisions
          </div>
        </div>
        <Show
          when={!revisionsQuery.isPending}
          fallback={
            <div class="mb-3 px-2" role="status" aria-label="Loading revision count">
              <div class="h-4 w-28 animate-pulse rounded bg-gray-4" />
            </div>
          }
        >
          <div class="mb-3 px-2 text-xs text-gray-11">{revisions().length} immutable snapshots</div>
        </Show>
        <Show
          when={!revisionsQuery.isPending}
          fallback={
            <div class="rounded border border-dashed border-gray-6 p-4">
              <LoadingState label="Loading revisions" class="h-4" compact />
            </div>
          }
        >
          <Show
            when={revisions().length > 0}
            fallback={
              <div class="rounded border border-dashed border-gray-6 p-4 text-xs text-gray-11">
                No revisions deployed yet.
              </div>
            }
          >
            <For each={revisions()}>
              {(revision) => {
                const current = () => revision.id === currentRevisionId();
                return (
                  <button
                    class={`mb-2 w-full rounded-lg border p-3 text-left transition ${
                      selectedRevisionId() === revision.id
                        ? "border-blue-500 bg-blue-500/15"
                        : "border-gray-5 bg-gray-2 hover:border-gray-6"
                    }`}
                    onClick={() => props.onSelectionChange(revision.id)}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-mono text-xs text-gray-12">{revision.id.slice(0, 8)}</span>
                      <Show when={current()}>
                        <span class="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                          Current
                        </span>
                      </Show>
                    </div>
                    <div class="mt-2 text-[11px] text-gray-11">
                      {formatDate(revision.createdAt)}
                    </div>
                    <div class="mt-1 flex items-center justify-between gap-2 text-[10px] text-gray-10">
                      <span class="truncate">by {revision.createdBy}</span>
                      <Show
                        when={!executionsQuery.isPending}
                        fallback={
                          <span
                            class="inline-block h-3 w-16 animate-pulse rounded bg-gray-4"
                            role="status"
                            aria-label="Loading executions"
                          />
                        }
                      >
                        <span>
                          {revisionExecutions(revision.id).length} execution
                          {revisionExecutions(revision.id).length === 1 ? "" : "s"}
                        </span>
                      </Show>
                    </div>
                  </button>
                );
              }}
            </For>
          </Show>
        </Show>
      </aside>

      <section class="min-w-0 flex-1 flex flex-col">
        <div class="flex h-12 shrink-0 items-center justify-between border-b border-gray-5 bg-gray-3 px-4">
          <Show
            when={selectedRevisionId() === undefined || !snapshotQuery.isPending}
            fallback={
              <span
                class="h-5 w-32 animate-pulse rounded bg-gray-4"
                role="status"
                aria-label="Loading revision title"
              />
            }
          >
            <div class="text-sm font-semibold text-gray-12">
              {snapshot()?.name ?? "Revision preview"}
            </div>
          </Show>
          <Show when={!revisionsQuery.isPending}>
            <div class="font-mono text-[10px] text-gray-11">{selectedRevisionId()}</div>
          </Show>
        </div>

        <Show when={selectedRevisionId() === undefined || !snapshotQuery.isPending} fallback={null}>
          <Show when={snapshot()} keyed>
            {(project) => (
              <div class="flex shrink-0 overflow-x-auto border-b border-gray-5 bg-gray-3 px-2">
                <For each={Object.values(project.graphs)}>
                  {(graph) => (
                    <button
                      class={`px-3 py-2 text-xs transition ${
                        selectedGraphId() === graph.id
                          ? "border-b-2 border-blue-500 text-blue-300"
                          : "text-gray-11 hover:text-gray-12"
                      }`}
                      onClick={() => props.onSelectionChange(selectedRevisionId(), graph.id)}
                    >
                      {graph.name}
                    </button>
                  )}
                </For>
              </div>
            )}
          </Show>
        </Show>
        <div class="max-h-96 shrink-0 overflow-y-auto border-b border-gray-5 bg-gray-2 px-4 py-2 text-gray-12">
          <div class="mb-2 flex items-center justify-between">
            <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-11">
              Incoming events and executions
            </div>
            <button
              class="text-[10px] text-gray-11 hover:text-gray-12"
              onClick={() => void executionsQuery.refetch()}
            >
              Refresh
            </button>
          </div>
          <Show
            when={!executionsQuery.isPending}
            fallback={
              <div class="pb-2" role="status" aria-label="Loading executions">
                <div class="h-4 w-48 animate-pulse rounded bg-gray-4" />
              </div>
            }
          >
            <Show
              when={selectedExecutions().length > 0}
              fallback={
                <div class="pb-2 text-xs text-gray-10">
                  No events have executed against this revision.
                </div>
              }
            >
              <For each={selectedExecutions()}>
                {(execution) => (
                  <div class="mb-1 overflow-hidden rounded bg-gray-1">
                    <button
                      class="grid w-full grid-cols-[100px_1fr_auto] items-center gap-3 px-2 py-1.5 text-left text-[10px] hover:bg-gray-2"
                      onClick={() => void toggleExecution(execution)}
                    >
                      <span
                        class={`w-fit rounded px-1.5 py-0.5 font-bold uppercase tracking-wide ${statusClass(execution.status)}`}
                      >
                        {execution.status}
                      </span>
                      <div class="min-w-0">
                        <div class="truncate text-xs text-gray-12">{execution.eventType}</div>
                        <div class="truncate font-mono text-gray-10">workflow {execution.id}</div>
                      </div>
                      <div class="text-right text-gray-11">
                        <div>{formatDate(execution.receivedAt)}</div>
                        <Show when={execution.completedAt}>
                          {(completedAt) => <div>completed {formatDate(completedAt())}</div>}
                        </Show>
                      </div>
                    </button>
                    <Show when={selectedExecutionId() === execution.id}>
                      <Show
                        when={!executionDetailQuery.isPending}
                        fallback={<LoadingState label="Loading execution detail" class="h-40" />}
                      >
                        <Show when={executionDetail()} keyed>
                          {(detail) => (
                            <div class="grid grid-cols-2 gap-3 border-t border-gray-5 p-3">
                              <div class="min-w-0">
                                <div class="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-11">
                                  Event payload
                                </div>
                                <pre class="max-h-56 overflow-auto rounded bg-black/40 p-2 text-[10px] leading-relaxed text-gray-12">
                                  {JSON.stringify(detail.execution.eventPayload, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <div class="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-11">
                                  Triggered nodes
                                </div>
                                <Show
                                  when={detail.nodes.length > 0}
                                  fallback={
                                    <div class="text-xs text-gray-10">No node steps recorded.</div>
                                  }
                                >
                                  <For each={detail.nodes}>
                                    {(node, index) => (
                                      <div class="relative mb-2 flex gap-2 pl-5 text-xs">
                                        <div class="absolute left-0 top-0 grid size-4 place-items-center rounded-full bg-gray-6 text-[9px] text-gray-12">
                                          {index() + 1}
                                        </div>
                                        <div class="min-w-0 flex-1">
                                          <div class="flex items-center justify-between gap-2">
                                            <span class="truncate font-medium text-gray-12">
                                              {nodeName(node)}
                                            </span>
                                            <span
                                              class={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${statusClass(node.status)}`}
                                            >
                                              {node.status}
                                            </span>
                                          </div>
                                          <div class="truncate font-mono text-[10px] text-gray-10">
                                            {node.kind} · {node.nodeId}
                                          </div>
                                          <Show when={node.error}>
                                            {(error) => (
                                              <div class="mt-1 text-[10px] text-red-300">
                                                {error()}
                                              </div>
                                            )}
                                          </Show>
                                        </div>
                                      </div>
                                    )}
                                  </For>
                                </Show>
                              </div>
                            </div>
                          )}
                        </Show>
                      </Show>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
        <Show
          when={selectedRevisionId() === undefined || !snapshotQuery.isPending}
          fallback={<LoadingState label="Loading revision canvas" class="h-full" />}
        >
          <Show
            when={selectedGraph()}
            keyed
            fallback={
              <div class="grid flex-1 place-items-center text-sm text-gray-11">
                This revision has no graphs.
              </div>
            }
          >
            {(graph) => (
              <div class="relative flex-1 overflow-auto bg-gray-2">
                <div class="relative h-[1400px] w-[2200px]">
                  <svg
                    class="pointer-events-none absolute inset-0 h-full w-full"
                    aria-hidden="true"
                  >
                    <For each={edges()}>
                      {(edge) => (
                        <path
                          d={edgePath(edge)}
                          fill="none"
                          stroke="rgba(255,255,255,0.6)"
                          stroke-width="2.5"
                        />
                      )}
                    </For>
                  </svg>
                  <For each={Object.values(graph.nodes)}>
                    {(node) => {
                      const position = () => nodePosition(node.id)!;
                      return (
                        <div
                          class="absolute h-[62px] w-44 overflow-hidden rounded-lg border-2 border-black/70 bg-black/80 text-white shadow-xl"
                          style={{
                            transform: `translate(${position().x}px, ${position().y}px)`,
                          }}
                        >
                          <div class="h-6 truncate bg-gray-9 px-2 py-1 text-xs font-semibold">
                            {node.name}
                          </div>
                          <div class="truncate px-2 py-2 font-mono text-[10px] text-gray-11">
                            {node.schema.package}/{node.schema.schema}
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            )}
          </Show>
        </Show>
      </section>
    </div>
  );
};
