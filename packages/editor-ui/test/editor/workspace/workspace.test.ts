import { describe, expect, it } from "vitest";

import {
  createWorkspaceState,
  loadWorkspaceState,
  maxWorkspaceStorageBytes,
  parseWorkspaceState,
  saveWorkspaceState,
  selectedTab,
  workspaceReducer,
  workspaceStorageKey,
  zoomOriginAt,
  type PaneTree,
} from "../../../src/editor/workspace/workspace";

const leaves = (tree: PaneTree): ReadonlyArray<string> =>
  tree.type === "pane" ? [tree.paneId] : [...leaves(tree.first), ...leaves(tree.second)];

describe("workspace reducer", () => {
  it("opens shortcuts once per pane and supports splitting, moving, persistence and closing", () => {
    let state = createWorkspaceState({ type: "graph", graphId: "main" });
    const firstPaneId = state.focusedPaneId;
    state = workspaceReducer(state, { type: "open-tab", tab: { type: "shortcuts" } });
    const shortcuts = selectedTab(state)!;
    state = workspaceReducer(state, { type: "open-tab", tab: { type: "shortcuts" } });
    expect(state.panes[firstPaneId]?.tabs.map((tab) => tab.type)).toEqual(["graph", "shortcuts"]);
    expect(selectedTab(state)).toEqual(shortcuts);

    state = workspaceReducer(state, {
      type: "split-pane",
      paneId: firstPaneId,
      direction: "horizontal",
    });
    const secondPaneId = state.focusedPaneId;
    const copy = selectedTab(state)!;
    expect(copy).toEqual({ id: expect.any(String), type: "shortcuts" });
    expect(copy.id).not.toBe(shortcuts.id);
    state = workspaceReducer(state, {
      type: "close-tab",
      paneId: firstPaneId,
      tabId: shortcuts.id,
    });
    expect(selectedTab(state, firstPaneId)?.type).toBe("graph");
    expect(parseWorkspaceState(JSON.stringify(state))).toEqual(state);

    state = workspaceReducer(state, {
      type: "move-tab",
      fromPaneId: secondPaneId,
      toPaneId: firstPaneId,
      tabId: copy.id,
    });
    expect(state.panes[secondPaneId]).toBeUndefined();
    expect(selectedTab(state)).toEqual(copy);
    state = workspaceReducer(state, { type: "cycle-tab", delta: -1 });
    expect(selectedTab(state)?.type).toBe("graph");
  });

  it("creates an empty workspace when no initial tab is provided", () => {
    const state = createWorkspaceState();
    expect(state.panes[state.focusedPaneId]).toMatchObject({ tabs: [], selectedTabId: null });
    expect(selectedTab(state)).toBeUndefined();
  });

  it("preserves state identity when focusing the focused pane", () => {
    const state = createWorkspaceState({ type: "settings" });
    expect(workspaceReducer(state, { type: "focus-pane", paneId: state.focusedPaneId })).toBe(state);
  });

  it("builds recursive splits with independent copied graph views", () => {
    let state = createWorkspaceState({ type: "graph", graphId: "main" });
    const firstPaneId = state.focusedPaneId;
    const firstTab = selectedTab(state)!;
    state = workspaceReducer(state, {
      type: "set-graph-view",
      tabId: firstTab.id,
      view: { origin: { x: 20, y: 30 }, scale: 1.5, selectedNodeIds: ["a"], selectedNodeId: "a" },
    });
    state = workspaceReducer(state, {
      type: "split-pane",
      paneId: state.focusedPaneId,
      direction: "horizontal",
    });
    expect(state.root.type).toBe("split");
    const copied = selectedTab(state)!;
    expect(copied.id).not.toBe(firstTab.id);
    expect(copied.type === "graph" && copied.view.origin).toEqual({ x: 20, y: 30 });
    state = workspaceReducer(state, {
      type: "set-graph-view",
      tabId: copied.id,
      view: { origin: { x: 0, y: 0 }, scale: 1, selectedNodeIds: [], selectedNodeId: null },
    });
    const original = selectedTab(state, firstPaneId);
    expect(original?.type === "graph" && original.view).toEqual({
      origin: { x: 20, y: 30 },
      scale: 1.5,
      selectedNodeIds: ["a"],
      selectedNodeId: "a",
    });
  });

  it("selects, cycles, moves, and closes tabs coherently", () => {
    let state = createWorkspaceState({ type: "graph", graphId: "main" });
    const pane = state.focusedPaneId;
    state = workspaceReducer(state, { type: "open-tab", tab: { type: "settings" } });
    const settings = selectedTab(state)!;
    state = workspaceReducer(state, { type: "cycle-tab", delta: -1 });
    expect(selectedTab(state)?.type).toBe("graph");
    state = workspaceReducer(state, { type: "close-tab", paneId: pane, tabId: settings.id });
    expect(state.panes[pane]?.tabs).toHaveLength(1);
  });

  it("moves a tab between panes and removes an emptied source pane", () => {
    let state = createWorkspaceState({ type: "graph", graphId: "main" });
    const sourcePane = state.focusedPaneId;
    const tab = selectedTab(state)!;
    state = workspaceReducer(state, {
      type: "split-pane",
      paneId: sourcePane,
      direction: "vertical",
    });
    const targetPane = state.focusedPaneId;
    state = workspaceReducer(state, {
      type: "move-tab",
      fromPaneId: sourcePane,
      toPaneId: targetPane,
      tabId: tab.id,
    });
    expect(state.panes[sourcePane]).toBeUndefined();
    expect(state.panes[targetPane]?.tabs.map((item) => item.id)).toContain(tab.id);
    expect(state.root).toEqual({ type: "pane", paneId: targetPane });
  });

  it("preserves focus when closing an unfocused pane and keeps recursive leaves in sync", () => {
    let state = createWorkspaceState({ type: "graph", graphId: "main" });
    const first = state.focusedPaneId;
    state = workspaceReducer(state, { type: "open-tab", paneId: first, tab: { type: "settings" } });
    const graph = state.panes[first]!.tabs.find((tab) => tab.type === "graph")!;
    state = workspaceReducer(state, { type: "split-pane", paneId: first, direction: "horizontal" });
    const focused = state.focusedPaneId;
    state = workspaceReducer(state, { type: "split-pane", paneId: focused, direction: "vertical" });
    const deepest = state.focusedPaneId;
    state = workspaceReducer(state, { type: "close-tab", paneId: first, tabId: graph.id });
    expect(state.focusedPaneId).toBe(deepest);
    expect(new Set(leaves(state.root))).toEqual(new Set(Object.keys(state.panes)));
  });

  it("focuses a pane when selecting its tab and closes selected and background tabs", () => {
    let state = createWorkspaceState({ type: "graph", graphId: "main" });
    const firstPaneId = state.focusedPaneId;
    state = workspaceReducer(state, { type: "open-tab", tab: { type: "settings" } });
    const settings = selectedTab(state)!;
    const graph = state.panes[firstPaneId]!.tabs.find((tab) => tab.type === "graph")!;
    state = workspaceReducer(state, {
      type: "split-pane",
      paneId: firstPaneId,
      direction: "horizontal",
    });
    const secondPaneId = state.focusedPaneId;

    state = workspaceReducer(state, {
      type: "select-tab",
      paneId: firstPaneId,
      tabId: graph.id,
    });
    expect(state.focusedPaneId).toBe(firstPaneId);
    expect(selectedTab(state)?.id).toBe(graph.id);

    state = workspaceReducer(state, {
      type: "close-tab",
      paneId: firstPaneId,
      tabId: settings.id,
    });
    expect(selectedTab(state)?.id).toBe(graph.id);
    state = workspaceReducer(state, {
      type: "close-tab",
      paneId: firstPaneId,
      tabId: graph.id,
    });
    expect(state.panes[firstPaneId]).toBeUndefined();
    expect(state.focusedPaneId).toBe(secondPaneId);
  });

  it("closes the last tab into a browsable empty pane and can reopen settings once", () => {
    let state = createWorkspaceState({ type: "settings" });
    const paneId = state.focusedPaneId;
    const settings = selectedTab(state)!;
    state = workspaceReducer(state, {
      type: "close-tab",
      paneId,
      tabId: settings.id,
    });
    expect(state.panes[paneId]).toMatchObject({ tabs: [], selectedTabId: null });
    expect(selectedTab(state)).toBeUndefined();
    expect(parseWorkspaceState(JSON.stringify(state))).toEqual(state);

    state = workspaceReducer(state, { type: "open-tab", paneId, tab: { type: "settings" } });
    state = workspaceReducer(state, { type: "open-tab", paneId, tab: { type: "settings" } });
    expect(state.panes[paneId]?.tabs.map((tab) => tab.type)).toEqual(["settings"]);
    expect(selectedTab(state)?.type).toBe("settings");
  });

  it("keeps the graph point under the zoom anchor", () => {
    const origin = zoomOriginAt({ x: 10, y: 20 }, 1, 2, { x: 100, y: 60 });
    expect(origin).toEqual({ x: 60, y: 50 });
    expect(origin.x + 100 / 2).toBe(110);
    expect(origin.y + 60 / 2).toBe(80);
  });
});

