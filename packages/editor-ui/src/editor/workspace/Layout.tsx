import type { JSX } from "@solidjs/web";

import * as stylex from "@stylexjs/stylex";
import { For, Show, createMemo, type ParentProps } from "solid-js";

import type {
  GraphTab,
  PaneDirection,
  PaneTree,
  WorkspaceAction,
  WorkspaceState,
  WorkspaceTab,
} from "./workspace";

import { colors } from "../../tokens.stylex.ts";
import { shortcutLabel } from "../shortcuts";
import { tabMarker } from "../markers.stylex.ts";

const styles = stylex.create({
  focus: {
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  backdrop: {
    backgroundColor: "rgb(0 0 0 / 0.5)",
    inset: 0,
    position: "absolute",
    zIndex: 10,
    display: { default: "block", "@media (min-width: 768px)": "none" },
  },
  sidebar: {
    alignItems: "stretch",
    backgroundColor: colors.gray3,
    bottom: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    position: "absolute",
    top: 0,
    width: 224,
    zIndex: 20,
    "@media (min-width: 768px)": { position: "static" },
  },
  left: { borderRightColor: colors.gray5, borderRightStyle: "solid", borderRightWidth: 1, left: 0 },
  right: { borderLeftColor: colors.gray5, borderLeftStyle: "solid", borderLeftWidth: 1, right: 0 },
  pane: {
    alignItems: "stretch",
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
  },
  focused: { boxShadow: "inset 0 0 0 1px rgb(234 179 8 / 0.4)" },
  tabBar: { backgroundColor: colors.gray3, display: "flex", flexDirection: "row" },
  tabScroll: { flex: 1, minWidth: 0, overflowX: "auto", scrollbarWidth: "none" },
  tabList: { alignItems: "stretch", display: "flex", flexDirection: "row", height: 32 },
  tab: {
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    borderRightColor: colors.gray5,
    borderRightStyle: "solid",
    borderRightWidth: 1,
    display: "flex",
    flexDirection: "row",
    position: "relative",
  },
  selectedTab: { backgroundColor: colors.gray2, borderBottomColor: "transparent" },
  unselectedTab: { backgroundColor: colors.gray3, borderBottomColor: colors.gray5 },
  tabButton: {
    alignItems: "center",
    display: "flex",
    flexDirection: "row",
    fontSize: 12,
    fontWeight: 500,
    height: "100%",
    paddingInline: 12,
    whiteSpace: "nowrap",
    paddingRight: { default: 12, "@media (pointer: coarse)": 36 },
  },
  tabName: { alignItems: "center", display: "flex", gap: 4 },
  selectedName: { color: colors.gray12 },
  unselectedName: {
    color: { default: colors.gray10, [stylex.when.ancestor(":hover", tabMarker)]: colors.gray12 },
  },
  description: { color: colors.gray10, fontSize: 10, fontWeight: 400, marginLeft: 4 },
  closeArea: {
    alignItems: "center",
    bottom: 0,
    display: "flex",
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover", tabMarker)]: 1,
      ":focus-within": 1,
      "@media (pointer: coarse)": 1,
    },
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  fade: { height: "100%", pointerEvents: "none", width: 24 },
  selectedFade: { backgroundImage: `linear-gradient(to right, transparent, ${colors.gray2})` },
  unselectedFade: { backgroundImage: `linear-gradient(to right, transparent, ${colors.gray3})` },
  closeBackground: { alignItems: "center", display: "flex", height: "100%", paddingRight: 4 },
  selectedBackground: { backgroundColor: colors.gray2 },
  unselectedBackground: { backgroundColor: colors.gray3 },
  iconButton: {
    alignItems: "center",
    backgroundColor: { default: "transparent", ":hover": colors.gray6 },
    borderRadius: 2,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    display: "flex",
    height: 20,
    justifyContent: "center",
    padding: 2,
    width: 20,
  },
  closeButton: { borderRadius: 4 },
  smallIcon: { flexShrink: 0, height: 14, width: 14 },
  icon: { flexShrink: 0, height: 16, width: 16 },
  rotated: { rotate: "90deg" },
  tabRemainder: {
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    flex: 1,
    minWidth: 24,
  },
  paneActions: {
    alignItems: "center",
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    borderLeftColor: colors.gray5,
    borderLeftStyle: "solid",
    borderLeftWidth: 1,
    display: "flex",
    flexDirection: "row",
    flexShrink: 0,
    gap: 4,
    height: "100%",
    paddingInline: 8,
  },
  content: {
    backgroundColor: colors.gray2,
    display: "flex",
    flex: 1,
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  workspacePane: { display: "flex", flex: 1, minHeight: 0, minWidth: 0 },
  hidden: { display: "none" },
  split: {
    backgroundColor: colors.gray5,
    display: "flex",
    flex: 1,
    gap: 1,
    minHeight: 0,
    minWidth: 0,
  },
  horizontal: { flexDirection: "row" },
  vertical: { flexDirection: "column" },
  contents: { display: "contents" },
  empty: {
    color: colors.gray11,
    display: "flex",
    flex: 1,
    fontSize: 14,
    fontStyle: "italic",
    height: "100%",
    padding: 16,
    textAlign: "center",
    width: "100%",
  },
});

export function Sidebar(
  props: ParentProps<{ side: "left" | "right"; open: boolean; onClose?: () => void }>,
) {
  return (
    <Show when={props.open}>
      <button
        type="button"
        aria-label="Close sidebar"
        sx={styles.backdrop}
        onClick={() => props.onClose?.()}
      />
      <aside sx={[styles.sidebar, props.side === "left" ? styles.left : styles.right]}>
        {props.children}
      </aside>
    </Show>
  );
}

export interface EditorTab {
  readonly id: string;
  readonly title: string;
  readonly icon?: JSX.Element;
  readonly description?: string;
}

export function TabLayout(props: {
  tabs: ReadonlyArray<EditorTab>;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onSplit?: ((direction: PaneDirection) => void) | undefined;
  zoomed?: boolean;
  onZoom?: () => void;
  focused?: boolean;
  paneId?: string;
  onFocus?: () => void;
  onMoveTab?: (tabId: string, targetPaneId: string) => void;
  children: JSX.Element;
}) {
  return (
    <div
      role="region"
      aria-label={props.paneId === undefined ? "Workspace pane" : `Workspace pane ${props.paneId}`}
      sx={[styles.pane, props.focused && styles.focused]}
      onPointerDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button, a, input, select, textarea, summary, label") !== null
        )
          return;
        if (!props.focused) props.onFocus?.();
      }}
      onDragOver={(event) => {
        if (props.paneId !== undefined) event.preventDefault();
      }}
      onDrop={(event) => {
        const tabId = event.dataTransfer?.getData("application/x-macrograph-tab");
        if (tabId && props.paneId) props.onMoveTab?.(tabId, props.paneId);
      }}
    >
      <div sx={styles.tabBar}>
        <div sx={styles.tabScroll}>
          <ul sx={styles.tabList}>
            <For each={props.tabs}>
              {(tab) => {
                const selected = () => tab.id === props.selectedId;
                return (
                  <li
                    draggable="true"
                    sx={[
                      tabMarker,
                      styles.tab,
                      selected() ? styles.selectedTab : styles.unselectedTab,
                    ]}
                    onDragStart={(event) =>
                      event.dataTransfer?.setData("application/x-macrograph-tab", tab.id)
                    }
                    onPointerDown={(event) => {
                      if (event.pointerType === "mouse" && event.button === 0)
                        props.onSelect(tab.id);
                    }}
                  >
                    <button
                      type="button"
                      sx={[styles.focus, styles.tabButton]}
                      aria-current={selected() ? "page" : undefined}
                      onClick={(event) => {
                        if (event.detail === 0) props.onSelect(tab.id);
                      }}
                    >
                      <span
                        sx={[
                          styles.tabName,
                          selected() ? styles.selectedName : styles.unselectedName,
                        ]}
                      >
                        {tab.icon}
                        {tab.title}
                      </span>
                      <Show when={tab.description}>
                        <span sx={styles.description}>{tab.description}</span>
                      </Show>
                    </button>
                    <div sx={styles.closeArea}>
                      <span
                        sx={[styles.fade, selected() ? styles.selectedFade : styles.unselectedFade]}
                      />
                      <div
                        sx={[
                          styles.closeBackground,
                          selected() ? styles.selectedBackground : styles.unselectedBackground,
                        ]}
                      >
                        <button
                          type="button"
                          draggable={false}
                          aria-label={`Close ${tab.title}`}
                          sx={[styles.focus, styles.iconButton, styles.closeButton]}
                          onPointerDown={(event) => event.stopPropagation()}
                          onDragStart={(event) => event.preventDefault()}
                          onClick={(event) => {
                            event.stopPropagation();
                            props.onClose(tab.id);
                          }}
                        >
                          <IconBiX {...stylex.attrs(styles.smallIcon)} />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              }}
            </For>
            <li aria-hidden="true" sx={styles.tabRemainder} />
          </ul>
        </div>
        <Show when={props.focused}>
          <div sx={styles.paneActions}>
            <Show when={props.onSplit}>
              <button
                type="button"
                title={`Split horizontally (${shortcutLabel("split-horizontal")})`}
                aria-label="Split horizontally"
                sx={[styles.focus, styles.iconButton]}
                onClick={() => props.onSplit?.("horizontal")}
              >
                <IconPhSquareSplitHorizontal {...stylex.attrs(styles.icon)} />
              </button>
              <button
                type="button"
                title={`Split vertically (${shortcutLabel("split-vertical")})`}
                aria-label="Split vertically"
                sx={[styles.focus, styles.iconButton]}
                onClick={() => props.onSplit?.("vertical")}
              >
                <IconPhSquareSplitHorizontal {...stylex.attrs(styles.icon, styles.rotated)} />
              </button>
            </Show>
            <Show when={props.onZoom}>
              <button
                type="button"
                title={`Zoom this panel (${shortcutLabel("toggle-pane-zoom")})`}
                aria-label={props.zoomed ? "Restore all panes" : "Zoom this pane"}
                sx={[styles.focus, styles.iconButton]}
                onClick={() => props.onZoom?.()}
              >
                <Show
                  when={props.zoomed}
                  fallback={<IconTablerArrowsDiagonal {...stylex.attrs(styles.icon)} />}
                >
                  <IconTablerArrowsDiagonalMinimize2 {...stylex.attrs(styles.icon)} />
                </Show>
              </button>
            </Show>
          </div>
        </Show>
      </div>
      <div
        ref={(element) => {
          const focus = () => {
            if (!props.focused) props.onFocus?.();
          };
          element.addEventListener("pointerdown", focus, { capture: true });
          element.addEventListener("wheel", focus, { capture: true });
        }}
        sx={styles.content}
      >
        {props.children}
      </div>
    </div>
  );
}

