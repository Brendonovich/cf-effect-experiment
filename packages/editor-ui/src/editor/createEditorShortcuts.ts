import { onSettled } from "solid-js";

import type { createEditorCanvas } from "./graph/createEditorCanvas";
import type { createEditorCommands } from "./createEditorCommands";
import type { createEditorWorkspace } from "./workspace/createEditorWorkspace";

import { foldSelectedPins } from "./graph/connectionAuthoring";
import { registerEditorShortcuts } from "./shortcuts";
import { selectedTab as selectedWorkspaceTab, workspaceReducer } from "./workspace/workspace";

export function createEditorShortcuts(
  rootElement: () => HTMLDivElement | undefined,
  layout: ReturnType<typeof createEditorWorkspace>,
  canvas: ReturnType<typeof createEditorCanvas>,
  commands: Pick<ReturnType<typeof createEditorCommands>, "deleteNode" | "setNodeFoldPins">,
) {
  const {
    workspace,
    setWorkspace,
    dispatchWorkspace,
    activateWorkspacePane,
    isMobile,
    paneZoomed,
    setPaneZoomed,
    toggleNavigation,
    setInspectorOpen,
    selectedNodeIds,
    selectedGraph,
    setCanvasOrigin,
    setCanvasScale,
  } = layout;
  const {
    isDragging,
    cancelNodeDrag,
    connectionDrag,
    cancelConnection,
    nodeMenu,
    setNodeMenu,
    nodeContextMenu,
    setNodeContextMenu,
  } = canvas;
  const { deleteNode, setNodeFoldPins } = commands;

  onSettled(() => {
    const root = rootElement();
    if (root === undefined) return;
    let pointer: { x: number; y: number } | undefined;
    const trackPointer = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    root.addEventListener("pointermove", trackPointer);
    const dispose = registerEditorShortcuts(root, (shortcut) => {
      const paneId = workspace().focusedPaneId;
      const tab = selectedWorkspaceTab(workspace());
      if ((shortcut === "split-horizontal" || shortcut === "split-vertical") && isMobile())
        return false;
      switch (shortcut) {
        case "cancel":
          if (isDragging()) cancelNodeDrag();
          else if (connectionDrag() !== undefined) {
            cancelConnection();
            setNodeMenu(undefined);
          } else if (nodeMenu() !== undefined || nodeContextMenu() !== undefined) {
            setNodeMenu(undefined);
            setNodeContextMenu(undefined);
          } else if (paneZoomed()) setPaneZoomed(false);
          else return false;
          return true;
        case "toggle-navigation":
          toggleNavigation();
          return true;
        case "toggle-inspector":
          setInspectorOpen((open) => !open);
          return true;
        case "previous-tab":
        case "next-tab": {
          if (tab === undefined) return false;
          const next = workspaceReducer(workspace(), {
            type: "cycle-tab",
            delta: shortcut === "previous-tab" ? -1 : 1,
          });
          setWorkspace(next);
          queueMicrotask(() => activateWorkspacePane(next.focusedPaneId));
          return true;
        }
        case "close-tab":
          if (tab === undefined) return false;
          dispatchWorkspace({ type: "close-tab", paneId, tabId: tab.id });
          queueMicrotask(() => activateWorkspacePane(workspace().focusedPaneId));
          return true;
        case "split-horizontal":
        case "split-vertical":
          if (tab === undefined) return false;
          dispatchWorkspace({
            type: "split-pane",
            paneId,
            direction: shortcut === "split-horizontal" ? "horizontal" : "vertical",
          });
          queueMicrotask(() => activateWorkspacePane(workspace().focusedPaneId));
          return true;
        case "toggle-pins":
        case "fold-pins":
        case "expand-pins": {
          if (tab?.type !== "graph" || selectedNodeIds().length === 0) return false;
          const foldPins =
            shortcut === "fold-pins" ||
            (shortcut === "toggle-pins" &&
              foldSelectedPins(
                selectedNodeIds().map(
                  (nodeId) => selectedGraph()?.nodes[nodeId]?.foldPins === true,
                ),
              ));
          selectedNodeIds().forEach((nodeId) => {
            const node = selectedGraph()?.nodes[nodeId];
            if (node !== undefined && node.foldPins !== foldPins) setNodeFoldPins(nodeId, foldPins);
          });
          return true;
        }
        case "create-node": {
          if (tab?.type !== "graph" || isDragging() || connectionDrag() !== undefined) return false;
          const element = root.querySelector<HTMLDivElement>("[data-active-graph-canvas]");
          if (element === null) return false;
          const bounds = element.getBoundingClientRect();
          const screen =
            pointer !== undefined &&
            pointer.x >= bounds.left &&
            pointer.x <= bounds.right &&
            pointer.y >= bounds.top &&
            pointer.y <= bounds.bottom
              ? pointer
              : { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
          canvas.setGraphCanvas(element);
          setNodeMenu({ screen, graph: canvas.canvasPosition(screen.x, screen.y) });
          return true;
        }
        case "delete-selection":
          if (
            tab?.type !== "graph" ||
            selectedNodeIds().length === 0 ||
            isDragging() ||
            connectionDrag() !== undefined
          )
            return false;
          selectedNodeIds().forEach(deleteNode);
          return true;
        case "toggle-pane-zoom":
          if (tab === undefined) return false;
          dispatchWorkspace({ type: "toggle-zoom", paneId });
          return true;
        case "reset-view":
          if (tab?.type !== "graph") return false;
          setCanvasOrigin({ x: 0, y: 0 });
          setCanvasScale(1);
          return true;
      }
    });
    return () => {
      dispose();
      root.removeEventListener("pointermove", trackPointer);
    };
  });
}