describe("workspace storage", () => {
  it("round trips validated state", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const state = createWorkspaceState({ type: "graph", graphId: "main" });
    saveWorkspaceState(storage, "key", state);
    expect(
      loadWorkspaceState(storage, "key", () => createWorkspaceState({ type: "settings" })),
    ).toEqual(state);
  });

  it("resets malformed and old data", () => {
    expect(parseWorkspaceState("{bad")).toBeUndefined();
    expect(parseWorkspaceState(JSON.stringify({ version: -1 }))).toBeUndefined();
    expect(parseWorkspaceState("x".repeat(maxWorkspaceStorageBytes + 1))).toBeUndefined();
  });

  it("migrates version zero graph selections", () => {
    let state = createWorkspaceState({ type: "graph", graphId: "main" });
    const tab = selectedTab(state)!;
    state = workspaceReducer(state, {
      type: "set-graph-view",
      tabId: tab.id,
      view: { origin: { x: 0, y: 0 }, scale: 1, selectedNodeIds: ["node"], selectedNodeId: "node" },
    });
    const legacy = JSON.stringify(state, (key, value: unknown) =>
      key === "version" ? 0 : key === "selectedNodeIds" ? undefined : value,
    );
    const migrated = parseWorkspaceState(legacy);
    const migratedTab = selectedTab(migrated!);
    expect(migratedTab?.type === "graph" ? migratedTab.view.selectedNodeIds : undefined).toEqual([
      "node",
    ]);
  });

  it("preserves a persisted primary selection by moving it to the end", () => {
    const state = createWorkspaceState({ type: "graph", graphId: "main" });
    const pane = state.panes[state.focusedPaneId]!;
    const tab = selectedTab(state)!;
    if (tab.type !== "graph") throw new Error("Expected a graph tab");
    const persisted = {
      ...state,
      panes: {
        ...state.panes,
        [pane.id]: {
          ...pane,
          tabs: [
            {
              ...tab,
              view: {
                ...tab.view,
                selectedNodeIds: ["primary", "other"],
                selectedNodeId: "primary",
              },
            },
          ],
        },
      },
    };

    const migratedTab = selectedTab(parseWorkspaceState(JSON.stringify(persisted))!);
    expect(migratedTab?.type === "graph" ? migratedTab.view : undefined).toMatchObject({
      selectedNodeIds: ["other", "primary"],
      selectedNodeId: "primary",
    });
  });

  it("removes version one developer tabs and selects a remaining tab", () => {
    const state = createWorkspaceState({ type: "graph", graphId: "main" });
    const paneId = state.focusedPaneId;
    const graph = selectedTab(state)!;
    const legacy = {
      ...state,
      version: 1,
      panes: {
        [paneId]: {
          ...state.panes[paneId]!,
          tabs: [graph, { id: "developer", type: "developer" }],
          selectedTabId: "developer",
        },
      },
    };
    const migrated = parseWorkspaceState(JSON.stringify(legacy));
    expect(migrated?.panes[paneId]?.tabs).toEqual([graph]);
    expect(migrated?.panes[paneId]?.selectedTabId).toBe(graph.id);
  });

  it("replaces developer-only panes without changing the split tree or focus", () => {
    let state = createWorkspaceState({ type: "settings" });
    state = workspaceReducer(state, {
      type: "split-pane",
      paneId: state.focusedPaneId,
      direction: "horizontal",
    });
    const focusedPaneId = state.focusedPaneId;
    const legacyPanes = Object.fromEntries(
      Object.entries(state.panes).map(([paneId, pane]) => [
        paneId,
        {
          ...pane,
          tabs: [{ id: pane.selectedTabId, type: "developer" }],
        },
      ]),
    );
    const migrated = parseWorkspaceState(
      JSON.stringify({ ...state, version: 1, panes: legacyPanes }),
    );
    expect(migrated?.root).toEqual(state.root);
    expect(migrated?.focusedPaneId).toBe(focusedPaneId);
    expect(
      Object.values(migrated?.panes ?? {}).every(
        (pane) =>
          pane.tabs.length === 1 &&
          pane.tabs[0]?.type === "settings" &&
          pane.selectedTabId === pane.tabs[0].id,
      ),
    ).toBe(true);
  });

  it("moves version one storage to the current key", () => {
    const state = createWorkspaceState({ type: "settings" });
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const key = workspaceStorageKey("project", "user");
    const previousKey = key.replace(":v2:", ":v1:");
    values.set(previousKey, JSON.stringify({ ...state, version: 1 }));
    expect(
      loadWorkspaceState(storage, key, () =>
        createWorkspaceState({ type: "graph", graphId: "fallback" }),
      ),
    ).toEqual(state);
    expect(values.has(previousKey)).toBe(false);
    expect(parseWorkspaceState(values.get(key) ?? null)).toEqual(state);
  });

  it("rejects orphaned, duplicate, and inconsistent pane trees", () => {
    let state = createWorkspaceState({ type: "settings" });
    state = workspaceReducer(state, {
      type: "split-pane",
      paneId: state.focusedPaneId,
      direction: "horizontal",
    });
    const paneIds = Object.keys(state.panes);
    expect(
      parseWorkspaceState(JSON.stringify({ ...state, root: { type: "pane", paneId: paneIds[0] } })),
    ).toBeUndefined();
    expect(
      parseWorkspaceState(
        JSON.stringify({
          ...state,
          root: {
            type: "split",
            direction: "horizontal",
            ratio: 0.5,
            first: { type: "pane", paneId: paneIds[0] },
            second: { type: "pane", paneId: paneIds[0] },
          },
        }),
      ),
    ).toBeUndefined();
    const mismatched = Object.fromEntries(
      Object.entries(state.panes).map(([key, pane]) => [key === paneIds[0] ? "wrong" : key, pane]),
    );
    expect(parseWorkspaceState(JSON.stringify({ ...state, panes: mismatched }))).toBeUndefined();
  });

  it("scopes keys and tolerates unavailable or full storage", () => {
    expect(workspaceStorageKey("project/a", "user/a")).not.toBe(
      workspaceStorageKey("project/b", "user/a"),
    );
    expect(workspaceStorageKey("project/a", "user/a")).not.toBe(
      workspaceStorageKey("project/a", "user/b"),
    );
    const state = createWorkspaceState({ type: "settings" });
    const unavailable = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadWorkspaceState(unavailable, "key", () => state)).toBe(state);
    expect(saveWorkspaceState(unavailable, "key", state)).toBe(false);
  });
});
