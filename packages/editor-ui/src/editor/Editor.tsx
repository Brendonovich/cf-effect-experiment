import type { EditorRpc } from "@macrograph/editor";
import type { RuntimeActivity } from "@macrograph/execution";
import type { ClientSettings } from "@macrograph/plugin";
import type { JSX } from "@solidjs/web";
import type { Effect, Stream } from "effect";
import type { RpcClient, RpcClientError } from "effect/unstable/rpc";

import { TypeDefinition } from "@macrograph/core";
import * as stylex from "@stylexjs/stylex";
import { createMemo, Errored, For, Show } from "solid-js";

import type { EditorController } from "./createEditorController";

import { colors } from "../tokens.stylex.ts";
import { Button } from "../ui/Button";
import { LoadingState } from "../ui/LoadingState";
import { NavigationSidebar } from "./catalog/NavigationSidebar";
import { TypeDefinitions } from "./catalog/TypeDefinitions";
import { createEditorShortcuts } from "./createEditorShortcuts";
import { compatibleSchemaPorts } from "./graph/connectionAuthoring";
import { createEditorCanvas } from "./graph/createEditorCanvas";
import { GraphNode } from "./graph/GraphNode";
import {
  connectedPortIds,
  connectionPath,
  graphConnections,
  wireColor,
} from "./graph/graphPresentation";
import { NodeCreationMenu } from "./graph/NodeCreationMenu";
import { Inspector } from "./inspector/Inspector";
import { PluginSettingsView } from "./plugins/PluginSettingsView";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { EmptyContext, Sidebar, WorkspacePanes } from "./workspace/Layout";
import { selectedTab as selectedWorkspaceTab, type WorkspaceTab } from "./workspace/workspace";

