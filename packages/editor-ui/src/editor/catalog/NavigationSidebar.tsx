import { type Graph, type Package, type Project, ResourceConstant } from "@macrograph/core";
import { Portal, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { colors } from "../../tokens.stylex.ts";
import { createStateMachine } from "../../ui/createStateMachine.ts";
import { Select } from "../../ui/Select";
import { searchMarker } from "../markers.stylex.ts";
import { Sidebar } from "../workspace/Layout";
import { GraphNavigationOption } from "./GraphNavigationOption";
const enter = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-4px) scale(.95)" },
  to: { opacity: 1, transform: "translateY(0) scale(1)" },
});
const exit = stylex.keyframes({
  from: { opacity: 1, transform: "translateY(0) scale(1)" },
  to: { opacity: 0, transform: "translateY(-4px) scale(.95)" },
});
const menuEnter = stylex.keyframes({
  from: { opacity: 0, transform: "scale(.96)" },
  to: { opacity: 1, transform: "scale(1)" },
});
const styles = stylex.create({
  focus: {
    outline: "none",
    boxShadow: { default: null, ":focus-visible": `inset 0 0 0 1px ${colors.focus}` },
  },
  topTabs: {
    backgroundColor: colors.gray3,
    borderBottomColor: colors.gray5,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexDirection: "row",
    height: 32,
  },
  tabGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    height: "100%",
    width: "100%",
  },
  tab: {
    backgroundColor: { default: "transparent", ":hover": colors.gray4 },
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    fontSize: 11,
    fontWeight: 500,
    lineHeight: 1,
    paddingBlock: 4,
  },
  activeTab: { borderBottomColor: colors.focus, color: colors.gray12 },
  inactiveTab: {
    borderBottomColor: "transparent",
    color: { default: colors.gray10, ":hover": colors.gray12 },
  },
  toolbar: {
    alignItems: "stretch",
    backgroundColor: colors.gray2,
    borderBottomColor: colors.gray6,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    flexDirection: "row",
    height: 32,
  },
  search: { alignItems: "stretch", display: "flex", flex: 1, flexDirection: "row", minWidth: 0 },
  searchIcon: {
    color: {
      default: colors.gray9,
      [stylex.when.ancestor(":focus-within", searchMarker)]: colors.focus,
    },
    flexShrink: 0,
    height: 14,
    marginBlock: "auto",
    marginLeft: 8,
    width: 14,
  },
  smallSearchIcon: { height: 12, width: 12 },
  searchInput: {
    backgroundColor: "transparent",
    flex: 1,
    fontSize: 12,
    height: "100%",
    minWidth: 0,
    outline: "none",
    paddingInline: 6,
    "::placeholder": { color: colors.gray9 },
  },
  newButton: {
    alignItems: "center",
    backgroundColor: { default: "transparent", ":hover": colors.gray6 },
    borderRadius: 4,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    display: "flex",
    flexShrink: 0,
    height: 20,
    justifyContent: "center",
    marginBlock: "auto",
    marginInline: 6,
    padding: 2,
    width: 20,
  },
  plusIcon: { flexShrink: 0, height: 16, width: 16 },
  createRoot: { display: "flex", flexShrink: 0, height: "100%" },
  dialog: {
    backgroundColor: colors.gray3,
    borderColor: colors.gray6,
    borderRadius: 4,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: "0 20px 25px -5px rgb(0 0 0 / .3)",
    overflow: "hidden",
    position: "fixed",
    transformOrigin: "top",
    zIndex: 50,
  },
  showing: {
    animationDuration: { default: "150ms", "@media (prefers-reduced-motion: reduce)": "1ms" },
    animationName: enter,
  },
  hiding: {
    animationDuration: { default: "100ms", "@media (prefers-reduced-motion: reduce)": "1ms" },
    animationName: exit,
    pointerEvents: "none",
  },
  dialogSearch: {
    alignItems: "center",
    backgroundColor: colors.gray2,
    borderBottomColor: colors.gray6,
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: "flex",
    height: 32,
  },
  dialogInput: { fontSize: 13 },
  typeList: { maxHeight: 256, overflowY: "auto", paddingBottom: 4, paddingInline: 4 },
  emptyTypes: { color: colors.gray9, fontSize: 12, paddingBlock: 8, paddingInline: 4 },
  resourceGroup: { marginTop: { default: 4, ":first-child": 0 } },
  groupTitle: {
    backgroundColor: colors.gray3,
    color: colors.gray11,
    fontSize: 11,
    fontWeight: 500,
    paddingBlock: 3,
    paddingInline: 4,
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  typeOption: {
    borderRadius: 4,
    display: "block",
    fontSize: 12,
    fontWeight: 500,
    paddingBlock: 4,
    paddingInline: 4,
    textAlign: "left",
    width: "100%",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.gray5,
      ":focus-visible": colors.gray5,
    },
  },
  scroll: { flex: 1, minHeight: 0, overflowY: "auto" },
  navOption: {
    display: "block",
    fontSize: 12,
    paddingBlock: 5,
    paddingInline: 8,
    textAlign: "left",
    width: "100%",
  },
  selected: {
    backgroundColor: { default: colors.gray4, ":hover": colors.gray5 },
    boxShadow: `inset -2px 0 0 ${colors.focus}`,
  },
  unselected: { backgroundColor: { default: "transparent", ":hover": colors.gray4 } },
  packages: { display: "flex", flexDirection: "column", minHeight: "100%" },
  separator: {
    backgroundColor: colors.gray3,
    marginTop: 8,
    paddingBlock: 10,
    paddingInline: 8,
  },
  separatorTitle: {
    color: colors.gray9,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: ".025em",
    paddingBottom: 4,
    textTransform: "uppercase",
  },
  unavailablePackage: { color: colors.gray9, fontSize: 12, paddingBlock: 4 },
  constants: { paddingBottom: 8, paddingInline: 8 },
  column: { display: "flex", flexDirection: "column" },
  noConstants: {
    color: colors.gray10,
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 8,
    textAlign: "center",
  },
  constantSection: { paddingBottom: 12, ":last-child": { paddingBottom: 0 } },
  constantHeader: {
    alignItems: "center",
    backgroundColor: colors.gray3,
    color: colors.gray11,
    display: "flex",
    fontSize: 11,
    fontWeight: 500,
    gap: 4,
    marginBottom: 4,
    marginInline: -8,
    minWidth: 0,
    paddingBottom: 2,
    paddingInline: 8,
    paddingTop: 6,
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  noShrink: { flexShrink: 0 },
  muted: { color: colors.gray9 },
  truncate: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  constantList: { display: "flex", flexDirection: "column", gap: 6, marginInline: -4 },
  constantCard: {
    backgroundColor: colors.gray2,
    borderRadius: 2,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: 4,
  },
  defaultAccent: {
    backgroundColor: colors.focus,
    borderRadius: "50%",
    flexShrink: 0,
    height: 4,
    width: 4,
  },
  row: { alignItems: "center", display: "flex", gap: 4 },
  nameButton: {
    borderRadius: 2,
    flex: 1,
    fontSize: 12,
    fontWeight: 500,
    height: 22,
    minWidth: 0,
    overflow: "hidden",
    paddingInline: 4,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    backgroundColor: {
      default: "transparent",
      ":hover": "color-mix(in srgb, var(--gray-12) 5%, transparent)",
    },
  },
  nameInput: {
    backgroundColor: colors.gray2,
    borderRadius: 2,
    boxShadow: {
      default: `0 0 0 1px ${colors.gray6}`,
      ":focus-visible": `inset 0 0 0 1px ${colors.focus}`,
    },
    flex: 1,
    fontSize: 12,
    fontWeight: 500,
    height: 22,
    minWidth: 0,
    outline: "none",
    paddingInline: 4,
  },
  actionsButton: {
    alignItems: "center",
    backgroundColor: { default: "transparent", ":hover": colors.gray6 },
    borderRadius: 4,
    color: { default: colors.gray11, ":hover": colors.gray12 },
    display: "flex",
    flexShrink: 0,
    height: 20,
    justifyContent: "center",
    padding: 2,
    width: 20,
  },
  actionsIcon: { height: 14, width: 14 },
  actionsMenu: {
    animationName: {
      default: menuEnter,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "140ms",
    animationTimingFunction: "cubic-bezier(.16, 1, .3, 1)",
    animationFillMode: "both",
    transformOrigin: "top right",
    position: "fixed",
    zIndex: 100,
    backgroundColor: colors.gray2,
    color: colors.gray12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.gray6,
    boxShadow: "0 12px 32px rgb(0 0 0 / .35), 0 2px 6px rgb(0 0 0 / .2)",
    borderRadius: 6,
    maxHeight: "calc(100dvh - 16px)",
    overflowY: "auto",
    padding: 4,
  },
  menuAction: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    borderRadius: 4,
    paddingBlock: 4,
    paddingInline: 8,
    fontSize: 12,
    textAlign: "left",
    backgroundColor: {
      default: "transparent",
      ":hover": colors.gray5,
      ":focus-visible": colors.gray5,
    },
    outline: "none",
    "@media (pointer: coarse)": { minHeight: 40 },
  },
  menuDivider: { height: 1, backgroundColor: colors.gray6, marginBlock: 3, marginInline: 4 },
  disabledAction: { color: colors.gray10 },
  dangerAction: {
    color: colors.red11,
    backgroundColor: {
      default: "transparent",
      ":hover": colors.red3,
      ":focus-visible": colors.red3,
    },
  },
  constantValueAppearance: { fontSize: 12 },
});

