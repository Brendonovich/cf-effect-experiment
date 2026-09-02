export const workspaceVersion = 2 as const;
export type PaneDirection = "horizontal" | "vertical";
export type NavSection = "graphs" | "packages" | "constants" | "types" | null;

export interface GraphViewState {
  readonly origin: { readonly x: number; readonly y: number };
  readonly scale: number;
  readonly selectedNodeIds: ReadonlyArray<string>;
  readonly selectedNodeId: string | null;
}

export type GraphTab = {
  readonly id: string;
  readonly type: "graph";
  readonly graphId: string;
  readonly view: GraphViewState;
};

export type WorkspaceTab =
  | GraphTab
  | { readonly id: string; readonly type: "package"; readonly packageId: string }
  | { readonly id: string; readonly type: "settings" | "shortcuts" };

export interface PaneState {
  readonly id: string;
  readonly tabs: ReadonlyArray<WorkspaceTab>;
  readonly selectedTabId: string | null;
}

export type PaneTree =
  | { readonly type: "pane"; readonly paneId: string }
  | {
      readonly type: "split";
      readonly direction: PaneDirection;
      readonly ratio: number;
      readonly first: PaneTree;
      readonly second: PaneTree;
    };

export interface WorkspaceState {
  readonly version: typeof workspaceVersion;
  readonly root: PaneTree;
  readonly panes: Readonly<Record<string, PaneState>>;
  readonly focusedPaneId: string;
  readonly navSection: NavSection;
  readonly inspectorOpen: boolean;
  readonly zoomedPaneId: string | null;
}

export type TabInput =
  | { readonly type: "graph"; readonly graphId: string }
  | { readonly type: "package"; readonly packageId: string }
  | { readonly type: "settings" | "shortcuts" };

export type WorkspaceAction =
  | { readonly type: "focus-pane"; readonly paneId: string }
  | { readonly type: "open-tab"; readonly tab: TabInput; readonly paneId?: string }
  | { readonly type: "select-tab"; readonly paneId: string; readonly tabId: string }
  | { readonly type: "close-tab"; readonly paneId: string; readonly tabId: string }
  | {
      readonly type: "move-tab";
      readonly fromPaneId: string;
      readonly toPaneId: string;
      readonly tabId: string;
      readonly index?: number;
    }
  | { readonly type: "cycle-tab"; readonly delta: number }
  | { readonly type: "split-pane"; readonly paneId: string; readonly direction: PaneDirection }
  | { readonly type: "set-graph-view"; readonly tabId: string; readonly view: GraphViewState }
  | { readonly type: "set-nav-section"; readonly section: NavSection }
  | { readonly type: "set-inspector-open"; readonly open: boolean }
  | { readonly type: "toggle-zoom"; readonly paneId: string };