const styles = stylex.create({
  errorPage: {
    display: "flex",
    width: "100%",
    height: "100%",
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.gray1,
    padding: 24,
    color: colors.gray12,
  },
  errorCard: {
    width: "100%",
    maxWidth: 448,
    borderColor: colors.red7,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray2,
    padding: 24,
  },
  errorIcon: {
    display: "grid",
    width: 40,
    height: 40,
    marginBottom: 16,
    placeItems: "center",
    borderRadius: "50%",
    backgroundColor: colors.red4,
    color: colors.red11,
  },
  errorMark: { fontSize: 20, fontWeight: 600 },
  errorTitle: { margin: 0, fontSize: 16, fontWeight: 600 },
  errorDescription: {
    marginBottom: 0,
    marginTop: 8,
    fontSize: 14,
    lineHeight: "24px",
    color: colors.gray11,
  },
  errorActions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 },
  tabIcon: { width: 14, height: 14, flexShrink: 0 },
  editor: {
    "--gray-1": "#111111",
    "--gray-2": "#191919",
    "--gray-3": "#222222",
    "--gray-4": "#2a2a2a",
    "--gray-5": "#313131",
    "--gray-6": "#3a3a3a",
    "--gray-7": "#484848",
    "--gray-8": "#606060",
    "--gray-9": "#6e6e6e",
    "--gray-10": "#7b7b7b",
    "--gray-11": "#b4b4b4",
    "--gray-12": "#eeeeee",
    "--red-1": "#191111",
    "--red-2": "#201314",
    "--red-3": "#3b1219",
    "--red-4": "#500f1c",
    "--red-5": "#611623",
    "--red-6": "#72232d",
    "--red-7": "#8c333a",
    "--red-8": "#b54548",
    "--red-9": "#e5484d",
    "--red-10": "#ec5d5e",
    "--red-11": "#ff9592",
    "--red-12": "#ffd1d9",
    position: "relative",
    display: "flex",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: colors.gray2,
    color: colors.gray12,
    colorScheme: "dark",
    cursor: "default",
    fontSize: 14,
    userSelect: "none",
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    zIndex: 50,
    display: "grid",
    placeItems: "center",
    backgroundColor: colors.gray2,
    opacity: 1,
    transitionDuration: "100ms",
    transitionProperty: "opacity",
  },
  hiddenOverlay: { pointerEvents: "none", opacity: 0 },
  loadingLabel: { fontSize: 12, color: colors.gray11 },
  editorContent: {
    display: "flex",
    height: "100%",
    minHeight: 0,
    flexDirection: "column",
    opacity: 1,
    transitionDuration: "100ms",
    transitionProperty: "opacity",
  },
  hiddenContent: { pointerEvents: "none", opacity: 0 },
  workspaceDivider: {
    borderTopColor: colors.gray5,
    borderTopStyle: "solid",
    borderTopWidth: 1,
  },
  reconnecting: {
    backgroundColor: "#f59e0b",
    paddingBlock: 6,
    paddingInline: 12,
    textAlign: "center",
    fontSize: 12,
    fontWeight: 500,
    color: "black",
  },
  fill: { flex: 1 },
  workspace: { position: "relative", display: "flex", minHeight: 0, flex: 1 },
  focusRing: {
    outline: "none",
    boxShadow: {
      default: null,
      ":focus-visible": `inset 0 0 0 1px ${colors.focus}`,
    },
  },
  mobilePill: {
    position: "absolute",
    bottom: 8,
    zIndex: 20,
    borderColor: colors.gray6,
    borderRadius: 9999,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray3,
    paddingBlock: 4,
    paddingInline: 10,
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
    fontSize: 11,
    fontWeight: 500,
    color: colors.gray12,
    display: { default: "block", "@media (min-width: 768px)": "none" },
  },
  leftPill: { left: 8 },
  rightPill: { right: 8 },
  main: {
    display: "flex",
    minWidth: 0,
    flex: 1,
    backgroundColor: colors.gray2,
  },
  zoomedMain: {
    margin: 8,
    borderColor: colors.gray5,
    borderStyle: "solid",
    borderWidth: 1,
  },
  graphPane: {
    display: "flex",
    height: "100%",
    minHeight: 0,
    flexDirection: "column",
  },
  canvas: {
    position: "relative",
    display: "flex",
    minHeight: 0,
    flex: 1,
    touchAction: "none",
    flexDirection: "column",
    alignItems: "flex-start",
    overflow: "hidden",
    backgroundColor: colors.gray2,
    backgroundImage: `radial-gradient(circle, ${colors.gray6} 1px, transparent 1px)`,
  },
  gridAdditions: {
    pointerEvents: "none",
    position: "absolute",
    inset: 0,
    backgroundImage: `radial-gradient(circle, ${colors.gray6} 1px, transparent 1px), radial-gradient(circle, ${colors.gray6} 1px, transparent 1px), radial-gradient(circle, ${colors.gray6} 1px, transparent 1px)`,
    transition: "opacity 250ms ease-in-out",
  },
  readOnly: {
    pointerEvents: "none",
    position: "absolute",
    right: 8,
    bottom: 8,
    zIndex: 20,
    borderColor: colors.gray6,
    borderRadius: 9999,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: "color-mix(in srgb, var(--gray-2) 90%, transparent)",
    paddingBlock: 4,
    paddingInline: 10,
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
    fontSize: 11,
    fontWeight: 500,
    color: colors.gray10,
  },
  emptyGraph: {
    display: "grid",
    width: "100%",
    height: "100%",
    flex: 1,
    placeItems: "center",
    fontSize: 12,
    color: colors.gray11,
  },
  canvasLayer: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  },
  scaledLayer: { transformOrigin: "top left" },
  wires: { pointerEvents: "none", overflow: "visible" },
  smoothWire: {
    transitionDuration: { default: "40ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    transitionProperty: "d",
    transitionTimingFunction: "linear",
  },
  remoteCursor: {
    pointerEvents: "none",
    position: "absolute",
    zIndex: 20,
    transitionDuration: { default: "40ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    transitionProperty: "transform",
    transitionTimingFunction: "linear",
  },
  cursorIcon: {
    width: 16,
    height: 16,
    filter: "drop-shadow(0 1px 1px rgb(0 0 0 / 0.4))",
  },
  cursorLabel: {
    display: "block",
    width: "max-content",
    maxWidth: 144,
    overflow: "hidden",
    marginLeft: 12,
    marginTop: -4,
    borderRadius: 4,
    paddingBlock: 2,
    paddingInline: 6,
    boxShadow: "0 1px 3px rgb(0 0 0 / 0.25)",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 10,
    fontWeight: 600,
    color: "white",
  },
  selection: {
    pointerEvents: "none",
    position: "absolute",
    left: 0,
    top: 0,
    borderColor: colors.focus,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: "rgb(234 179 8 / 0.1)",
  },
  contextMenu: {
    position: "fixed",
    zIndex: 50,
    display: "flex",
    minWidth: 160,
    flexDirection: "column",
    borderColor: colors.gray3,
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: colors.gray1,
    padding: 4,
    fontSize: 14,
    outline: "none",
  },
  contextAction: {
    width: "100%",
    border: 0,
    borderRadius: 4,
    backgroundColor: {
      default: "transparent",
      ":hover": "rgb(255 255 255 / 0.1)",
    },
    padding: 4,
    textAlign: "left",
    color: "inherit",
  },
});