export function WorkspacePanes(props: {
  state: WorkspaceState;
  mobile: boolean;
  title: (tab: WorkspaceTab) => EditorTab;
  dispatch: (action: WorkspaceAction) => void;
  onActivate: (paneId: string) => void;
  renderGraph: (tab: () => GraphTab, paneId: string) => JSX.Element;
  renderPreview: (tab: WorkspaceTab) => JSX.Element;
}) {
  const dispatchAndActivate = (action: WorkspaceAction) => {
    props.dispatch(action);
    queueMicrotask(() => props.onActivate(props.state.focusedPaneId));
  };
  const pane = (paneId: string) => {
    const value = () => props.state.panes[paneId]!;
    const selected = () => value().tabs.find((tab) => tab.id === value().selectedTabId);
    const activate = () => {
      props.onActivate(paneId);
      props.dispatch({ type: "focus-pane", paneId });
    };
    return (
      <div
        sx={[
          styles.workspacePane,
          props.mobile && paneId !== props.state.focusedPaneId && styles.hidden,
        ]}
      >
        <TabLayout
          tabs={value().tabs.map(props.title)}
          selectedId={value().selectedTabId ?? undefined}
          paneId={paneId}
          focused={paneId === props.state.focusedPaneId}
          onFocus={activate}
          onSelect={(tabId) => {
            props.dispatch({ type: "select-tab", paneId, tabId });
            queueMicrotask(() => props.onActivate(paneId));
          }}
          onClose={(tabId) => dispatchAndActivate({ type: "close-tab", paneId, tabId })}
          onMoveTab={(tabId, targetPaneId) => {
            const fromPaneId = Object.values(props.state.panes).find((candidate) =>
              candidate.tabs.some((tab) => tab.id === tabId),
            )?.id;
            if (fromPaneId !== undefined)
              dispatchAndActivate({ type: "move-tab", fromPaneId, toPaneId: targetPaneId, tabId });
          }}
          onSplit={
            props.mobile
              ? undefined
              : (direction) => {
                  const panes = Object.keys(props.state.panes).length + 1;
                  const enoughRoom =
                    direction === "horizontal"
                      ? innerWidth / panes >= 320
                      : innerHeight / panes >= 240;
                  if (enoughRoom) dispatchAndActivate({ type: "split-pane", paneId, direction });
                }
          }
          zoomed={props.state.zoomedPaneId === paneId}
          onZoom={() => props.dispatch({ type: "toggle-zoom", paneId })}
        >
          <Show when={selected()} fallback={<EmptyContext />}>
            {(tab) => (
              <Show when={tab().type === "graph"} fallback={props.renderPreview(tab())}>
                {props.renderGraph(tab as () => GraphTab, paneId)}
              </Show>
            )}
          </Show>
        </TabLayout>
      </div>
    );
  };

  const tree = (node: PaneTree): JSX.Element => {
    if (node.type === "pane") return pane(node.paneId);
    return (
      <div
        sx={
          props.mobile
            ? styles.contents
            : [styles.split, node.direction === "horizontal" ? styles.horizontal : styles.vertical]
        }
      >
        {tree(node.first)}
        {tree(node.second)}
      </div>
    );
  };

  const root = createMemo(() => props.state.root);
  const rendered = createMemo(() => tree(root()));
  const hasTabs = createMemo(() =>
    Object.values(props.state.panes).some((candidate) => candidate.tabs.length > 0),
  );
  return (
    <Show when={hasTabs()} fallback={<div style={{ flex: "1" }} />}>
      <Show when={props.state.zoomedPaneId} fallback={rendered()}>
        {(paneId) => pane(paneId())}
      </Show>
    </Show>
  );
}

export function EmptyContext() {
  return <div sx={styles.empty}>Select an item to view its details.</div>;
}
