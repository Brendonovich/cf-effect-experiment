import type {
  ProjectEventRecord,
  ProjectExecutionNodeRecord as ExecutionNodeRecord,
  ProjectExecutionRecord as ExecutionRecord,
} from "@macrograph/cloud-api";

import { Button, LoadingState, SnapshotGraphCanvas } from "@macrograph/editor-ui";
import { colors } from "@macrograph/editor-ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { For, Show, createMemo, createSignal, type Component } from "solid-js";

import type { ExecutionsApiClient, ProjectsApiClient, DeploymentsApiClient } from "../../../../api";

import { runApi } from "../../../../api";
import { Redirect } from "../../../../Redirect";

interface ExecutionDetail {
  readonly execution: ExecutionRecord;
  readonly event: ProjectEventRecord;
  readonly nodes: ReadonlyArray<ExecutionNodeRecord>;
}

interface DeploymentBrowserProps {
  projectId: string;
  projectsApi: ProjectsApiClient;
  deploymentsApi: DeploymentsApiClient;
  executionsApi: ExecutionsApiClient;
  deploymentId: string | undefined;
  graphId: string | undefined;
  canDeploy: boolean;
  onDeploy: () => Promise<void>;
  selectionHref: (deploymentId?: string, graphId?: string) => string;
  onSelectionChange: (deploymentId: string | undefined, graphId?: string, replace?: boolean) => void;
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export const DeploymentBrowser: Component<DeploymentBrowserProps> = (props) => {
  const queryClient = useQueryClient();
  const [deployState, setDeployState] = createSignal<"idle" | "deploying" | "error">("idle");
  const [graphSearch, setGraphSearch] = createSignal("");
  const [deploymentMenuOpen, setDeploymentMenuOpen] = createSignal(false);

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
  const currentDeploymentId = () => projectQuery.data?.currentDeploymentId;

  const deploymentsQuery = createQuery(() => ({
    queryKey: ["deployments", props.projectId],
    queryFn: async () => {
      const body = await runApi(
        props.deploymentsApi.list({ params: { projectId: props.projectId } }),
      );
      if (body === undefined) throw new Error("Could not load deployments");
      return body.deployments;
    },
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  }));
  const deployments = () => deploymentsQuery.data ?? [];

  const deploy = async () => {
    setDeployState("deploying");
    try {
      const result = await runApi(
        props.deploymentsApi.deploy({ params: { projectId: props.projectId } }),
      );
      if (result === undefined) {
        setDeployState("error");
        return;
      }

      queryClient.setQueryData(["deployments", props.projectId], [result.deployment, ...deployments()]);
      queryClient.setQueryData(["project", props.projectId], (project: typeof projectQuery.data) =>
        project === undefined ? project : { ...project, currentDeploymentId: result.deployment.id },
      );
      void queryClient.invalidateQueries({ queryKey: ["events", props.projectId] });
      props.onSelectionChange(result.deployment.id);
      await props.onDeploy();
      setDeployState("idle");
    } catch {
      setDeployState("error");
    }
  };

  const executionsQuery = createQuery(() => ({
    queryKey: ["executions", props.projectId],
    queryFn: async () => {
      const body = await runApi(
        props.executionsApi.list({ params: { projectId: props.projectId }, query: {} }),
      );
      if (body === undefined) throw new Error("Could not load executions");
      return body;
    },
    refetchInterval: 5000,
    staleTime: 5000,
    gcTime: 5 * 60 * 1000,
    retry: false,
  }));
  const executions = () => executionsQuery.data?.executions ?? [];
  const executionEvents = () => executionsQuery.data?.events ?? [];

  const selectedDeployment = createMemo(
    () =>
      deployments().find((deployment) => deployment.id === props.deploymentId) ??
      deployments().find((deployment) => deployment.id === currentDeploymentId()) ??
      deployments()[0],
  );
  const selectedDeploymentId = () => selectedDeployment()?.id;

  const snapshotQuery = createQuery(() => {
    const deploymentId = selectedDeploymentId();
    return {
      queryKey: ["deployment", props.projectId, deploymentId],
      queryFn: async () => {
        if (deploymentId === undefined) return undefined;
        const body = await runApi(
          props.deploymentsApi.get({
            params: { projectId: props.projectId, deploymentId },
          }),
        );
        if (body === undefined) throw new Error("Could not load deployment");
        return body;
      },
      enabled: deploymentId !== undefined,
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

  const redirectHref = createMemo(() => {
    const deploymentId = selectedDeploymentId();
    const graphId = selectedGraphId();
    if (deploymentsQuery.isPending || (deploymentId !== undefined && snapshotQuery.isPending)) {
      return undefined;
    }
    if (deploymentId === undefined) {
      return props.deploymentId === undefined && props.graphId === undefined
        ? undefined
        : props.selectionHref();
    }
    return props.deploymentId === deploymentId && props.graphId === graphId
      ? undefined
      : props.selectionHref(deploymentId, graphId);
  });

  const selectedGraph = () => {
    const project = snapshot();
    const graphId = selectedGraphId();
    return project && graphId ? project.graphs[graphId] : undefined;
  };
  const selectedExecutions = () =>
    executions().filter((execution) => execution.deploymentId === selectedDeploymentId());

  const statusStyle = (status: ExecutionRecord["status"]) => {
    switch (status) {
      case "complete":
        return styles.complete;
      case "running":
        return styles.running;
      case "errored":
        return styles.errored;
      default:
        return styles.pending;
    }
  };
  const nodeName = (node: ExecutionNodeRecord) =>
    snapshot()?.graphs[node.graphId]?.nodes[node.nodeId]?.name ?? node.nodeId;

  return (
    <div sx={styles.root}>
      <Show when={redirectHref()} keyed>
        {(href) => <Redirect href={href} replace />}
      </Show>
      <section sx={styles.content}>
        <div sx={styles.topbar}>
          <div sx={styles.deploymentControls}>
            <div sx={styles.deploymentPicker}>
              <button
                type="button"
                sx={styles.pickerTrigger}
                aria-expanded={deploymentMenuOpen() ? "true" : "false"}
                aria-haspopup="listbox"
                disabled={deploymentsQuery.isPending || deployments().length === 0}
                onClick={() => setDeploymentMenuOpen((open) => !open)}
              >
                <span sx={styles.pickerValue}>
                  {selectedDeploymentId() === currentDeploymentId()
                    ? "Current deployment"
                    : (selectedDeploymentId()?.slice(0, 8) ?? "No deployments")}
                </span>
                <IconTablerChevronDown {...stylex.attrs(styles.pickerChevron)} />
              </button>
              <Show when={props.canDeploy}>
                <Button
                  type="button"
                  disabled={deployState() === "deploying"}
                  onClick={() => void deploy()}
                >
                  {deployState() === "deploying" ? "Deploying..." : "Deploy"}
                </Button>
              </Show>
              <Show when={deploymentMenuOpen()}>
                <div sx={styles.deploymentPopover} role="listbox">
                  <For each={deployments()}>
                    {(deployment) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedDeploymentId() === deployment.id ? "true" : "false"}
                        sx={[
                          styles.popoverOption,
                          selectedDeploymentId() === deployment.id
                            ? styles.popoverOptionSelected
                            : null,
                        ]}
                        onClick={() => {
                          props.onSelectionChange(deployment.id);
                          setDeploymentMenuOpen(false);
                        }}
                      >
                        <div sx={styles.between}>
                          <span sx={styles.deploymentId}>{deployment.id.slice(0, 8)}</span>
                          <Show when={deployment.id === currentDeploymentId()}>
                            <span sx={styles.current}>Current</span>
                          </Show>
                        </div>
                        <div sx={styles.popoverOptionDate}>{formatDate(deployment.createdAt)}</div>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <Show when={deployState() === "error"}>
              <span sx={styles.inlineDeployError}>Could not deploy deployment.</span>
            </Show>
          </div>
        </div>

        <div sx={styles.workspace}>
          <Show
            when={selectedDeploymentId() === undefined || !snapshotQuery.isPending}
            fallback={null}
          >
            <Show when={snapshot()} keyed>
              {(project) => (
                <aside sx={styles.graphSidebar}>
                  <div sx={styles.graphSearch}>
                    <IconTablerSearch {...stylex.attrs(styles.graphSearchIcon)} />
                    <input
                      sx={styles.graphSearchInput}
                      placeholder="Search Graphs"
                      value={graphSearch()}
                      onInput={(event) => setGraphSearch(event.currentTarget.value)}
                    />
                  </div>
                  <div sx={styles.graphList}>
                    <For
                      each={Object.values(project.graphs).filter((graph) =>
                        graph.name.toLowerCase().includes(graphSearch().trim().toLowerCase()),
                      )}
                    >
                      {(graph) => (
                        <button
                          type="button"
                          sx={[
                            styles.graphButton,
                            selectedGraphId() === graph.id
                              ? styles.graphSelected
                              : styles.graphIdle,
                          ]}
                          onClick={() => props.onSelectionChange(selectedDeploymentId(), graph.id)}
                        >
                          {graph.name}
                        </button>
                      )}
                    </For>
                  </div>
                </aside>
              )}
            </Show>
          </Show>
          <div sx={styles.graphContent}>
            <div sx={styles.executions}>
              <div sx={styles.executionsHeader}>
                <div sx={styles.executionEyebrow}>Incoming events and executions</div>
                <button sx={styles.refresh} onClick={() => void executionsQuery.refetch()}>
                  Refresh
                </button>
              </div>
              <Show
                when={!executionsQuery.isPending}
                fallback={
                  <div sx={styles.loadingBottom} role="status" aria-label="Loading executions">
                    <div sx={styles.executionsLoading} />
                  </div>
                }
              >
                <Show
                  when={selectedExecutions().length > 0}
                  fallback={
                    <div sx={styles.noExecutions}>
                      No events have executed against this deployment.
                    </div>
                  }
                >
                  <For each={selectedExecutions()}>
                    {(execution) => (
                      <div sx={styles.execution}>
                        <button
                          sx={styles.executionButton}
                          onClick={() => void toggleExecution(execution)}
                        >
                          <span sx={[styles.status, statusStyle(execution.status)]}>
                            {execution.status}
                          </span>
                          <div sx={styles.minWidth}>
                            <div sx={styles.eventType}>
                              {executionEvents().find(
                                (event) => event.id === execution.projectEventId,
                              )?.eventType ?? "Unknown event"}
                            </div>
                            <div sx={styles.workflow}>workflow {execution.id}</div>
                          </div>
                          <div sx={styles.executionDate}>
                            <div>{formatDate(execution.receivedAt)}</div>
                            <Show when={execution.completedAt}>
                              {(completedAt) => <div>completed {formatDate(completedAt())}</div>}
                            </Show>
                          </div>
                        </button>
                        <Show when={selectedExecutionId() === execution.id}>
                          <Show
                            when={!executionDetailQuery.isPending}
                            fallback={
                              <LoadingState
                                label="Loading execution detail"
                                style={styles.loading160}
                              />
                            }
                          >
                            <Show when={executionDetail()} keyed>
                              {(detail) => (
                                <div sx={styles.executionDetail}>
                                  <div sx={styles.minWidth}>
                                    <div sx={styles.detailLabel}>Event payload</div>
                                    <pre sx={styles.payload}>
                                      {JSON.stringify(detail.event.eventPayload, null, 2)}
                                    </pre>
                                  </div>
                                  <div>
                                    <div sx={styles.detailLabel}>Triggered nodes</div>
                                    <Show
                                      when={detail.nodes.length > 0}
                                      fallback={
                                        <div sx={styles.muted12}>No node steps recorded.</div>
                                      }
                                    >
                                      <For each={detail.nodes}>
                                        {(node, index) => (
                                          <div sx={styles.nodeStep}>
                                            <div sx={styles.nodeIndex}>{index() + 1}</div>
                                            <div sx={styles.grow}>
                                              <div sx={styles.between}>
                                                <span sx={styles.nodeName}>{nodeName(node)}</span>
                                                <span
                                                  sx={[styles.status, statusStyle(node.status)]}
                                                >
                                                  {node.status}
                                                </span>
                                              </div>
                                              <div sx={styles.nodeMeta}>
                                                {node.kind} · {node.nodeId}
                                              </div>
                                              <Show when={node.error}>
                                                {(error) => (
                                                  <div sx={styles.nodeError}>{error()}</div>
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
              when={selectedDeploymentId() === undefined || !snapshotQuery.isPending}
              fallback={<LoadingState label="Loading deployment canvas" style={styles.fullHeight} />}
            >
              <Show
                when={selectedGraph()}
                keyed
                fallback={<div sx={styles.noGraphs}>This deployment has no graphs.</div>}
              >
                {(graph) => <SnapshotGraphCanvas graph={graph} />}
              </Show>
            </Show>
          </div>
        </div>
      </section>
    </div>
  );
};

const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });
const styles = stylex.create({
  root: { display: "flex", height: "100%", minHeight: 0, backgroundColor: colors.gray2 },
  muted12: { fontSize: 12, color: colors.gray10 },
  between: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  deploymentId: { fontFamily: "monospace", fontSize: 12, color: colors.gray12 },
  current: {
    borderRadius: 4,
    backgroundColor: "rgb(52 211 153 / .15)",
    padding: "2px 6px",
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".05em",
    color: "#6ee7b7",
  },
  content: { display: "flex", minWidth: 0, flex: 1, flexDirection: "column" },
  topbar: {
    display: "flex",
    height: 48,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: `1px solid ${colors.gray5}`,
    backgroundColor: colors.gray3,
    paddingInline: 16,
  },
  deploymentControls: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  inlineDeployError: { fontSize: 11, color: "#fca5a5" },
  deploymentPicker: {
    position: "relative",
    display: "flex",
    overflow: "visible",
    gap: 8,
  },
  pickerTrigger: {
    display: "flex",
    height: 32,
    alignItems: "center",
    gap: 8,
    borderRadius: 6,
    border: `1px solid ${colors.gray6}`,
    paddingInline: 10,
    color: colors.gray12,
    backgroundColor: { default: colors.gray2, ":hover": colors.gray4 },
  },
  pickerValue: { fontSize: 12 },
  pickerChevron: { width: 14, height: 14, flexShrink: 0, color: colors.gray10 },
  deploymentPopover: {
    position: "absolute",
    zIndex: 20,
    top: "calc(100% + 6px)",
    left: 0,
    width: 240,
    maxHeight: 320,
    overflowY: "auto",
    borderRadius: 8,
    border: `1px solid ${colors.gray6}`,
    backgroundColor: colors.gray3,
    padding: 4,
    boxShadow: "0 12px 28px rgb(0 0 0 / .35)",
  },
  popoverOption: {
    display: "block",
    width: "100%",
    borderRadius: 5,
    padding: "8px 9px",
    textAlign: "left",
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
  },
  popoverOptionSelected: { backgroundColor: colors.gray4 },
  popoverOptionDate: { marginTop: 4, fontSize: 10, color: colors.gray11 },
  workspace: { display: "flex", minHeight: 0, minWidth: 0, flex: 1 },
  graphSidebar: {
    display: "flex",
    width: 224,
    flexShrink: 0,
    flexDirection: "column",
    borderTopColor: colors.gray5,
    borderTopStyle: "solid",
    borderTopWidth: 1,
    borderRightColor: colors.gray5,
    borderRightStyle: "solid",
    borderRightWidth: 1,
    backgroundColor: colors.gray3,
    color: colors.gray12,
  },
  graphSearch: {
    display: "flex",
    height: 32,
    flexShrink: 0,
    alignItems: "center",
    borderBottomColor: colors.gray6,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    backgroundColor: colors.gray2,
  },
  graphSearchIcon: { width: 14, height: 14, flexShrink: 0, marginLeft: 8, color: colors.gray9 },
  graphSearchInput: {
    height: "100%",
    minWidth: 0,
    flex: 1,
    backgroundColor: "transparent",
    paddingInline: 6,
    fontSize: 12,
    outline: "none",
    "::placeholder": { color: colors.gray9 },
  },
  graphList: { minHeight: 0, flex: 1, overflowY: "auto" },
  graphButton: {
    display: "block",
    width: "100%",
    overflow: "hidden",
    padding: "5px 8px",
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
  },
  graphSelected: {
    backgroundColor: { default: colors.gray4, ":hover": colors.gray5 },
    boxShadow: `inset 2px 0 0 ${colors.focus}`,
  },
  graphIdle: { backgroundColor: { default: "transparent", ":hover": colors.gray4 } },
  graphContent: { display: "flex", minHeight: 0, minWidth: 0, flex: 1, flexDirection: "column" },
  executions: {
    maxHeight: 384,
    flexShrink: 0,
    overflowY: "auto",
    borderBottom: `1px solid ${colors.gray5}`,
    backgroundColor: colors.gray2,
    padding: "8px 16px",
    color: colors.gray12,
  },
  executionsHeader: {
    marginBottom: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  executionEyebrow: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: ".18em",
    color: colors.gray11,
  },
  refresh: { fontSize: 10, color: { default: colors.gray11, ":hover": colors.gray12 } },
  loadingBottom: { paddingBottom: 8 },
  executionsLoading: {
    width: 192,
    height: 16,
    borderRadius: 4,
    backgroundColor: colors.gray4,
    animation: `${pulse} 2s infinite`,
  },
  noExecutions: { paddingBottom: 8, fontSize: 12, color: colors.gray10 },
  execution: {
    marginBottom: 4,
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: colors.gray1,
  },
  executionButton: {
    display: "grid",
    width: "100%",
    gridTemplateColumns: "100px 1fr auto",
    alignItems: "center",
    gap: 12,
    padding: "6px 8px",
    textAlign: "left",
    fontSize: 10,
    backgroundColor: { default: "transparent", ":hover": colors.gray2 },
  },
  status: {
    width: "fit-content",
    borderRadius: 4,
    padding: "2px 6px",
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".025em",
  },
  complete: { backgroundColor: "rgb(52 211 153 / .15)", color: "#6ee7b7" },
  running: { backgroundColor: "rgb(96 165 250 / .15)", color: "#93c5fd" },
  errored: { backgroundColor: "rgb(248 113 113 / .15)", color: "#fca5a5" },
  pending: { backgroundColor: "rgb(251 191 36 / .15)", color: "#fcd34d" },
  minWidth: { minWidth: 0 },
  eventType: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
    color: colors.gray12,
  },
  workflow: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "monospace",
    color: colors.gray10,
  },
  executionDate: { textAlign: "right", color: colors.gray11 },
  loading160: { height: 160 },
  executionDetail: {
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    gap: 12,
    borderTop: `1px solid ${colors.gray5}`,
    padding: 12,
  },
  detailLabel: {
    marginBottom: 8,
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: ".05em",
    color: colors.gray11,
  },
  payload: {
    maxHeight: 224,
    overflow: "auto",
    borderRadius: 4,
    backgroundColor: "rgb(0 0 0 / .4)",
    padding: 8,
    fontSize: 10,
    lineHeight: 1.625,
    color: colors.gray12,
  },
  nodeStep: {
    position: "relative",
    marginBottom: 8,
    display: "flex",
    gap: 8,
    paddingLeft: 20,
    fontSize: 12,
  },
  nodeIndex: {
    position: "absolute",
    left: 0,
    top: 0,
    display: "grid",
    width: 16,
    height: 16,
    placeItems: "center",
    borderRadius: 9999,
    backgroundColor: colors.gray6,
    fontSize: 9,
    color: colors.gray12,
  },
  grow: { minWidth: 0, flex: 1 },
  nodeName: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500,
    color: colors.gray12,
  },
  nodeMeta: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "monospace",
    fontSize: 10,
    color: colors.gray10,
  },
  nodeError: { marginTop: 4, fontSize: 10, color: "#fca5a5" },
  fullHeight: { height: "100%" },
  noGraphs: { display: "grid", flex: 1, placeItems: "center", fontSize: 14, color: colors.gray11 },
});
