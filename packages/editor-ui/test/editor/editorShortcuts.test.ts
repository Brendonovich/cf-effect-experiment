// @vitest-environment happy-dom

import { Graph, Node, PackageId, Project, SchemaId } from "@macrograph/core";
import { createRoot, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorCanvas } from "../../src/editor/graph/createEditorCanvas";
import { createEditorShortcuts } from "../../src/editor/createEditorShortcuts";
import { createEditorWorkspace } from "../../src/editor/workspace/createEditorWorkspace";
import { createEditorStore } from "../../src/editor/store";
import {
  createWorkspaceState,
  saveWorkspaceState,
  selectedTab,
  workspaceStorageKey,
} from "../../src/editor/workspace/workspace";

vi.mock(
  "solid-js",
  () => import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href),
);

let dispose = () => {};
let media: EventTarget & { matches: boolean };

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
});

afterEach(() => {
  dispose();
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const settle = async () => {
  await Promise.resolve();
  flush();
};

const press = (code: string, key: string, modifiers: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", {
    code,
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  document.body.dispatchEvent(event);
  flush();
  return event;
};

const setup = () => {
  const root = document.createElement("div");
  const activeCanvas = document.createElement("div");
  activeCanvas.setAttribute("data-active-graph-canvas", "");
  vi.spyOn(activeCanvas, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 80, 600, 400));
  root.append(activeCanvas);
  document.body.append(root);
  saveWorkspaceState(
    localStorage,
    workspaceStorageKey("shortcuts", "user"),
    createWorkspaceState({ type: "graph", graphId: "main" }),
  );
  const state = createRoot((cleanup) => {
    dispose = cleanup;
    const editor = createEditorStore();
    const nodes: Node.Model[] = ["expanded", "folded", "unselected"].map((id) => ({
      id: Node.NodeId.make(id),
      name: id,
      schema: { package: PackageId.make("test"), schema: SchemaId.make("test") },
      properties: {},
      inputDefaults: {},
      foldPins: id === "folded",
      position: { x: 0, y: 0 },
    }));
    editor.setProject(
      {
        ...Project.empty(),
        graphs: {
          main: {
            ...Graph.empty("main"),
            nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
          },
          other: Graph.empty("other"),
        },
      },
      {},
    );
    const layout = createEditorWorkspace(
      { workspaceId: "shortcuts", userId: "user", projectSettings: true },
      editor,
      () => {},
    );
    const canvas = createEditorCanvas({
      publishPointer: () => {},
      ...layout,
      editor,
      client: () => null,
      canEdit: () => true,
    });
    canvas.setGraphCanvas(activeCanvas);
    const commands = {
      deleteNode: vi.fn<(nodeId: string) => void>(),
      setNodeFoldPins: vi.fn<(nodeId: string, foldPins: boolean) => void>(),
    };
    createEditorShortcuts(() => root, layout, canvas, commands);
    return { editor, layout, canvas, commands, nodes };
  });
  flush();
  return { ...state, root, activeCanvas };
};

describe("createEditorShortcuts", () => {
  it("restores the last navigation section and toggles inspector and pane zoom", () => {
    const { layout } = setup();
    layout.setNavSection("packages");
    flush();
    expect(press("KeyB", "b", { metaKey: true }).defaultPrevented).toBe(true);
    expect(layout.navSection()).toBeNull();
    press("KeyB", "b", { metaKey: true });
    expect(layout.navSection()).toBe("packages");
    const inspectorOpen = layout.inspectorOpen();
    expect(press("KeyR", "r", { metaKey: true }).defaultPrevented).toBe(true);
    expect(layout.inspectorOpen()).toBe(!inspectorOpen);
    press("KeyR", "r", { metaKey: true });
    expect(layout.inspectorOpen()).toBe(inspectorOpen);
    expect(press("Escape", "Escape", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(layout.workspace().zoomedPaneId).toBe(layout.workspace().focusedPaneId);
    press("Escape", "Escape", { shiftKey: true });
    expect(layout.paneZoomed()).toBe(false);
  });

  it.each(["horizontal", "vertical"] as const)(
    "splits %s and cycles and closes tabs only in the focused pane",
    async (direction) => {
      const { layout } = setup();
      layout.setSelectedNodeIds(["expanded"]);
      layout.setCanvasOrigin({ x: 30, y: 50 });
      layout.setCanvasScale(1.5);
      flush();
      const originalPaneId = layout.workspace().focusedPaneId;
      const originalPane = layout.workspace().panes[originalPaneId];
      expect(
        press("Backslash", direction === "vertical" ? "|" : "\\", {
          metaKey: true,
          shiftKey: direction === "vertical",
        }).defaultPrevented,
      ).toBe(true);
      await settle();
      const focusedPaneId = layout.workspace().focusedPaneId;
      expect(focusedPaneId).not.toBe(originalPaneId);
      expect(layout.workspace().root).toMatchObject({ type: "split", direction });
      expect(Object.keys(layout.workspace().panes)).toHaveLength(2);
      expect(layout.selectedGraphId()).toBe("main");
      expect(layout.selectedNodeIds()).toEqual(["expanded"]);

      layout.setSelectedGraphId("other");
      await settle();
      expect(layout.selectedGraphId()).toBe("other");
      expect(layout.selectedNodeIds()).toEqual([]);
      expect(press("ArrowLeft", "ArrowLeft", { metaKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(layout.selectedGraphId()).toBe("main");
      expect(layout.canvasOrigin()).toEqual({ x: 30, y: 50 });
      expect(layout.canvasScale()).toBe(1.5);
      expect(layout.selectedNodeIds()).toEqual(["expanded"]);
      press("ArrowLeft", "ArrowLeft", { metaKey: true });
      await settle();
      expect(layout.selectedGraphId()).toBe("other");
      press("ArrowRight", "ArrowRight", { metaKey: true });
      await settle();
      expect(layout.selectedGraphId()).toBe("main");
      expect(layout.workspace().panes[originalPaneId]).toEqual(originalPane);

      expect(press("KeyW", "w", { ctrlKey: true }).defaultPrevented).toBe(true);
      await settle();
      expect(layout.selectedGraphId()).toBe("other");
      expect(layout.workspace().panes[focusedPaneId]?.tabs).toHaveLength(1);
      press("KeyW", "w", { ctrlKey: true });
      await settle();
      expect(layout.workspace().focusedPaneId).toBe(originalPaneId);
      expect(layout.workspace().root).toEqual({ type: "pane", paneId: originalPaneId });
      expect(layout.workspace().panes[originalPaneId]).toEqual(originalPane);
      expect(layout.selectedGraphId()).toBe("main");
    },
  );

  it.each(["metaKey", "ctrlKey"] as const)(
    "%s folds and expands only selected nodes whose pin state changes",
    (modifier) => {
      const { layout, commands } = setup();
      layout.setSelectedNodeIds(["expanded", "folded"]);
      flush();
      expect(press("BracketLeft", "[", { [modifier]: true, altKey: true }).defaultPrevented).toBe(
        true,
      );
      expect(commands.setNodeFoldPins.mock.calls).toEqual([["expanded", true]]);
      commands.setNodeFoldPins.mockClear();
      expect(press("BracketRight", "]", { [modifier]: true, altKey: true }).defaultPrevented).toBe(
        true,
      );
      expect(commands.setNodeFoldPins.mock.calls).toEqual([["folded", false]]);
      expect(commands.deleteNode).not.toHaveBeenCalled();
    },
  );

  it.each(["Delete", "Backspace"])("%s deletes the focused graph selection only", async (key) => {
    const { layout, commands } = setup();
    layout.setSelectedNodeIds(["expanded"]);
    flush();
    const originalPaneId = layout.workspace().focusedPaneId;
    press("Backslash", "\\", { metaKey: true });
    await settle();
    layout.setSelectedNodeIds(["folded", "unselected"]);
    flush();
    expect(press(key, key).defaultPrevented).toBe(true);
    expect(commands.deleteNode.mock.calls.map(([id]) => id)).toEqual(["folded", "unselected"]);
    expect(selectedTab(layout.workspace(), originalPaneId)).toMatchObject({
      type: "graph",
      view: { selectedNodeIds: ["expanded"] },
    });
  });

  it.each([
    { modifier: "metaKey", pointer: "inside" },
    { modifier: "ctrlKey", pointer: "inside" },
    { modifier: "metaKey", pointer: "outside" },
    { modifier: "ctrlKey", pointer: "untracked" },
  ] as const)(
    "$modifier+Period opens at the $pointer pointer using active canvas geometry",
    ({ modifier, pointer }) => {
      const { root, layout, canvas } = setup();
      const staleCanvas = document.createElement("div");
      vi.spyOn(staleCanvas, "getBoundingClientRect").mockReturnValue(
        new DOMRect(900, 900, 100, 100),
      );
      canvas.setGraphCanvas(staleCanvas);
      layout.setCanvasScale(2);
      layout.setCanvasOrigin({ x: -30, y: 40 });
      flush();
      if (pointer !== "untracked")
        root.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: pointer === "inside" ? 260 : 20,
            clientY: pointer === "inside" ? 220 : 20,
          }),
        );
      expect(press("Period", ".", { [modifier]: true }).defaultPrevented).toBe(true);
      expect(canvas.nodeMenu()).toEqual(
        pointer === "inside"
          ? {
              screen: { x: 260, y: 220 },
              graph: { x: 50, y: 110 },
            }
          : {
              screen: { x: 400, y: 280 },
              graph: { x: 120, y: 140 },
            },
      );
    },
  );

  it.each(["creation", "context"])(
    "Escape cancels dragging, then the %s menu, then pane zoom",
    (menu) => {
      const { layout, canvas, nodes, commands } = setup();
      press("Escape", "Escape", { shiftKey: true });
      if (menu === "creation")
        canvas.setNodeMenu({ screen: { x: 200, y: 200 }, graph: { x: 100, y: 120 } });
      else canvas.setNodeContextMenu({ nodeId: "expanded", screen: { x: 200, y: 200 } });
      canvas.onNodeMouseDown(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          button: 0,
          clientX: 200,
          clientY: 200,
        }),
        nodes[0]!,
      );
      flush();
      expect(canvas.isDragging()).toBe(true);
      expect(press("Delete", "Delete").defaultPrevented).toBe(false);
      expect(press("Period", ".", { metaKey: true }).defaultPrevented).toBe(false);
      expect(commands.deleteNode).not.toHaveBeenCalled();
      expect(press("Escape", "Escape").defaultPrevented).toBe(true);
      expect(canvas.isDragging()).toBe(false);
      expect(menu === "creation" ? canvas.nodeMenu() : canvas.nodeContextMenu()).toBeDefined();
      expect(layout.paneZoomed()).toBe(true);
      expect(press("Escape", "Escape").defaultPrevented).toBe(true);
      expect(canvas.nodeMenu()).toBeUndefined();
      expect(canvas.nodeContextMenu()).toBeUndefined();
      expect(layout.paneZoomed()).toBe(true);
      expect(press("Escape", "Escape").defaultPrevented).toBe(true);
      expect(layout.paneZoomed()).toBe(false);
      expect(press("Escape", "Escape").defaultPrevented).toBe(false);
    },
  );

  it("leaves unavailable graph actions unhandled", async () => {
    const { layout, activeCanvas, commands, canvas } = setup();
    expect(press("Delete", "Delete").defaultPrevented).toBe(false);
    expect(press("BracketLeft", "[", { metaKey: true, altKey: true }).defaultPrevented).toBe(false);
    activeCanvas.remove();
    expect(press("Period", ".", { metaKey: true }).defaultPrevented).toBe(false);
    layout.openProjectSettings(layout.workspace().focusedPaneId);
    await settle();
    expect(layout.selectedGraphId()).toBeNull();
    expect(press("Period", ".", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press("Backspace", "Backspace").defaultPrevented).toBe(false);
    expect(commands.deleteNode).not.toHaveBeenCalled();
    expect(commands.setNodeFoldPins).not.toHaveBeenCalled();
    expect(canvas.nodeMenu()).toBeUndefined();
  });

  it("does not split panes on mobile or consume their shortcuts", () => {
    const { layout } = setup();
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    flush();
    expect(layout.isMobile()).toBe(true);
    const workspace = layout.workspace();
    expect(press("Backslash", "\\", { metaKey: true }).defaultPrevented).toBe(false);
    expect(press("Backslash", "|", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(layout.workspace()).toEqual(workspace);
  });

  it("stops handling shortcuts and removes pointer tracking on disposal", () => {
    const { root, layout, commands } = setup();
    layout.setSelectedNodeIds(["expanded"]);
    flush();
    const remove = vi.spyOn(root, "removeEventListener");
    const workspace = layout.workspace();
    dispose();
    expect(remove).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(press("KeyB", "b", { metaKey: true }).defaultPrevented).toBe(false);
    expect(press("Delete", "Delete").defaultPrevented).toBe(false);
    expect(press("Backslash", "\\", { metaKey: true }).defaultPrevented).toBe(false);
    expect(layout.workspace()).toEqual(workspace);
    expect(commands.deleteNode).not.toHaveBeenCalled();
  });
});