function SettingsTabIcon() {
  return <IconTablerSettings {...stylex.attrs(styles.tabIcon)} />;
}

export type EditorRpcClient = RpcClient.FromGroup<
  typeof EditorRpc.EditorRpcs,
  RpcClientError.RpcClientError
>;

export interface EditorConnection {
  readonly client: EditorRpcClient;
  readonly pluginSettings: ReadonlyMap<string, ClientSettings.Connected<JSX.Element>>;
  readonly activity?: Stream.Stream<ReadonlyArray<RuntimeActivity.Event>, unknown>;
  readonly replayEvent?: (eventId: string) => Effect.Effect<void, unknown>;
}

export type PluginSettingsDescriptor = ClientSettings.Descriptor<JSX.Element>;

export interface EditorSettingsContext {
  readonly client: () => EditorRpcClient | null;
  readonly refreshPluginData: (pluginId?: string) => Promise<void>;
}

export interface EditorProps {
  readonly controller: EditorController;
  readonly renderProjectSettings?: (context: EditorSettingsContext) => JSX.Element;
}

export function Editor(props: EditorProps) {
  return (
    <Errored
      fallback={(error, reset) => {
        console.error("The editor encountered an unexpected error", error());
        return (
          <div sx={styles.errorPage}>
            <div role="alert" sx={styles.errorCard}>
              <div sx={styles.errorIcon}>
                <span sx={styles.errorMark} aria-hidden="true">
                  !
                </span>
              </div>
              <h1 sx={styles.errorTitle}>The editor ran into an error</h1>
              <p sx={styles.errorDescription}>
                Your project data is safe. Try reopening the editor, or reload the page if the error
                continues.
              </p>
              <div sx={styles.errorActions}>
                <Button type="button" variant="primary" onClick={reset}>
                  Reopen editor
                </Button>
                <Button type="button" onClick={() => location.reload()}>
                  Reload page
                </Button>
              </div>
            </div>
          </div>
        );
      }}
    >
      <Show when={props.controller} keyed>
        {(controller) => EditorContent(controller, () => props.renderProjectSettings)}
      </Show>
    </Errored>
  );
}