let nextId = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(nextId += 1).toString(36)}`;

export const defaultGraphView = (): GraphViewState => ({
  origin: { x: 0, y: 0 },
  scale: 1,
  selectedNodeIds: [],
  selectedNodeId: null,
});

const normalizeGraphView = (view: GraphViewState): GraphViewState => {
  const selectedNodeIds =
    view.selectedNodeId !== null && view.selectedNodeIds.at(-1) !== view.selectedNodeId
      ? [...view.selectedNodeIds.filter((id) => id !== view.selectedNodeId), view.selectedNodeId]
      : view.selectedNodeIds;
  return {
    ...view,
    selectedNodeIds,
    selectedNodeId: selectedNodeIds.at(-1) ?? null,
  };
};

export const zoomOriginAt = (
  origin: { readonly x: number; readonly y: number },
  scale: number,
  nextScale: number,
  anchor: { readonly x: number; readonly y: number },
  nextAnchor = anchor,
) => ({
  x: origin.x + anchor.x / scale - nextAnchor.x / nextScale,
  y: origin.y + anchor.y / scale - nextAnchor.y / nextScale,
});

const makeTab = (input: TabInput, tabId = id("tab")): WorkspaceTab => {
  switch (input.type) {
    case "graph":
      return { id: tabId, type: "graph", graphId: input.graphId, view: defaultGraphView() };
    case "package":
      return { id: tabId, type: "package", packageId: input.packageId };
    case "settings":
    case "shortcuts":
      return { id: tabId, type: input.type };
  }
};

const tabKey = (tab: WorkspaceTab | TabInput) => {
  switch (tab.type) {
    case "graph":
      return `graph:${tab.graphId}`;
    case "package":
      return `package:${tab.packageId}`;
    case "settings":
    case "shortcuts":
      return tab.type;
  }
};

export const createWorkspaceState = (initial?: TabInput): WorkspaceState => {
  const paneId = id("pane");
  const tab = initial === undefined ? undefined : makeTab(initial);
  return {
    version: workspaceVersion,
    root: { type: "pane", paneId },
    panes: {
      [paneId]: {
        id: paneId,
        tabs: tab === undefined ? [] : [tab],
        selectedTabId: tab?.id ?? null,
      },
    },
    focusedPaneId: paneId,
    navSection: "graphs",
    inspectorOpen: true,
    zoomedPaneId: null,
  };
};

export const selectedTab = (state: WorkspaceState, paneId = state.focusedPaneId) => {
  const pane = state.panes[paneId];
  return pane?.tabs.find((tab) => tab.id === pane.selectedTabId);
};

export const isGraphTab = (tab: WorkspaceTab | undefined): tab is GraphTab =>
  tab !== undefined && tab.type === "graph";

const replaceLeaf = (tree: PaneTree, paneId: string, replacement: PaneTree): PaneTree => {
  if (tree.type === "pane") return tree.paneId === paneId ? replacement : tree;
  return {
    ...tree,
    first: replaceLeaf(tree.first, paneId, replacement),
    second: replaceLeaf(tree.second, paneId, replacement),
  };
};

const removeLeaf = (tree: PaneTree, paneId: string): PaneTree | undefined => {
  if (tree.type === "pane") return tree.paneId === paneId ? undefined : tree;
  const first = removeLeaf(tree.first, paneId);
  const second = removeLeaf(tree.second, paneId);
  if (first === undefined) return second;
  if (second === undefined) return first;
  return { ...tree, first, second };
};

const firstLeaf = (tree: PaneTree): string =>
  tree.type === "pane" ? tree.paneId : firstLeaf(tree.first);

const cloneTab = (tab: WorkspaceTab): WorkspaceTab => {
  const newId = id("tab");
  return tab.type === "graph"
    ? {
        ...tab,
        id: newId,
        view: {
          ...tab.view,
          origin: { ...tab.view.origin },
          selectedNodeIds: [...tab.view.selectedNodeIds],
        },
      }
    : { ...tab, id: newId };
};

export const workspaceReducer = (
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState => {
  switch (action.type) {
    case "focus-pane":
      return state.panes[action.paneId] === undefined
        ? state
        : state.focusedPaneId === action.paneId
          ? state
          : { ...state, focusedPaneId: action.paneId };
    case "open-tab": {
      const paneId = action.paneId ?? state.focusedPaneId;
      const pane = state.panes[paneId];
      if (pane === undefined) return state;
      const existing = pane.tabs.find((tab) => tabKey(tab) === tabKey(action.tab));
      if (existing !== undefined)
        return {
          ...state,
          focusedPaneId: paneId,
          panes: { ...state.panes, [paneId]: { ...pane, selectedTabId: existing.id } },
        };
      const tab = makeTab(action.tab);
      return {
        ...state,
        focusedPaneId: paneId,
        panes: {
          ...state.panes,
          [paneId]: { ...pane, tabs: [...pane.tabs, tab], selectedTabId: tab.id },
        },
      };
    }
    case "select-tab": {
      const pane = state.panes[action.paneId];
      if (pane === undefined || !pane.tabs.some((tab) => tab.id === action.tabId)) return state;
      return {
        ...state,
        focusedPaneId: pane.id,
        panes: { ...state.panes, [pane.id]: { ...pane, selectedTabId: action.tabId } },
      };
    }
    case "close-tab": {
      const pane = state.panes[action.paneId];
      if (pane === undefined) return state;
      const index = pane.tabs.findIndex((tab) => tab.id === action.tabId);
      if (index < 0) return state;
      const tabs = pane.tabs.filter((tab) => tab.id !== action.tabId);
      if (tabs.length > 0) {
        const selected =
          pane.selectedTabId === action.tabId
            ? tabs[Math.min(index, tabs.length - 1)]!.id
            : pane.selectedTabId;
        return {
          ...state,
          panes: { ...state.panes, [pane.id]: { ...pane, tabs, selectedTabId: selected } },
        };
      }
      if (Object.keys(state.panes).length === 1)
        return {
          ...state,
          panes: { ...state.panes, [pane.id]: { ...pane, tabs: [], selectedTabId: null } },
          zoomedPaneId: null,
        };
      const root = removeLeaf(state.root, pane.id);
      if (root === undefined) return state;
      const panes = { ...state.panes };
      delete panes[pane.id];
      const focusedPaneId = state.focusedPaneId === pane.id ? firstLeaf(root) : state.focusedPaneId;
      return {
        ...state,
        root,
        panes,
        focusedPaneId,
        zoomedPaneId: state.zoomedPaneId === pane.id ? null : state.zoomedPaneId,
      };
    }
    case "move-tab": {
      const from = state.panes[action.fromPaneId];
      const to = state.panes[action.toPaneId];
      const tab = from?.tabs.find((candidate) => candidate.id === action.tabId);
      if (from === undefined || to === undefined || tab === undefined) return state;
      if (from.id === to.id) {
        const tabs = from.tabs.filter((candidate) => candidate.id !== tab.id);
        tabs.splice(Math.max(0, Math.min(action.index ?? tabs.length, tabs.length)), 0, tab);
        return {
          ...state,
          panes: { ...state.panes, [from.id]: { ...from, tabs, selectedTabId: tab.id } },
        };
      }
      const targetTabs = [...to.tabs];
      targetTabs.splice(
        Math.max(0, Math.min(action.index ?? targetTabs.length, targetTabs.length)),
        0,
        tab,
      );
      let next = {
        ...state,
        focusedPaneId: to.id,
        panes: { ...state.panes, [to.id]: { ...to, tabs: targetTabs, selectedTabId: tab.id } },
      };
      next = workspaceReducer(next, { type: "close-tab", paneId: from.id, tabId: tab.id });
      return next;
    }
    case "cycle-tab": {
      const pane = state.panes[state.focusedPaneId];
      if (pane === undefined || pane.tabs.length < 2) return state;
      const current = pane.tabs.findIndex((tab) => tab.id === pane.selectedTabId);
      const index = (current + action.delta + pane.tabs.length) % pane.tabs.length;
      return {
        ...state,
        panes: { ...state.panes, [pane.id]: { ...pane, selectedTabId: pane.tabs[index]!.id } },
      };
    }
    case "split-pane": {
      const pane = state.panes[action.paneId];
      const tab = selectedTab(state, action.paneId);
      if (pane === undefined || tab === undefined) return state;
      const paneId = id("pane");
      const copied = cloneTab(tab);
      return {
        ...state,
        focusedPaneId: paneId,
        zoomedPaneId: null,
        root: replaceLeaf(state.root, pane.id, {
          type: "split",
          direction: action.direction,
          ratio: 0.5,
          first: { type: "pane", paneId: pane.id },
          second: { type: "pane", paneId },
        }),
        panes: {
          ...state.panes,
          [paneId]: { id: paneId, tabs: [copied], selectedTabId: copied.id },
        },
      };
    }
    case "set-graph-view": {
      for (const pane of Object.values(state.panes)) {
        const index = pane.tabs.findIndex((tab) => tab.id === action.tabId && tab.type === "graph");
        if (index < 0) continue;
        const tabs = [...pane.tabs];
        const tab = tabs[index]!;
        if (tab.type !== "graph") return state;
        tabs[index] = { ...tab, view: normalizeGraphView(action.view) };
        return { ...state, panes: { ...state.panes, [pane.id]: { ...pane, tabs } } };
      }
      return state;
    }
    case "set-nav-section":
      return { ...state, navSection: action.section };
    case "set-inspector-open":
      return { ...state, inspectorOpen: action.open };
    case "toggle-zoom":
      return state.panes[action.paneId] === undefined
        ? state
        : { ...state, zoomedPaneId: state.zoomedPaneId === action.paneId ? null : action.paneId };
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const validView = (value: unknown): value is GraphViewState =>
  isRecord(value) &&
  isRecord(value.origin) &&
  typeof value.origin.x === "number" &&
  Number.isFinite(value.origin.x) &&
  typeof value.origin.y === "number" &&
  Number.isFinite(value.origin.y) &&
  typeof value.scale === "number" &&
  Number.isFinite(value.scale) &&
  value.scale >= 0.25 &&
  value.scale <= 2 &&
  isStringArray(value.selectedNodeIds) &&
  value.selectedNodeIds.length <= 500 &&
  new Set(value.selectedNodeIds).size === value.selectedNodeIds.length &&
  (value.selectedNodeId === null ||
    (typeof value.selectedNodeId === "string" &&
      value.selectedNodeIds.includes(value.selectedNodeId)));
const validTab = (value: unknown): value is WorkspaceTab => {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.type !== "string")
    return false;
  if (value.type === "graph") return typeof value.graphId === "string" && validView(value.view);
  if (value.type === "package") return typeof value.packageId === "string";
  return value.type === "settings" || value.type === "shortcuts";
};
const validTree = (
  value: unknown,
  paneIds: Set<string>,
  leaves: Set<string>,
): value is PaneTree => {
  if (!isRecord(value)) return false;
  if (value.type === "pane") {
    if (typeof value.paneId !== "string" || !paneIds.has(value.paneId) || leaves.has(value.paneId))
      return false;
    leaves.add(value.paneId);
    return true;
  }
  return (
    value.type === "split" &&
    (value.direction === "horizontal" || value.direction === "vertical") &&
    typeof value.ratio === "number" &&
    Number.isFinite(value.ratio) &&
    value.ratio > 0.1 &&
    value.ratio < 0.9 &&
    validTree(value.first, paneIds, leaves) &&
    validTree(value.second, paneIds, leaves)
  );
};

const migrateVersionZero = (value: Record<string, unknown>) => {
  if (value.version !== 0 || !isRecord(value.panes)) return value;
  const panes = Object.fromEntries(
    Object.entries(value.panes).map(([key, pane]) => {
      if (!isRecord(pane) || !Array.isArray(pane.tabs)) return [key, pane];
      const tabs = pane.tabs.map((tab) => {
        if (
          !isRecord(tab) ||
          tab.type !== "graph" ||
          !isRecord(tab.view) ||
          "selectedNodeIds" in tab.view
        )
          return tab;
        const selectedNodeIds =
          typeof tab.view.selectedNodeId === "string" ? [tab.view.selectedNodeId] : [];
        return { ...tab, view: { ...tab.view, selectedNodeIds } };
      });
      return [key, { ...pane, tabs }];
    }),
  );
  return { ...value, version: 1, panes };
};

const migrateVersionOne = (value: Record<string, unknown>) => {
  if (value.version !== 1 || !isRecord(value.panes)) return value;
  const panes = Object.fromEntries(
    Object.entries(value.panes).map(([key, pane]) => {
      if (!isRecord(pane) || !Array.isArray(pane.tabs)) return [key, pane];
      const tabs = pane.tabs.filter((tab) => !isRecord(tab) || tab.type !== "developer");
      if (tabs.length === 0) {
        const previous = pane.tabs[0];
        const fallback = {
          id:
            isRecord(previous) && typeof previous.id === "string" ? previous.id : `settings-${key}`,
          type: "settings",
        };
        return [key, { ...pane, tabs: [fallback], selectedTabId: fallback.id }];
      }
      const selectedTabId =
        tabs.some((tab) => isRecord(tab) && tab.id === pane.selectedTabId) &&
        typeof pane.selectedTabId === "string"
          ? pane.selectedTabId
          : isRecord(tabs[0]) && typeof tabs[0].id === "string"
            ? tabs[0].id
            : pane.selectedTabId;
      return [key, { ...pane, tabs, selectedTabId }];
    }),
  );
  return { ...value, version: workspaceVersion, panes };
};

const migrateWorkspaceState = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return migrateVersionOne(migrateVersionZero(value));
};

export const maxWorkspaceStorageBytes = 1_000_000;

export const parseWorkspaceState = (value: string | null): WorkspaceState | undefined => {
  if (value === null || value.length > maxWorkspaceStorageBytes) return undefined;
  try {
    const parsed = migrateWorkspaceState(JSON.parse(value) as unknown);
    if (!isRecord(parsed) || parsed.version !== workspaceVersion || !isRecord(parsed.panes))
      return undefined;
    const paneEntries = Object.entries(parsed.panes);
    const panes = paneEntries.map(([, pane]) => pane);
    if (panes.length > 32) return undefined;
    if (
      panes.length === 0 ||
      !panes.every(
        (pane) =>
          isRecord(pane) &&
          typeof pane.id === "string" &&
          Array.isArray(pane.tabs) &&
          pane.tabs.length <= 100 &&
          pane.tabs.every(validTab) &&
          ((pane.tabs.length === 0 && pane.selectedTabId === null) ||
            (typeof pane.selectedTabId === "string" &&
              pane.tabs.some((tab) => isRecord(tab) && tab.id === pane.selectedTabId))),
      )
    )
      return undefined;
    if (!paneEntries.every(([key, pane]) => isRecord(pane) && pane.id === key)) return undefined;
    const paneIds = new Set(
      panes.flatMap((pane) => (isRecord(pane) && typeof pane.id === "string" ? [pane.id] : [])),
    );
    if (paneIds.size !== panes.length) return undefined;
    const tabIds = panes.flatMap((pane) =>
      isRecord(pane) && Array.isArray(pane.tabs)
        ? pane.tabs.flatMap((tab) => (isRecord(tab) && typeof tab.id === "string" ? [tab.id] : []))
        : [],
    );
    if (new Set(tabIds).size !== tabIds.length) return undefined;
    const leaves = new Set<string>();
    if (
      !validTree(parsed.root, paneIds, leaves) ||
      leaves.size !== paneIds.size ||
      typeof parsed.focusedPaneId !== "string" ||
      !paneIds.has(parsed.focusedPaneId)
    )
      return undefined;
    if (
      ![null, "graphs", "packages", "constants", "types"].includes(
        parsed.navSection as string | null,
      ) ||
      typeof parsed.inspectorOpen !== "boolean"
    )
      return undefined;
    if (
      parsed.zoomedPaneId !== null &&
      (typeof parsed.zoomedPaneId !== "string" || !paneIds.has(parsed.zoomedPaneId))
    )
      return undefined;
    const state = parsed as unknown as WorkspaceState;
    return {
      ...state,
      panes: Object.fromEntries(
        Object.entries(state.panes).map(([paneId, pane]) => [
          paneId,
          {
            ...pane,
            tabs: pane.tabs.map((tab) =>
              tab.type === "graph" ? { ...tab, view: normalizeGraphView(tab.view) } : tab,
            ),
          },
        ]),
      ),
    };
  } catch {
    return undefined;
  }
};

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const workspaceStorageKey = (projectId: string, userId: string) =>
  `macrograph:workspace:v${workspaceVersion}:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;

export const loadWorkspaceState = (
  storage: WorkspaceStorage,
  key: string,
  fallback: () => WorkspaceState,
) => {
  let stored: string | null;
  let storedKey = key;
  try {
    stored = storage.getItem(key);
    if (stored === null) {
      const previousKey = key.replace(":v2:", ":v1:");
      if (previousKey !== key) {
        stored = storage.getItem(previousKey);
        storedKey = previousKey;
      }
    }
  } catch {
    return fallback();
  }
  const state = parseWorkspaceState(stored);
  if (state !== undefined) {
    if (storedKey !== key && saveWorkspaceState(storage, key, state)) {
      try {
        storage.removeItem(storedKey);
      } catch {
        // Storage can be unavailable in restricted browser contexts.
      }
    }
    return state;
  }
  try {
    storage.removeItem(storedKey);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  return fallback();
};

export const saveWorkspaceState = (
  storage: WorkspaceStorage,
  key: string,
  state: WorkspaceState,
) => {
  try {
    const value = JSON.stringify(state);
    if (value.length > maxWorkspaceStorageBytes) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};