export type NavigationSection = "graphs" | "packages" | "constants" | "types";

export function NavigationSidebar(props: {
  section: NavigationSection;
  search: string;
  selectedPaneId?: string | undefined;
  graphs: ReadonlyArray<readonly [string, Graph.Model]>;
  packagesWithSettings: ReadonlyArray<Package.Model>;
  packagesWithoutSettings: ReadonlyArray<Package.Model>;
  allPackages: ReadonlyArray<Package.Model>;
  constants: Project.Model["constants"];
  typesPanel?: JSX.Element;
  onSectionChange: (section: NavigationSection) => void;
  onSearchChange: (search: string) => void;
  onClose: () => void;
  onCreateGraph: () => void;
  onSelectGraph: (id: string) => void;
  canEditGraphs: boolean;
  onRenameGraph: (id: string, name: string) => void;
  onDeleteGraph: (id: string) => void;
  onOpenPackage: (id: string) => void;
  onCreateConstant: (resource: ResourceConstant.ResourceRef) => void;
  onRenameConstant: (id: string, name: string) => void | Promise<void>;
  onSelectConstant: (id: string, value: ResourceConstant.LiveValue["id"]) => void;
  onSetDefaultConstant: (id: string) => void;
  canEditConstants: boolean;
  onDeleteConstant: (id: string) => void;
  resourceDefinition: (
    resource: ResourceConstant.ResourceRef,
  ) => { pkg: Package.Model; definition: Package.ResourceDefinition } | undefined;
  valuesFor: (resource: ResourceConstant.ResourceRef) => ReadonlyArray<ResourceConstant.LiveValue>;
}) {
  let createMenuRoot: HTMLDivElement | undefined;
  const isDefault = (constant: ResourceConstant.Model) =>
    ResourceConstant.getDefault(props.constants, constant.resource)?.id === constant.id;
  let createMenuTrigger: HTMLButtonElement | undefined;
  let actionsTrigger: HTMLButtonElement | undefined;
  let actionsElement: HTMLDivElement | undefined;
  const [actionsMenu, setActionsMenu] = createSignal<{ id: string; x: number; y: number } | null>(
    null,
  );
  const closeActions = (restoreFocus = false) => {
    setActionsMenu(null);
    if (restoreFocus) actionsTrigger?.focus();
  };
  const openActions = (id: string, trigger: HTMLButtonElement) => {
    if (!props.canEditConstants) return;
    constantWorkflowActions.closePicker();
    actionsTrigger = trigger;
    const bounds = trigger.getBoundingClientRect();
    setActionsMenu({ id, x: bounds.right, y: bounds.bottom + 4 });
  };
  const actionsPosition = () => {
    const point = actionsMenu();
    const width = Math.min(176, window.innerWidth - 16);
    return {
      width: `${width}px`,
      left: `${Math.max(8, Math.min((point?.x ?? 8) - width, window.innerWidth - width - 8))}px`,
      top: `${Math.max(8, Math.min(point?.y ?? 8, window.innerHeight - 100 - 8))}px`,
    };
  };
  type ConstantWorkflow = {
    context: {
      search: string;
      pending: { ids: ReadonlySet<string>; resource: ResourceConstant.ResourceRef } | null;
      editing: string | null;
    };
    mode: "hidden" | "present" | "hiding";
  };
  const [constantWorkflow, constantWorkflowActions] = createStateMachine(
    {
      context: { search: "", pending: null, editing: null },
      mode: "hidden",
    } as ConstantWorkflow,
    {
      togglePicker(workflow) {
        if (workflow.mode === "present") {
          workflow.mode = "hiding";
          return;
        }
        if (workflow.context.pending !== null) return;
        workflow.context.search = "";
        workflow.mode = "present";
      },
      closePicker(workflow) {
        if (workflow.mode === "present") workflow.mode = "hiding";
      },
      pickerHidden(workflow) {
        if (workflow.mode !== "hiding") return;
        workflow.context.search = "";
        workflow.mode = "hidden";
      },
      search(workflow, search: string) {
        if (workflow.mode === "present") workflow.context.search = search;
      },
      create(workflow, ids: ReadonlySet<string>, resource: ResourceConstant.ResourceRef) {
        if (workflow.mode !== "present" || workflow.context.pending !== null) return;
        workflow.context.pending = { ids, resource };
        workflow.mode = "hiding";
      },
      created(workflow, id: string) {
        if (workflow.context.pending === null) return;
        workflow.context.pending = null;
        workflow.context.editing = id;
      },
      edit(workflow, id: string) {
        if (workflow.context.pending === null) workflow.context.editing = id;
      },
      finishEdit(workflow, id: string) {
        if (workflow.context.editing === id) workflow.context.editing = null;
      },
    },
  );
  const [pendingRenames, setPendingRenames] = createSignal<Record<string, { name: string }>>({});
  const constantName = (constant: ResourceConstant.Model) =>
    pendingRenames()[constant.id]?.name ?? constant.name;
  const renameConstant = async (id: string, name: string) => {
    const pending = { name };
    setPendingRenames((current) => ({ ...current, [id]: pending }));
    try {
      await props.onRenameConstant(id, name);
    } finally {
      setPendingRenames((current) => {
        if (current[id] !== pending) return current;
        const { [id]: completed, ...remaining } = current;
        return remaining;
      });
    }
  };
  const constantGroups = createMemo(() => {
    const query = props.search.trim().toLowerCase();
    const groups = new Map<
      string,
      { resource: ResourceConstant.ResourceRef; constants: Array<ResourceConstant.Model> }
    >();

    for (const constant of Object.values(props.constants)) {
      const key = `${constant.resource.package}\0${constant.resource.resource}`;
      const group = groups.get(key);
      if (group) group.constants.push(constant);
      else groups.set(key, { resource: constant.resource, constants: [constant] });
    }

    if (query === "") return [...groups.values()];

    return [...groups.values()].flatMap((group) => {
      const data = props.resourceDefinition(group.resource);
      const groupMatches = [
        group.resource.package,
        group.resource.resource,
        data?.pkg.name,
        data?.definition.name,
        data?.definition.description,
      ].some((field) => field?.toLowerCase().includes(query) === true);
      if (groupMatches) return [group];

      const values = props.valuesFor(group.resource);
      const constants = group.constants.filter((constant) => {
        const selectedValue = values.find(
          (value) => JSON.stringify(value.id) === JSON.stringify(constant.value),
        );
        return [constantName(constant), constant.id, selectedValue?.display].some(
          (field) => field?.toLowerCase().includes(query) === true,
        );
      });
      return constants.length === 0 ? [] : [{ ...group, constants }];
    });
  });
  const filteredResourceGroups = createMemo(() => {
    const query = constantWorkflow.context.search.trim().toLowerCase();
    return props.allPackages
      .map((pkg) => ({
        pkg,
        resources: pkg.resources.filter(
          (resource) =>
            query === "" ||
            resource.name.toLowerCase().includes(query) ||
            resource.description?.toLowerCase().includes(query) === true ||
            pkg.name.toLowerCase().includes(query),
        ),
      }))
      .filter(({ resources }) => resources.length > 0);
  });
  const actionsConstant = createMemo(() => {
    const menu = actionsMenu();
    if (!menu || !props.canEditConstants || props.section !== "constants") return;
    return constantGroups()
      .flatMap((group) => group.constants)
      .find((constant) => constant.id === menu.id);
  });
  createEffect(actionsConstant, (constant) => {
    if (!constant) closeActions();
  });
  createEffect(actionsMenu, (menu) => {
    if (!menu) return;
    queueMicrotask(() => actionsElement?.querySelector<HTMLButtonElement>("button")?.focus());
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof globalThis.Node &&
        !actionsElement?.contains(event.target) &&
        !actionsTrigger?.contains(event.target)
      )
        closeActions();
    };
    const dismiss = () => closeActions();
    const scroll = (event: Event) => {
      if (event.target instanceof globalThis.Node && actionsElement?.contains(event.target)) return;
      closeActions();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeActions(true);
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("keydown", escape, true);
    };
  });
  const createMenuOpen = () => constantWorkflow.mode === "present";
  const createMenuPosition = () => {
    const bounds = createMenuTrigger?.getBoundingClientRect();
    const width = Math.min(224, innerWidth - 16);
    return {
      left: `${Math.max(8, Math.min(innerWidth - width - 8, (bounds?.left ?? 8) + (bounds?.width ?? width) / 2 - width / 2))}px`,
      top: `${(bounds?.bottom ?? 32) + 4}px`,
      width: `${width}px`,
    };
  };

  createEffect(
    () => {
      const pending = constantWorkflow.context.pending;
      if (pending === null) return;
      return Object.values(props.constants).find(
        (constant) =>
          !pending.ids.has(constant.id) &&
          constant.resource.package === pending.resource.package &&
          constant.resource.resource === pending.resource.resource,
      )?.id;
    },
    (createdId) => {
      if (createdId === undefined) return;
      constantWorkflowActions.created(createdId);
    },
  );

  createEffect(
    () => props.section,
    (section) => {
      if (section !== "constants") constantWorkflowActions.closePicker();
    },
  );

  createEffect(
    () => true,
    () => {
      const closeCreateMenuOnOutsideClick = (event: PointerEvent) => {
        if (createMenuOpen() && !createMenuRoot?.contains(event.target as globalThis.Node))
          constantWorkflowActions.closePicker();
      };
      const closeCreateMenuOnEscape = (event: KeyboardEvent) => {
        if (createMenuOpen() && event.key === "Escape") {
          constantWorkflowActions.closePicker();
          createMenuTrigger?.focus();
        }
      };
      const closeCreateMenuOnViewportChange = () => constantWorkflowActions.closePicker();
      window.addEventListener("pointerdown", closeCreateMenuOnOutsideClick);
      window.addEventListener("keydown", closeCreateMenuOnEscape);
      window.addEventListener("resize", closeCreateMenuOnViewportChange);
      return () => {
        window.removeEventListener("pointerdown", closeCreateMenuOnOutsideClick);
        window.removeEventListener("keydown", closeCreateMenuOnEscape);
        window.removeEventListener("resize", closeCreateMenuOnViewportChange);
      };
    },
  );

  return (
    <Sidebar side="left" open onClose={props.onClose}>
      <div style={{ "flex-shrink": "0" }}>
        <div sx={styles.topTabs}>
          <div sx={styles.tabGrid}>
            <For each={["graphs", "packages", "constants", "types"] as const}>
              {(section) => (
                <button
                  type="button"
                  sx={[
                    styles.focus,
                    styles.tab,
                    props.section === section ? styles.activeTab : styles.inactiveTab,
                  ]}
                  aria-pressed={props.section === section ? "true" : "false"}
                  onClick={() => props.onSectionChange(section)}
                >
                  {section === "graphs"
                    ? "Graphs"
                    : section === "packages"
                      ? "Plugins"
                      : section === "types"
                        ? "Types"
                        : "Constants"}
                </button>
              )}
            </For>
          </div>
        </div>
        <div sx={styles.toolbar}>
          <div sx={[searchMarker, styles.search]}>
            <IconTablerSearch {...stylex.attrs(styles.searchIcon)} />
            <input
              sx={styles.searchInput}
              placeholder={
                props.section === "graphs"
                  ? "Search Graphs"
                  : props.section === "packages"
                    ? "Search Plugins"
                    : props.section === "types"
                      ? "Search Types"
                      : "Search Constants"
              }
              value={props.search}
              onInput={(event) => props.onSearchChange(event.currentTarget.value)}
            />
          </div>
          <Show when={props.section === "graphs"}>
            <button
              type="button"
              sx={[styles.focus, styles.newButton]}
              aria-label="New graph"
              title="New graph"
              onClick={props.onCreateGraph}
            >
              <IconBiPlus aria-hidden="true" {...stylex.attrs(styles.plusIcon)} />
            </button>
          </Show>
          <Show when={props.section === "constants"}>
            <div ref={createMenuRoot} sx={styles.createRoot}>
              <button
                ref={createMenuTrigger}
                type="button"
                sx={[styles.focus, styles.newButton]}
                aria-label="New constant"
                title="New constant"
                aria-haspopup="dialog"
                aria-expanded={createMenuOpen() ? "true" : "false"}
                onClick={() => constantWorkflowActions.togglePicker()}
              >
                <IconBiPlus aria-hidden="true" {...stylex.attrs(styles.plusIcon)} />
              </button>
              <Show when={constantWorkflow.mode !== "hidden"}>
                <div
                  role="dialog"
                  aria-label="Choose resource for new constant"
                  sx={[
                    styles.dialog,
                    constantWorkflow.mode === "hiding" ? styles.hiding : styles.showing,
                  ]}
                  style={createMenuPosition()}
                  onAnimationEnd={(event) => {
                    if (event.target === event.currentTarget)
                      constantWorkflowActions.pickerHidden();
                  }}
                  onAnimationCancel={(event) => {
                    if (event.target === event.currentTarget)
                      constantWorkflowActions.pickerHidden();
                  }}
                >
                  <div sx={[searchMarker, styles.dialogSearch]}>
                    <IconTablerSearch
                      {...stylex.attrs(styles.searchIcon, styles.smallSearchIcon)}
                    />
                    <input
                      ref={(input) => queueMicrotask(() => input.focus())}
                      aria-label="Search resources"
                      sx={[styles.searchInput, styles.dialogInput]}
                      placeholder="Search resources"
                      value={constantWorkflow.context.search}
                      onInput={(event) => constantWorkflowActions.search(event.currentTarget.value)}
                    />
                  </div>
                  <div sx={styles.typeList}>
                    <For
                      each={filteredResourceGroups()}
                      fallback={<div sx={styles.emptyTypes}>No resources found</div>}
                    >
                      {({ pkg, resources }) => (
                        <div sx={styles.resourceGroup}>
                          <div sx={styles.groupTitle}>{pkg.name}</div>
                          <For each={resources}>
                            {(resource) => (
                              <button
                                type="button"
                                sx={[styles.focus, styles.typeOption]}
                                title={resource.description}
                                onClick={() => {
                                  if (
                                    constantWorkflow.mode !== "present" ||
                                    constantWorkflow.context.pending !== null
                                  )
                                    return;
                                  const resourceRef = {
                                    package: pkg.id,
                                    resource: resource.id,
                                  };
                                  constantWorkflowActions.create(
                                    new Set(Object.keys(props.constants)),
                                    resourceRef,
                                  );
                                  props.onCreateConstant(resourceRef);
                                }}
                              >
                                {resource.name}
                              </button>
                            )}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
      <div sx={styles.scroll}>
        <Show when={props.section === "types"}>{props.typesPanel}</Show>
        <Show when={props.section === "graphs"}>
          <For
            each={props.graphs}
            fallback={
              <div sx={[styles.navOption, styles.noConstants]}>
                {props.search.trim() === "" ? "No graphs yet." : "No graphs found."}
              </div>
            }
          >
            {([id, graph]) => (
              <GraphNavigationOption
                name={graph.name}
                selected={props.selectedPaneId === `graph:${id}`}
                canEdit={props.canEditGraphs}
                onSelect={() => props.onSelectGraph(id)}
                onRename={(name) => props.onRenameGraph(id, name)}
                onDelete={() => props.onDeleteGraph(id)}
              />
            )}
          </For>
        </Show>
        <Show when={props.section === "packages"}>
          <div sx={styles.packages}>
            <Show
              when={props.packagesWithSettings.length + props.packagesWithoutSettings.length === 0}
            >
              <div sx={[styles.navOption, styles.noConstants]}>
                {props.search.trim() === "" ? "No plugins yet." : "No plugins found."}
              </div>
            </Show>
            <div style={{ "padding-bottom": "4px" }}>
              <For each={props.packagesWithSettings}>
                {(pkg) => (
                  <button
                    type="button"
                    sx={[
                      styles.focus,
                      styles.navOption,
                      props.selectedPaneId === `package:${pkg.id}`
                        ? styles.selected
                        : styles.unselected,
                    ]}
                    onClick={() => props.onOpenPackage(pkg.id)}
                  >
                    {pkg.name}
                  </button>
                )}
              </For>
            </div>
            <Show when={props.packagesWithoutSettings.length > 0}>
              <div sx={styles.separator}>
                <div sx={styles.separatorTitle}>No editor settings</div>
                <For each={props.packagesWithoutSettings}>
                  {(pkg) => <div sx={styles.unavailablePackage}>{pkg.name}</div>}
                </For>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={props.section === "constants"}>
          <div sx={styles.constants}>
            <div sx={styles.column}>
              <For
                each={constantGroups()}
                fallback={
                  <span sx={styles.noConstants}>
                    {props.search.trim() === "" ? "No constants yet." : "No constants found."}
                  </span>
                }
              >
                {(group) => {
                  const data = () => props.resourceDefinition(group.resource);
                  return (
                    <section sx={styles.constantSection}>
                      <div sx={styles.constantHeader}>
                        <span sx={styles.noShrink}>
                          {data()?.definition.name ?? group.resource.resource}
                        </span>
                        <span sx={[styles.noShrink, styles.muted]}>·</span>
                        <span
                          sx={styles.truncate}
                          title={data()?.pkg.name ?? group.resource.package}
                        >
                          {data()?.pkg.name ?? group.resource.package}
                        </span>
                      </div>
                      <div sx={styles.constantList}>
                        <For each={group.constants}>
                          {(constant) => {
                            const values = () => props.valuesFor(constant.resource);
                            const valid = () =>
                              constant.value !== undefined &&
                              values().some(
                                (value) =>
                                  JSON.stringify(value.id) === JSON.stringify(constant.value),
                              );
                            return (
                              <div sx={styles.constantCard}>
                                <div sx={styles.row}>
                                  <Show
                                    when={constantWorkflow.context.editing === constant.id}
                                    fallback={
                                      <button
                                        type="button"
                                        sx={[styles.focus, styles.nameButton]}
                                        title={constantName(constant)}
                                        onClick={() => constantWorkflowActions.edit(constant.id)}
                                      >
                                        {constantName(constant)}
                                      </button>
                                    }
                                  >
                                    <input
                                      ref={(input) =>
                                        queueMicrotask(() => {
                                          input.focus();
                                          input.select();
                                        })
                                      }
                                      sx={styles.nameInput}
                                      value={constantName(constant)}
                                      onBlur={(event) => {
                                        const name = event.currentTarget.value;
                                        constantWorkflowActions.finishEdit(constant.id);
                                        if (name !== constantName(constant))
                                          void renameConstant(constant.id, name).catch(
                                            console.error,
                                          );
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") event.currentTarget.blur();
                                        if (event.key === "Escape") {
                                          event.currentTarget.value = constantName(constant);
                                          event.currentTarget.blur();
                                        }
                                      }}
                                    />
                                  </Show>
                                  <Show when={isDefault(constant)}>
                                    <span
                                      sx={styles.defaultAccent}
                                      role="img"
                                      aria-label={`${constantName(constant)} is the default for new nodes`}
                                      title="Default for new nodes"
                                    />
                                  </Show>
                                  <Show when={props.canEditConstants}>
                                    <button
                                      type="button"
                                      sx={[styles.focus, styles.actionsButton]}
                                      aria-label={`Actions for ${constantName(constant)}`}
                                      aria-haspopup="menu"
                                      aria-expanded={
                                        actionsMenu()?.id === constant.id ? "true" : "false"
                                      }
                                      title="Constant actions"
                                      onClick={(event) => {
                                        if (actionsMenu()?.id === constant.id) closeActions(true);
                                        else openActions(constant.id, event.currentTarget);
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key !== "ArrowDown") return;
                                        event.preventDefault();
                                        openActions(constant.id, event.currentTarget);
                                      }}
                                    >
                                      <IconMdiDotsHorizontal
                                        aria-hidden="true"
                                        {...stylex.attrs(styles.actionsIcon)}
                                      />
                                    </button>
                                  </Show>
                                </div>
                                <Select
                                  appearance={styles.constantValueAppearance}
                                  options={values().map((value) => ({
                                    id: JSON.stringify(value.id),
                                    name: value.display,
                                  }))}
                                  value={
                                    constant.value === undefined
                                      ? ""
                                      : JSON.stringify(constant.value)
                                  }
                                  valid={valid()}
                                  placeholder="Select value"
                                  unavailableLabel="Unavailable"
                                  missingLabel="Previously selected (unavailable)"
                                  onChange={(value) => {
                                    props.onSelectConstant(constant.id, JSON.parse(value));
                                  }}
                                />
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </section>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>
      </div>
      <Show when={actionsConstant()}>
        {(constant) => (
          <Portal>
            <div
              ref={actionsElement}
              role="menu"
              aria-label={`Actions for ${constantName(constant())}`}
              sx={styles.actionsMenu}
              style={actionsPosition()}
              onKeyDown={(event) => {
                event.stopPropagation();
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
                );
                const index = buttons.findIndex((button) => button === document.activeElement);
                if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) %
                          buttons.length;
                  buttons[next]?.focus();
                }
                if (event.key === "Tab") closeActions(true);
              }}
            >
              <button
                type="button"
                role="menuitem"
                tabindex={-1}
                sx={[
                  styles.focus,
                  styles.menuAction,
                  isDefault(constant()) && styles.disabledAction,
                ]}
                aria-disabled={isDefault(constant()) ? "true" : "false"}
                title="Used by new nodes. Existing nodes keep their selections."
                onClick={() => {
                  if (isDefault(constant())) return;
                  const id = constant().id;
                  closeActions(true);
                  props.onSetDefaultConstant(id);
                }}
              >
                {isDefault(constant()) ? "Default for new nodes" : "Make default"}
              </button>
              <div role="separator" sx={styles.menuDivider} />
              <button
                type="button"
                role="menuitem"
                tabindex={-1}
                sx={[styles.focus, styles.menuAction, styles.dangerAction]}
                onClick={() => {
                  const id = constant().id;
                  closeActions(true);
                  props.onDeleteConstant(id);
                }}
              >
                Delete
              </button>
            </div>
          </Portal>
        )}
      </Show>
    </Sidebar>
  );
}