function EditorContent(
  controller: EditorController,
  renderProjectSettings: () => EditorProps["renderProjectSettings"],
) {
  let editorRoot: HTMLDivElement | undefined;
  const canvas = createEditorCanvas({
    editor: controller.editor,
    client: controller.connection.client,
    canEdit: controller.connection.canEdit,
    publishPointer: controller.presence.publishPointer,
    selectedGraphId: controller.layout.selectedGraphId,
    selectedGraph: controller.layout.selectedGraph,
    nodes: controller.layout.nodes,
    selectedNodeIds: controller.layout.selectedNodeIds,
    setSelectedNodeIds: controller.layout.setSelectedNodeIds,
    canvasScale: controller.layout.canvasScale,
    setCanvasScale: controller.layout.setCanvasScale,
    canvasOrigin: controller.layout.canvasOrigin,
    setCanvasOrigin: controller.layout.setCanvasOrigin,
  });
  createEditorShortcuts(() => editorRoot, controller.layout, canvas, controller.commands);

  const workspaceTabTitle = (tab: WorkspaceTab) => {
    if (tab.type === "graph")
      return {
        id: tab.id,
        title: controller.editor.store.project?.graphs[tab.graphId]?.name ?? tab.graphId,
      };
    if (tab.type === "package")
      return {
        id: tab.id,
        title:
          controller.editor.store.packages.find((pkg) => pkg.id === tab.packageId)?.name ??
          tab.packageId,
        description: "Plugin",
      };
    return {
      id: tab.id,
      title: "Settings",
      icon: <SettingsTabIcon />,
    };
  };

  const renderWorkspacePreview = (tab: WorkspaceTab) => {
    if (tab.type === "package") {
      const pkg = () =>
        controller.editor.store.packages.find((candidate) => candidate.id === tab.packageId);
      return (
        <Show when={pkg()} fallback={<EmptyContext />}>
          {(value) => (
            <PluginSettingsView
              package={value()}
              settings={controller.connection.pluginSettingsById().get(value().id)}
              data={controller.connection.pluginData.metadata()}
              state={() => controller.connection.pluginData.states.get(value().id)?.()}
              onChanged={() => controller.connection.refreshPluginData(value().id)}
            />
          )}
        </Show>
      );
    }
    if (tab.type === "settings")
      return (
        renderProjectSettings()?.({
          client: controller.connection.client,
          refreshPluginData: controller.connection.refreshPluginData,
        }) ?? <EmptyContext />
      );
    return <EmptyContext />;
  };

  return (
    <div ref={editorRoot} sx={styles.editor}>
      <div
        sx={[
          styles.loadingOverlay,
          controller.connection.editorReady() ? styles.hiddenOverlay : null,
        ]}
        aria-hidden={controller.connection.editorReady() ? "true" : "false"}
      >
        <span sx={styles.loadingLabel}>
          {controller.connection.connectionState.mode.status === "failed"
            ? "Unable to connect to editor"
            : controller.connection.client() === null
              ? "Connecting to editor"
              : "Loading project"}
        </span>
      </div>
      <div
        sx={[
          styles.editorContent,
          controller.connection.editorReady() ? null : styles.hiddenContent,
        ]}
      >
        <Show when={controller.connection.reconnecting()}>
          <div sx={styles.reconnecting}>Reconnecting...</div>
        </Show>

        <Show
          when={
            controller.connection.client() ?? (controller.connection.reconnecting() ? true : null)
          }
          fallback={<LoadingState label="Connecting to editor" style={styles.fill} />}
        >
          <div
            sx={[
              styles.workspace,
              controller.connection.reconnecting() ? styles.workspaceDivider : null,
            ]}
          >
            <Show when={!controller.layout.paneZoomed() ? controller.layout.navSection() : null}>
              {(section) => (
                <NavigationSidebar
                  section={section()}
                  search={controller.catalog.navSearch()}
                  selectedPaneId={controller.layout.selectedPaneId()}
                  graphs={controller.catalog.filteredGraphs()}
                  packagesWithSettings={controller.catalog.filteredPackagesWithSettings()}
                  packagesWithoutSettings={controller.catalog.filteredPackagesWithoutSettings()}
                  allPackages={controller.editor.store.packages}
                  constants={controller.editor.store.project?.constants ?? {}}
                  typesPanel={
                    <TypeDefinitions
                      project={controller.editor.store.project}
                      search={controller.catalog.navSearch()}
                      canEdit={controller.connection.canEdit()}
                      onPreview={controller.commands.previewTypeDefinition}
                      onConfirm={controller.commands.confirmTypeDefinition}
                    />
                  }
                  onSectionChange={controller.layout.setNavSection}
                  onSearchChange={controller.catalog.setNavSearch}
                  onClose={() => controller.layout.setNavSection(null)}
                  onCreateGraph={controller.commands.createGraph}
                  onSelectGraph={controller.layout.setSelectedGraphId}
                  canEditGraphs={controller.connection.canEdit()}
                  onRenameGraph={controller.commands.renameGraphById}
                  onDeleteGraph={controller.commands.deleteGraph}
                  onOpenPackage={controller.layout.openPackage}
                  onCreateConstant={controller.commands.createConstant}
                  onRenameConstant={controller.commands.renameConstant}
                  onSelectConstant={controller.commands.selectConstant}
                  onDeleteConstant={controller.commands.deleteConstant}
                  resourceDefinition={controller.catalog.resourceDefinition}
                  valuesFor={controller.catalog.valuesFor}
                />
              )}
            </Show>

            <Show when={controller.layout.navSection() === null && !controller.layout.paneZoomed()}>
              <button
                type="button"
                sx={[styles.focusRing, styles.mobilePill, styles.leftPill]}
                title={`Toggle navigation (${shortcutLabel("toggle-navigation")})`}
                onClick={controller.layout.toggleNavigation}
              >
                Browse
              </button>
            </Show>

            <main sx={[styles.main, controller.layout.paneZoomed() ? styles.zoomedMain : null]}>
              <WorkspacePanes
                state={controller.layout.workspace()}
                mobile={controller.layout.isMobile()}
                title={workspaceTabTitle}
                dispatch={controller.layout.dispatchWorkspace}
                onActivate={controller.layout.activateWorkspacePane}
                renderPreview={renderWorkspacePreview}
                renderGraph={(tab, paneId) => {
                  const active = () =>
                    controller.layout.workspace().focusedPaneId === paneId &&
                    selectedWorkspaceTab(controller.layout.workspace(), paneId)?.id === tab().id;
                  const scale = () =>
                    active() ? controller.layout.canvasScale() : tab().view.scale;
                  const origin = () =>
                    active() ? controller.layout.canvasOrigin() : tab().view.origin;
                  const selectedIds = () =>
                    active() ? controller.layout.selectedNodeIds() : tab().view.selectedNodeIds;
                  // Pane contents belong to the tab, not the globally focused graph.
                  const graph = () => controller.editor.store.project?.graphs[tab().graphId];
                  const nodes = createMemo(() => Object.values(graph()?.nodes ?? {}));
                  const ioForNode = (nodeId: string) =>
                    controller.editor.store.nodeIO[tab().graphId]?.[nodeId];
                  const edges = createMemo(() => {
                    const value = graph();
                    return value === undefined ? [] : graphConnections(value, ioForNode);
                  });
                  const remotePresence = () =>
                    controller.connection
                      .presenceClients()
                      .filter(
                        (entry) =>
                          entry.connectionId !== controller.connection.selfConnectionId() &&
                          entry.activeGraph === tab().graphId,
                      );
                  const connectionPreview = () =>
                    active() ? canvas.connectionPreview() : undefined;
                  const connectionDrag = () => (active() ? canvas.connectionDrag() : undefined);
                  const isNodeDragging = (nodeId: string) =>
                    active() && canvas.isNodeDragging(nodeId);
                  const grid = () => canvas.gridForScale(scale());
                  return (
                    <div sx={styles.graphPane}>
                      <div
                        ref={(element) => {
                          canvas.setGraphCanvas(element);
                          element.addEventListener(
                            "pointerdown",
                            () => {
                              canvas.setGraphCanvas(element);
                            },
                            { capture: true },
                          );
                        }}
                        sx={styles.canvas}
                        data-active-graph-canvas={active() ? "" : undefined}
                        style={{
                          "background-position": `${-origin().x * scale() - grid().coarseSpacing / 2}px ${-origin().y * scale() - grid().coarseSpacing / 2}px`,
                          "background-size": `${grid().coarseSpacing}px ${grid().coarseSpacing}px`,
                        }}
                        onPointerMove={(event) => {
                          // The window drag listener owns cursor updates during a node drag.
                          if (!active() || canvas.isDragging()) return;
                          canvas.setGraphCanvas(event.currentTarget);
                          if (
                            event.pointerType === "touch" ||
                            controller.layout.selectedGraphId() === null
                          )
                            return;
                          controller.presence.publishPointer(
                            canvas.canvasPosition(event.clientX, event.clientY),
                          );
                        }}
                        onPointerLeave={() => {
                          if (active()) controller.presence.publishPointer(null, true);
                        }}
                        onWheel={(event) => {
                          canvas.setGraphCanvas(event.currentTarget);
                          canvas.onWheel(event);
                        }}
                        onPointerDown={canvas.onCanvasPointerDown}
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        <For each={[grid().fineLevel]}>
                          {() => (
                            <div
                              sx={styles.gridAdditions}
                              style={{
                                opacity: grid().additionalOpacity,
                                "background-position": `${-origin().x * scale() + grid().fineSpacing - grid().coarseSpacing / 2}px ${-origin().y * scale() - grid().coarseSpacing / 2}px, ${-origin().x * scale() - grid().coarseSpacing / 2}px ${-origin().y * scale() + grid().fineSpacing - grid().coarseSpacing / 2}px, ${-origin().x * scale() + grid().fineSpacing - grid().coarseSpacing / 2}px ${-origin().y * scale() + grid().fineSpacing - grid().coarseSpacing / 2}px`,
                                "background-size": `${grid().coarseSpacing}px ${grid().coarseSpacing}px`,
                              }}
                            />
                          )}
                        </For>
                        <Show
                          when={
                            controller.connection.selfPresence() && !controller.connection.canEdit()
                          }
                        >
                          <div sx={styles.readOnly}>Read only</div>
                        </Show>
                        <Show
                          when={graph()}
                          fallback={
                            <div sx={styles.emptyGraph}>
                              {controller.layout.graphs().length === 0
                                ? "Create a graph to begin"
                                : "Select a graph"}
                            </div>
                          }
                        >
                          <div
                            sx={[styles.canvasLayer, styles.scaledLayer]}
                            style={{ transform: `scale(${scale()})` }}
                          >
                            <div
                              sx={styles.canvasLayer}
                              style={{
                                transform: `translate(${-origin().x}px, ${-origin().y}px)`,
                              }}
                            >
                              <svg sx={[styles.canvasLayer, styles.wires]} aria-hidden="true">
                                <For each={edges()} keyed={(edge) => edge.connection.id}>
                                  {(edge) => (
                                    <path
                                      sx={
                                        !isNodeDragging(edge().connection.outNodeId) &&
                                        !isNodeDragging(edge().connection.inNodeId) &&
                                        styles.smoothWire
                                      }
                                      d={connectionPath(edge().from, edge().to)}
                                      fill="none"
                                      stroke={wireColor(edge().type)}
                                      stroke-width="2"
                                      opacity="0.75"
                                    />
                                  )}
                                </For>
                                <Show when={connectionPreview()} keyed>
                                  {(drag) => (
                                    <path
                                      d={connectionPath(
                                        drag.source.direction === "output"
                                          ? drag.source.position
                                          : (drag.target?.position ?? drag.pointer),
                                        drag.source.direction === "input"
                                          ? drag.source.position
                                          : (drag.target?.position ?? drag.pointer),
                                      )}
                                      fill="none"
                                      stroke={wireColor(
                                        drag.source.port.kind === "data"
                                          ? drag.source.port.type
                                          : undefined,
                                      )}
                                      stroke-width="2"
                                      opacity="0.375"
                                    />
                                  )}
                                </Show>
                              </svg>
                              <For each={nodes()} keyed={(node) => node.id}>
                                {(node) => (
                                  <GraphNode
                                    node={node()}
                                    schema={canvas.schemaForNode(node())}
                                    io={ioForNode(node().id)}
                                    definitions={controller.editor.store.project?.types ?? {}}
                                    diagnostics={TypeDefinition.nodeDiagnostics(
                                      node(),
                                      ioForNode(node().id) ?? {
                                        dataInputs: [],
                                        dataOutputs: [],
                                        executionInputs: [],
                                        executionOutputs: [],
                                      },
                                      controller.editor.store.project?.types ?? {},
                                    )}
                                    selected={selectedIds().includes(node().id)}
                                    dragging={isNodeDragging(node().id)}
                                    positioning={
                                      active() && controller.commands.isNodePositioning(node().id)
                                    }
                                    presenceColor={
                                      remotePresence().find((entry) =>
                                        entry.selectedNodeIds.includes(node().id),
                                      )?.color
                                    }
                                    connectionSource={
                                      connectionPreview() === undefined
                                        ? undefined
                                        : {
                                            nodeId: connectionPreview()!.source.nodeId,
                                            ioId: connectionPreview()!.source.port.id,
                                            kind: connectionPreview()!.source.port.kind,
                                            direction: connectionPreview()!.source.direction,
                                            dragging: connectionDrag() !== undefined,
                                          }
                                    }
                                    snapTarget={
                                      connectionDrag()?.target === undefined
                                        ? undefined
                                        : {
                                            nodeId: connectionDrag()!.target!.nodeId,
                                            ioId: connectionDrag()!.target!.port.id,
                                            kind: connectionDrag()!.target!.port.kind,
                                            direction: connectionDrag()!.target!.direction,
                                          }
                                    }
                                    onSelect={canvas.selectNode}
                                    onDragStart={canvas.onNodeMouseDown}
                                    onPortPointerDown={canvas.startConnection}
                                    onDisconnect={controller.commands.disconnectIo}
                                    onContextMenu={(event, nodeId) => {
                                      canvas.selectNode(nodeId, false);
                                      canvas.setNodeContextMenu({
                                        nodeId,
                                        screen: {
                                          x: event.clientX,
                                          y: event.clientY,
                                        },
                                      });
                                    }}
                                    onExpand={(nodeId) =>
                                      controller.commands.setNodeFoldPins(nodeId, false)
                                    }
                                    connectedInputIds={connectedPortIds(
                                      graph()!,
                                      node().id,
                                      "input",
                                    )}
                                    connectedOutputIds={connectedPortIds(
                                      graph()!,
                                      node().id,
                                      "output",
                                    )}
                                    onSetInputDefault={(input, value) =>
                                      void controller.commands
                                        .setInputDefault(node().id, input, value)
                                        .catch(console.error)
                                    }
                                    onClearInputDefault={(input) =>
                                      void controller.commands
                                        .clearInputDefault(node().id, input)
                                        .catch(console.error)
                                    }
                                    onGetSuggestions={(input) =>
                                      controller.commands.getInputSuggestions(node().id, input)
                                    }
                                  />
                                )}
                              </For>
                              <For each={remotePresence()} keyed={(entry) => entry.connectionId}>
                                {(entry) => (
                                  <Show when={entry().cursor}>
                                    {(cursor) => (
                                      <div
                                        sx={styles.remoteCursor}
                                        style={{
                                          transform: `translate(${cursor().x}px, ${cursor().y}px)`,
                                          color: entry().color,
                                        }}
                                      >
                                        <svg
                                          sx={styles.cursorIcon}
                                          viewBox="0 0 16 16"
                                          fill="currentColor"
                                        >
                                          <path d="M1 1l11 5-5 2-2 5z" />
                                        </svg>
                                        <span
                                          sx={styles.cursorLabel}
                                          style={{
                                            "background-color": entry().color,
                                          }}
                                        >
                                          {entry().displayName}
                                        </span>
                                      </div>
                                    )}
                                  </Show>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>
                        <Show when={active() && canvas.selectionRect()}>
                          {(rect) => {
                            const bounds = () => canvas.graphCanvas()?.getBoundingClientRect();
                            return (
                              <div
                                sx={styles.selection}
                                style={{
                                  width: `${Math.abs(rect().current.x - rect().start.x)}px`,
                                  height: `${Math.abs(rect().current.y - rect().start.y)}px`,
                                  transform: `translate(${Math.min(rect().start.x, rect().current.x) - (bounds()?.left ?? 0)}px, ${Math.min(rect().start.y, rect().current.y) - (bounds()?.top ?? 0)}px)`,
                                }}
                              />
                            );
                          }}
                        </Show>
                        <Show
                          when={
                            active() &&
                            canvas.nodeMenuPresence.present() &&
                            canvas.presentNodeMenu()
                          }
                        >
                          {(menu) => (
                            <NodeCreationMenu
                              ref={canvas.setNodeMenuElement}
                              hiding={canvas.nodeMenuPresence.state() === "hiding"}
                              packages={controller.editor.store.packages}
                              schemaFilter={(schema) =>
                                menu().source === undefined ||
                                compatibleSchemaPorts(schema, menu().source!).length > 0
                              }
                              screenPosition={menu().screen}
                              onClose={() => canvas.setNodeMenu(undefined)}
                              onCreate={(schema, name) =>
                                canvas.createNodeFromMenu((menu) =>
                                  controller.commands.createNode(
                                    schema,
                                    name,
                                    menu.graph,
                                    menu.source,
                                    menu.shiftKey,
                                  ),
                                )
                              }
                            />
                          )}
                        </Show>
                        <Show when={active() && canvas.nodeContextMenu()}>
                          {(menu) => (
                            <div
                              sx={styles.contextMenu}
                              style={{
                                left: `${menu().screen.x}px`,
                                top: `${menu().screen.y}px`,
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                sx={[styles.focusRing, styles.contextAction]}
                                onClick={() => {
                                  const node =
                                    controller.layout.selectedGraph()?.nodes[menu().nodeId];
                                  if (node)
                                    controller.commands.setNodeFoldPins(node.id, !node.foldPins);
                                  canvas.setNodeContextMenu(undefined);
                                }}
                              >
                                {controller.layout.selectedGraph()?.nodes[menu().nodeId]?.foldPins
                                  ? "Expand"
                                  : "Collapse"}
                              </button>
                              <button
                                type="button"
                                sx={[styles.focusRing, styles.contextAction]}
                                onClick={() => {
                                  controller.layout
                                    .selectedNodeIds()
                                    .forEach(controller.commands.deleteNode);
                                  canvas.setNodeContextMenu(undefined);
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </Show>
                      </div>
                    </div>
                  );
                }}
              />
            </main>

            <Show when={!controller.layout.inspectorOpen()}>
              <button
                type="button"
                sx={[styles.focusRing, styles.mobilePill, styles.rightPill]}
                title={`Toggle inspector (${shortcutLabel("toggle-inspector")})`}
                onClick={() => controller.layout.setInspectorOpen(true)}
              >
                Inspect
              </button>
            </Show>

            <Sidebar
              side="right"
              open={controller.layout.inspectorOpen()}
              onClose={() => controller.layout.setInspectorOpen(false)}
            >
              <Inspector
                graph={controller.layout.selectedGraph()}
                node={controller.layout.selectedNode()}
                packages={controller.editor.store.packages}
                constants={controller.editor.store.project?.constants ?? {}}
                definitions={controller.editor.store.project?.types ?? {}}
                nodeIO={
                  controller.editor.store.nodeIO[controller.layout.selectedGraphId() ?? ""] ?? {}
                }
                onSaveDefault={controller.commands.setInputDefault}
                onRemoveDefault={controller.commands.clearInputDefault}
                canEdit={controller.connection.canEdit()}
                editingGraphNameId={controller.commands.editingGraphNameId()}
                onEditingGraphNameChange={(id) =>
                  controller.commands.setEditingName(id === null ? null : { type: "graph", id })
                }
                onRenameGraph={controller.commands.renameGraph}
                editingNodeNameId={controller.commands.editingNodeNameId()}
                onEditingNodeNameChange={(id) =>
                  controller.commands.setEditingName(id === null ? null : { type: "node", id })
                }
                onRenameNode={controller.commands.renameNode}
                onSetNodeProperty={controller.commands.setNodeProperty}
                onClearNodeProperty={controller.commands.clearNodeProperty}
              />
            </Sidebar>
          </div>
          <ShortcutsHelp />
        </Show>
      </div>
    </div>
  );
}
