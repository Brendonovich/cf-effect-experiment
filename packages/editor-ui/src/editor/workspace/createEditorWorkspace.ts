import { createEffect, createSignal, onSettled, untrack } from "solid-js";

import type { EditorControllerOptions } from "../createEditorController";
import type { createEditorStore } from "../store";

import { createStateMachine } from "../../ui/createStateMachine";
import {
  createWorkspaceState,
  loadWorkspaceState,
  saveWorkspaceState,
  selectedTab as selectedWorkspaceTab,
  workspaceReducer,
  workspaceStorageKey,
  type GraphTab,
  type WorkspaceAction,
  type WorkspaceState,
  type WorkspaceTab,
} from "./workspace";

type EditorStore = ReturnType<typeof createEditorStore>;

export function createEditorWorkspace(
  props: Pick<EditorControllerOptions, "workspaceId" | "userId" | "projectSettings">,
  editor: EditorStore,
  onGraphLeave: () => void,
) {
  const { store } = editor;
  const mobileMedia = matchMedia("(max-width: 767px)");
  const [isMobile, setIsMobile] = createSignal(mobileMedia.matches);
  onSettled(() => {
    const update = () => setIsMobile(mobileMedia.matches);
    mobileMedia.addEventListener("change", update);
    return () => mobileMedia.removeEventListener("change", update);
  });
  const [layoutStorageKey] = createSignal(() =>
    workspaceStorageKey(props.workspaceId, props.userId),
  );
  const [workspace, setWorkspace] = createSignal<WorkspaceState>(() => {
    const state = loadWorkspaceState(localStorage, layoutStorageKey(), () =>
      createWorkspaceState(props.projectSettings === true ? { type: "settings" } : undefined),
    );
    if (props.projectSettings === true) return state;
    return Object.values(state.panes).reduce(
      (current, pane) =>
        pane.tabs.reduce(
          (next, tab) =>
            tab.type === "settings"
              ? workspaceReducer(next, {
                  type: "close-tab",
                  paneId: pane.id,
                  tabId: tab.id,
                })
              : next,
          current,
        ),
      state,
    );
  });
  const dispatchWorkspace = (action: WorkspaceAction) =>
    setWorkspace((state) => workspaceReducer(state, action));
  createEffect(
    () => ({ key: layoutStorageKey(), state: workspace() }),
    ({ key, state }) => {
      saveWorkspaceState(localStorage, key, state);
    },
  );
  const initialWorkspace = untrack(workspace);
  const initialWorkspaceTab = selectedWorkspaceTab(initialWorkspace);
  const initialGraphTab: GraphTab | undefined =
    initialWorkspaceTab?.type === "graph" ? initialWorkspaceTab : undefined;
  const [activeWorkspaceView, setActiveWorkspaceView] = createSignal<
    WorkspaceTab | { readonly type: "empty" }
  >(initialWorkspaceTab ?? { type: "empty" });
  const [selectedGraphId, setSelectedGraphIdRaw] = createSignal<string | null>(
    initialGraphTab?.graphId ?? null,
  );
  type MobilePanelState = {
    readonly context: { section: NonNullable<WorkspaceState["navSection"]> };
    mode: "closed" | "navigation" | "inspector";
  };
  const [mobilePanel, mobilePanelActions] = createStateMachine(
    {
      context: { section: initialWorkspace.navSection ?? "graphs" },
      mode: "closed",
    } as MobilePanelState,
    {
      navigate(state, section: NonNullable<WorkspaceState["navSection"]>) {
        state.context.section = section;
        state.mode = "navigation";
      },
      inspect(state) {
        state.mode = "inspector";
      },
      close(state) {
        state.mode = "closed";
      },
    },
  );
  const navSection = (): WorkspaceState["navSection"] => {
    if (!isMobile()) return workspace().navSection;
    return mobilePanel.mode === "navigation" ? mobilePanel.context.section : null;
  };
  let lastNavSection = initialWorkspace.navSection ?? "graphs";
  const setNavSection = (
    next:
      | WorkspaceState["navSection"]
      | ((current: WorkspaceState["navSection"]) => WorkspaceState["navSection"]),
  ) => {
    const section = typeof next === "function" ? next(navSection()) : next;
    if (section !== null) lastNavSection = section;
    if (isMobile()) {
      if (section === null) mobilePanelActions.close();
      else mobilePanelActions.navigate(section);
    } else dispatchWorkspace({ type: "set-nav-section", section });
  };
  const toggleNavigation = () => setNavSection(navSection() === null ? lastNavSection : null);
  const [selectedNodeIds, setSelectedNodeIds] = createSignal<string[]>([
    ...(initialGraphTab?.view.selectedNodeIds ?? []),
  ]);
  const selectedNodeId = () => selectedNodeIds().at(-1) ?? null;
  const [canvasScale, setCanvasScale] = createSignal(initialGraphTab?.view.scale ?? 1);
  const [canvasOrigin, setCanvasOrigin] = createSignal(
    initialGraphTab?.view.origin ?? { x: 0, y: 0 },
  );
  const paneZoomed = () => workspace().zoomedPaneId !== null;
  const setPaneZoomed = (next: boolean | ((current: boolean) => boolean)) => {
    const desired = typeof next === "function" ? next(paneZoomed()) : next;
    if (desired !== paneZoomed())
      dispatchWorkspace({
        type: "toggle-zoom",
        paneId: workspace().focusedPaneId,
      });
  };
  const inspectorOpen = () =>
    isMobile() ? mobilePanel.mode === "inspector" : workspace().inspectorOpen;
  const setInspectorOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const open = typeof next === "function" ? next(inspectorOpen()) : next;
    if (isMobile()) {
      if (open) mobilePanelActions.inspect();
      else mobilePanelActions.close();
    } else dispatchWorkspace({ type: "set-inspector-open", open });
  };
  createEffect(
    () => isMobile(),
    () => {
      mobilePanelActions.close();
    },
  );
  createEffect(
    () => ({
      graphId: selectedGraphId(),
      view: {
        origin: canvasOrigin(),
        scale: canvasScale(),
        selectedNodeIds: selectedNodeIds(),
        selectedNodeId: selectedNodeId(),
      },
    }),
    ({ graphId, view }) => {
      const activeView = untrack(activeWorkspaceView);
      if (activeView.type !== "graph") return;
      const tab = Object.values(untrack(workspace).panes)
        .flatMap((pane) => pane.tabs)
        .find((candidate) => candidate.id === activeView.id);
      if (tab?.type !== "graph" || tab.graphId !== graphId) return;
      if (
        tab.view.scale !== view.scale ||
        tab.view.origin.x !== view.origin.x ||
        tab.view.origin.y !== view.origin.y ||
        tab.view.selectedNodeId !== view.selectedNodeId ||
        tab.view.selectedNodeIds.join("\0") !== view.selectedNodeIds.join("\0")
      )
        dispatchWorkspace({ type: "set-graph-view", tabId: tab.id, view });
    },
  );
  const setSelectedGraphId = (id: string | null) => {
    if (selectedGraphId() !== id) {
      const activeView = activeWorkspaceView();
      if (activeView.type === "graph")
        dispatchWorkspace({
          type: "set-graph-view",
          tabId: activeView.id,
          view: {
            origin: canvasOrigin(),
            scale: canvasScale(),
            selectedNodeIds: selectedNodeIds(),
            selectedNodeId: selectedNodeId(),
          },
        });
      onGraphLeave();
    }
    if (id !== null) {
      dispatchWorkspace({
        type: "open-tab",
        tab: { type: "graph", graphId: id },
      });
      queueMicrotask(() => activateWorkspacePane(workspace().focusedPaneId));
    } else setSelectedGraphIdRaw(null);
  };

  const activateWorkspacePane = (paneId: string) => {
    let next = workspace();
    const activeView = activeWorkspaceView();
    if (activeView.type === "graph") {
      next = workspaceReducer(next, {
        type: "set-graph-view",
        tabId: activeView.id,
        view: {
          origin: canvasOrigin(),
          scale: canvasScale(),
          selectedNodeIds: selectedNodeIds(),
          selectedNodeId: selectedNodeId(),
        },
      });
    }
    next = workspaceReducer(next, { type: "focus-pane", paneId });
    setWorkspace(next);
    const tab = selectedWorkspaceTab(next, paneId);
    setActiveWorkspaceView(tab ?? { type: "empty" });
    if (tab?.type === "graph") {
      setSelectedGraphIdRaw(tab.graphId);
      setCanvasOrigin(tab.view.origin);
      setCanvasScale(tab.view.scale);
      setSelectedNodeIds([...tab.view.selectedNodeIds]);
    } else if (tab?.type === "package") {
      setSelectedGraphIdRaw(null);
      setSelectedNodeIds([]);
    } else if (tab?.type === "settings") {
      onGraphLeave();
      setSelectedGraphIdRaw(null);
      setSelectedNodeIds([]);
    } else {
      onGraphLeave();
      setSelectedGraphIdRaw(null);
      setSelectedNodeIds([]);
    }
  };
  createEffect(
    () => {
      const project = store.project;
      if (project === null) return [];
      return Object.values(workspace().panes).flatMap((pane) =>
        pane.tabs
          .filter((tab) => tab.type === "graph" && project.graphs[tab.graphId] === undefined)
          .map((tab) => ({ paneId: pane.id, tabId: tab.id })),
      );
    },
    (missingTabs) => {
      if (missingTabs.length === 0) return;
      setWorkspace((state) =>
        missingTabs.reduce(
          (current, { paneId, tabId }) =>
            workspaceReducer(current, { type: "close-tab", paneId, tabId }),
          state,
        ),
      );
      queueMicrotask(() => activateWorkspacePane(workspace().focusedPaneId));
    },
  );
  const openProjectSettings = (paneId: string) => {
    if (props.projectSettings !== true) return;
    setWorkspace((state) =>
      workspaceReducer(state, {
        type: "open-tab",
        paneId,
        tab: { type: "settings" },
      }),
    );
    queueMicrotask(() => activateWorkspacePane(paneId));
  };
  const openPackage = (packageId: string) => {
    dispatchWorkspace({
      type: "open-tab",
      tab: { type: "package", packageId },
    });
    queueMicrotask(() => activateWorkspacePane(workspace().focusedPaneId));
  };
  const openShortcuts = () => {
    dispatchWorkspace({ type: "open-tab", tab: { type: "shortcuts" } });
    queueMicrotask(() => activateWorkspacePane(workspace().focusedPaneId));
  };
  const onProjectSnapshot = (project: Parameters<EditorStore["setProject"]>[0]) => {
    const currentTab = selectedWorkspaceTab(workspace());
    const initialGraphId =
      currentTab?.type === "graph" && project.graphs[currentTab.graphId] !== undefined
        ? currentTab.graphId
        : Object.keys(project.graphs)[0];
    if (
      initialGraphId !== undefined &&
      currentTab?.type !== "package" &&
      currentTab?.type !== "settings" &&
      currentTab?.type !== "shortcuts"
    ) {
      dispatchWorkspace({
        type: "open-tab",
        tab: { type: "graph", graphId: initialGraphId },
      });
      setSelectedGraphIdRaw(initialGraphId);
    }
  };
  const graphs = () => {
    if (!store.project) return [];
    return Object.entries(store.project.graphs).sort(([a], [b]) => a.localeCompare(b));
  };
  const selectedGraph = () => {
    const id = selectedGraphId();
    if (!id || !store.project) return null;
    return store.project.graphs[id] ?? null;
  };
  const nodes = () => {
    const graph = selectedGraph();
    if (!graph) return [];
    return Object.values(graph.nodes);
  };
  const selectedNode = () => {
    const id = selectedNodeId();
    return id ? (selectedGraph()?.nodes[id] ?? null) : null;
  };
  createEffect(
    () => {
      const graph = selectedGraph();
      const selectedIds = selectedNodeIds();
      return {
        loaded: graph !== null,
        selectedIds,
        validIds: selectedIds.filter((id) => graph?.nodes[id] !== undefined),
      };
    },
    ({ loaded, selectedIds, validIds }) => {
      if (!loaded || validIds.length === selectedIds.length) return;
      setSelectedNodeIds(validIds);
    },
  );
  const selectedPaneId = () => {
    const tab = selectedWorkspaceTab(workspace());
    if (tab?.type === "graph") return `graph:${tab.graphId}`;
    if (tab?.type === "package") return `package:${tab.packageId}`;
    return tab?.type;
  };

  return {
    workspace,
    setWorkspace,
    dispatchWorkspace,
    activeWorkspaceView,
    selectedGraphId,
    setSelectedGraphIdRaw,
    setSelectedGraphId,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedNodeId,
    canvasScale,
    setCanvasScale,
    canvasOrigin,
    setCanvasOrigin,
    isMobile,
    mobilePanel,
    navSection,
    setNavSection,
    toggleNavigation,
    paneZoomed,
    setPaneZoomed,
    inspectorOpen,
    setInspectorOpen,
    activateWorkspacePane,
    openProjectSettings,
    openPackage,
    openShortcuts,
    selectedPaneId,
    graphs,
    selectedGraph,
    nodes,
    selectedNode,
    onProjectSnapshot,
  };
}
