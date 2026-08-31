// @vitest-environment happy-dom

import { Graph, IoId, Node, PackageId, Project, SchemaId } from "@macrograph/core";
import { Effect } from "effect";
import { createMemo, createRoot, createSignal, flush, untrack } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditorCanvas } from "../../src/editor/graph/createEditorCanvas";
import type { EditorRpcClient } from "../../src/editor/Editor";
import { createEditorController } from "../../src/editor/createEditorController";
import { createEditorWorkspace } from "../../src/editor/workspace/createEditorWorkspace";
import { createEditorStore } from "../../src/editor/store";
import {
  saveWorkspaceState,
  createWorkspaceState,
  selectedTab,
  workspaceStorageKey,
} from "../../src/editor/workspace/workspace";

vi.mock(
  "solid-js",
  () => import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href),
);

let dispose = () => {};
let media: EventTarget & { matches: boolean };
let storage: {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

beforeEach(() => {
  const values = new Map<string, string>();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const setup = () =>
  createRoot((cleanup) => {
    dispose = cleanup;
    const editor = createEditorStore();
    editor.setProject({ ...Project.empty(), graphs: { main: Graph.empty("main") } }, {});
    const leaveGraph = vi.fn();
    const layout = createEditorWorkspace(
      {
        workspaceId: "test",
        userId: "user",
        projectSettings: true,
      },
      editor,
      leaveGraph,
    );
    return { editor, layout, leaveGraph };
  });

describe("editor concern hooks", () => {
  it("allows the parent to control workspace state before an editor view exists", async () => {
    const controller = createRoot((cleanup) => {
      dispose = cleanup;
      return createEditorController({
        connection: Effect.never,
        workspaceId: "test",
        userId: "user",
        settingsDescriptors: [],
        projectSettings: true,
      });
    });
    controller.editor.setProject({ ...Project.empty(), graphs: { main: Graph.empty("main") } }, {});
    flush();
    controller.layout.setSelectedGraphId("main");
    await Promise.resolve();
    flush();
    expect(controller.layout.selectedGraphId()).toBe("main");
    controller.openProjectSettings();
    await Promise.resolve();
    flush();
    expect(controller.layout.selectedPaneId()).toBe("settings");
    expect(controller.layout.selectedGraphId()).toBeNull();
    await controller.refreshPluginData();
  });

  it("scopes connections to the parent controller and disposes replaced controllers", async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const state = createRoot((cleanup) => {
      dispose = cleanup;
      const [id, setId] = createSignal("first");
      const controller = createMemo(() => {
        const projectId = id();
        return createEditorController({
          connection: Effect.gen(function* () {
            opened.push(projectId);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                closed.push(projectId);
              }),
            );
            return yield* Effect.never;
          }),
          workspaceId: projectId,
          userId: "user",
          settingsDescriptors: [],
        });
      });
      return { controller, setId };
    });
    const first = untrack(state.controller);
    await vi.waitFor(() => expect(opened).toEqual(["first"]));
    const disposeView = createRoot((cleanup) => {
      expect(first.connection.client()).toBeNull();
      return cleanup;
    });
    disposeView();
    expect(closed).toEqual([]);
    state.setId("second");
    flush();
    await vi.waitFor(() => {
      expect(opened).toEqual(["first", "second"]);
      expect(closed).toEqual(["first"]);
    });
    expect(untrack(state.controller)).not.toBe(first);
    dispose();
    await vi.waitFor(() => expect(closed).toEqual(["first", "second"]));
  });

  it("restores graph views and persists changes independently of the renderer", () => {
    saveWorkspaceState(
      storage,
      workspaceStorageKey("test", "user"),
      createWorkspaceState({ type: "graph", graphId: "main" }),
    );
    const { layout, leaveGraph } = setup();
    flush();
    expect(layout.selectedGraphId()).toBe("main");
    layout.setCanvasOrigin({ x: 120, y: 80 });
    layout.setCanvasScale(1.5);
    flush();
    const tab = selectedTab(layout.workspace());
    expect(tab?.type === "graph" && tab.view).toMatchObject({
      origin: { x: 120, y: 80 },
      scale: 1.5,
    });
    expect(storage.getItem(workspaceStorageKey("test", "user"))).toContain('"scale":1.5');
    layout.openProjectSettings(layout.workspace().focusedPaneId);
    flush();
    layout.activateWorkspacePane(layout.workspace().focusedPaneId);
    flush();
    expect(layout.selectedGraphId()).toBeNull();
    expect(leaveGraph).toHaveBeenCalled();
  });

  it("owns responsive panel state and removes its media listener on disposal", () => {
    const add = vi.spyOn(media, "addEventListener");
    const remove = vi.spyOn(media, "removeEventListener");
    const { layout } = setup();
    flush();
    expect(add).toHaveBeenCalledWith("change", expect.any(Function));
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    flush();
    expect(layout.isMobile()).toBe(true);
    layout.setNavSection("packages");
    flush();
    expect(layout.navSection()).toBe("packages");
    layout.setInspectorOpen(true);
    flush();
    expect(layout.inspectorOpen()).toBe(true);
    expect(layout.navSection()).toBeNull();
    dispose();
    expect(remove).toHaveBeenCalledWith("change", add.mock.calls[0]![1]);
  });

  it.each(["pointerup", "pointercancel", "escape", "dispose"])(
    "tracks locally dragged nodes reactively until %s",
    (end) => {
      const publishPointer = vi.fn();
      const { canvas, editor, nodes, dragging, setSelectedNodeIds } = createRoot((cleanup) => {
        dispose = cleanup;
        const editor = createEditorStore();
        const nodes: Node.Model[] = ["first", "second", "other"].map((id) => ({
          id: Node.NodeId.make(id),
          name: id,
          schema: { package: PackageId.make("test"), schema: SchemaId.make("test") },
          properties: {},
          inputDefaults: {},
          foldPins: false,
          position: { x: 0, y: 0 },
        }));
        editor.setProject(
          {
            ...Project.empty(),
            graphs: {
              main: {
                ...Graph.empty("main"),
                nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
              },
            },
          },
          {},
        );
        const [selectedNodeIds, setSelectedNodeIds] = createSignal(["first", "second"]);
        const canvas = createEditorCanvas({
          editor,
          client: () => null,
          canEdit: () => true,
          publishPointer,
          selectedGraphId: () => "main",
          selectedGraph: () => editor.store.project!.graphs.main!,
          nodes: () => nodes,
          selectedNodeIds,
          setSelectedNodeIds,
          canvasScale: () => 2,
          setCanvasScale: () => {},
          canvasOrigin: () => ({ x: 100, y: 200 }),
          setCanvasOrigin: () => {},
        });
        canvas.setGraphCanvas({
          getBoundingClientRect: () => ({ left: -10, top: -20, right: 100, bottom: 100 }),
        } as HTMLDivElement);
        const dragging = createMemo(() => nodes.map((node) => canvas.isNodeDragging(node.id)));
        return { canvas, editor, nodes, dragging, setSelectedNodeIds };
      });
      flush();
      expect(untrack(dragging)).toEqual([false, false, false]);
      const pointer = { pointerId: 1, button: 0, shiftKey: false, clientX: 10, clientY: 20 };
      canvas.onNodeMouseDown(
        Object.assign(new Event("pointerdown"), pointer) as PointerEvent,
        nodes[0]!,
      );
      flush();
      expect(untrack(dragging)).toEqual([true, true, false]);
      expect(canvas.isDragging()).toBe(true);

      setSelectedNodeIds(["other"]);
      window.dispatchEvent(Object.assign(new Event("pointermove"), { ...pointer, clientX: 30 }));
      flush();
      expect(untrack(dragging)).toEqual([true, true, false]);
      expect(editor.store.project?.graphs.main?.nodes.first?.position).toEqual({ x: 10, y: 0 });
      expect(editor.store.project?.graphs.main?.nodes.second?.position).toEqual({ x: 10, y: 0 });
      expect(publishPointer).toHaveBeenLastCalledWith({ x: 120, y: 220 }, false);

      window.dispatchEvent(Object.assign(new Event("pointermove"), { ...pointer, pointerId: 2 }));
      window.dispatchEvent(Object.assign(new Event("pointerup"), { ...pointer, pointerId: 2 }));
      expect(canvas.isDragging()).toBe(true);
      expect(publishPointer).toHaveBeenCalledTimes(1);
      window.dispatchEvent(
        Object.assign(new Event("pointermove"), { ...pointer, pointerType: "touch" }),
      );
      expect(publishPointer).toHaveBeenCalledTimes(1);
      window.dispatchEvent(Object.assign(new Event("pointermove"), { ...pointer, clientX: 150 }));
      expect(publishPointer).toHaveBeenLastCalledWith(null, false);
      window.dispatchEvent(Object.assign(new Event("pointermove"), pointer));
      expect(publishPointer).toHaveBeenLastCalledWith({ x: 110, y: 220 }, false);
      if (end === "escape") canvas.cancelNodeDrag();
      else if (end === "dispose") dispose();
      else window.dispatchEvent(Object.assign(new Event(end), pointer));
      flush();
      expect(canvas.isDragging()).toBe(false);
      if (end === "pointerup")
        expect(publishPointer).toHaveBeenLastCalledWith({ x: 110, y: 220 }, true);
      else if (end === "pointercancel")
        expect(publishPointer).toHaveBeenLastCalledWith(null, true);
      const calls = publishPointer.mock.calls.length;
      window.dispatchEvent(Object.assign(new Event("pointermove"), pointer));
      expect(publishPointer).toHaveBeenCalledTimes(calls);
      for (const node of nodes) expect(canvas.isNodeDragging(node.id)).toBe(false);
      if (end !== "dispose") expect(untrack(dragging)).toEqual([false, false, false]);
    },
  );

  it("distinguishes node-name Shift clicks from group drags without writing click positions", () => {
    const setNodePosition = vi.fn(() => Effect.never);
    const { canvas, editor, nodes, selectedNodeIds } = createRoot((cleanup) => {
      dispose = cleanup;
      const editor = createEditorStore();
      const nodes: Node.Model[] = ["first", "second", "other"].map((id) => ({
        id: Node.NodeId.make(id),
        name: id,
        schema: { package: PackageId.make("test"), schema: SchemaId.make("test") },
        properties: {},
        inputDefaults: {},
        foldPins: false,
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
          },
        },
        {},
      );
      const [selectedNodeIds, setSelectedNodeIds] = createSignal(["first"]);
      const canvas = createEditorCanvas({
        editor,
        client: () => ({ SetNodePosition: setNodePosition }) as unknown as EditorRpcClient,
        canEdit: () => true,
        publishPointer: () => {},
        selectedGraphId: () => "main",
        selectedGraph: () => editor.store.project!.graphs.main!,
        nodes: () => nodes,
        selectedNodeIds,
        setSelectedNodeIds,
        canvasScale: () => 1,
        setCanvasScale: () => {},
        canvasOrigin: () => ({ x: 0, y: 0 }),
        setCanvasOrigin: () => {},
      });
      return { canvas, editor, nodes, selectedNodeIds };
    });
    flush();
    const pointer = { pointerId: 1, button: 0, shiftKey: true, clientX: 0, clientY: 0 };
    const press = (node: Node.Model, overrides: Partial<typeof pointer> = {}) => {
      const event = Object.assign(
        new Event("pointerdown", { cancelable: true }),
        pointer,
        overrides,
      );
      canvas.onNodeMouseDown(event as PointerEvent, node);
      flush();
      return event;
    };

    press(nodes[1]!);
    expect(selectedNodeIds()).toEqual(["first", "second"]);
    expect(nodes.map((node) => canvas.isNodeDragging(node.id))).toEqual([true, true, false]);
    window.dispatchEvent(Object.assign(new Event("pointerup"), pointer));
    flush();
    expect(setNodePosition).not.toHaveBeenCalled();

    press(nodes[1]!);
    expect(selectedNodeIds()).toEqual(["first", "second"]);
    window.dispatchEvent(
      Object.assign(new Event("pointermove"), pointer, { clientX: 3, clientY: 4 }),
    );
    window.dispatchEvent(
      Object.assign(new Event("pointerup"), pointer, { clientX: 3, clientY: 4 }),
    );
    flush();
    expect(selectedNodeIds()).toEqual(["first"]);
    expect(canvas.isDragging()).toBe(false);
    window.dispatchEvent(Object.assign(new Event("pointermove"), pointer, { clientX: 40 }));
    window.dispatchEvent(Object.assign(new Event("pointerup"), pointer, { clientX: 40 }));
    for (const node of nodes)
      expect(editor.store.project?.graphs.main?.nodes[node.id]?.position).toEqual({ x: 0, y: 0 });

    press(nodes[0]!);
    window.dispatchEvent(Object.assign(new Event("pointercancel"), pointer));
    flush();
    expect(selectedNodeIds()).toEqual(["first"]);
    press(nodes[0]!);
    canvas.cancelNodeDrag();
    window.dispatchEvent(Object.assign(new Event("pointerup"), pointer));
    flush();
    expect(selectedNodeIds()).toEqual(["first"]);
    press(nodes[0]!);
    window.dispatchEvent(Object.assign(new Event("pointerup"), pointer));
    flush();
    expect(selectedNodeIds()).toEqual([]);
    expect(canvas.isDragging()).toBe(false);
    press(nodes[1]!);
    expect(selectedNodeIds()).toEqual(["second"]);
    window.dispatchEvent(Object.assign(new Event("pointerup"), pointer));
    flush();
    expect(setNodePosition).not.toHaveBeenCalled();

    for (const button of [1, 2]) {
      expect(press(nodes[2]!, { button }).defaultPrevented).toBe(false);
      expect(selectedNodeIds()).toEqual(["second"]);
      expect(canvas.isDragging()).toBe(false);
    }
    press(nodes[2]!, { shiftKey: false });
    expect(selectedNodeIds()).toEqual(["other"]);
    expect(nodes.map((node) => canvas.isNodeDragging(node.id))).toEqual([false, false, true]);
    window.dispatchEvent(Object.assign(new Event("pointerup"), pointer));
    flush();
    expect(setNodePosition).not.toHaveBeenCalled();

    press(nodes[1]!);
    window.dispatchEvent(Object.assign(new Event("pointerup"), pointer));
    flush();
    expect(selectedNodeIds()).toEqual(["other", "second"]);
    press(nodes[1]!);
    window.dispatchEvent(Object.assign(new Event("pointermove"), pointer, { clientX: 6 }));
    flush();
    expect(selectedNodeIds()).toEqual(["other", "second"]);
    for (const id of ["other", "second"])
      expect(editor.store.project?.graphs.main?.nodes[id]?.position).toEqual({ x: 6, y: 0 });
    expect(editor.store.project?.graphs.main?.nodes.first?.position).toEqual({ x: 0, y: 0 });
    window.dispatchEvent(Object.assign(new Event("pointerup"), pointer, { clientX: 6 }));
    flush();
    expect(selectedNodeIds()).toEqual(["other", "second"]);
    expect(canvas.isDragging()).toBe(false);
    expect(setNodePosition).toHaveBeenCalledWith({ graphId: "main", nodeId: "other", x: 6, y: 0 });
    expect(setNodePosition).toHaveBeenCalledWith({ graphId: "main", nodeId: "second", x: 6, y: 0 });
  });

  it.each(["input", "output"] as const)(
    "retains a draft from an %s pin through the menu and async node creation",
    async (direction) => {
      const canvas = createRoot((cleanup) => {
        dispose = cleanup;
        const editor = createEditorStore();
        editor.setProject(
          { ...Project.empty(), graphs: { main: Graph.empty("main") } },
          {
            main: {
              source: {
                dataInputs: [],
                dataOutputs: [],
                executionInputs: [{ id: IoId.make("exec") }],
                executionOutputs: [{ id: IoId.make("exec") }],
              },
            },
          },
        );
        return createEditorCanvas({
          editor,
          client: () => ({}) as EditorRpcClient,
          canEdit: () => true,
          publishPointer: () => {},
          selectedGraphId: () => "main",
          selectedGraph: () => editor.store.project!.graphs.main!,
          nodes: () => [],
          selectedNodeIds: () => [],
          setSelectedNodeIds: () => {},
          canvasScale: () => 2,
          setCanvasScale: () => {},
          canvasOrigin: () => ({ x: 20, y: 30 }),
          setCanvasOrigin: () => {},
        });
      });
      canvas.setGraphCanvas({
        getBoundingClientRect: () => ({ left: 100, top: 80 }),
      } as HTMLDivElement);
      flush();
      const pointer = { pointerId: 1, clientX: 160, clientY: 120 };
      const start = () => {
        canvas.startConnection(
          {
            ...pointer,
            currentTarget: {
              hasPointerCapture: () => false,
              getBoundingClientRect: () => ({ left: 150, top: 110, width: 20, height: 20 }),
            },
          } as unknown as PointerEvent,
          "source",
          "exec",
          "execution",
          direction,
        );
        flush();
        expect(canvas.connectionPreview()?.source.position).toEqual({ x: 50, y: 50 });
      };
      const release = () => {
        window.dispatchEvent(
          Object.assign(new Event("pointerup"), { ...pointer, clientX: 500, clientY: 400 }),
        );
        flush();
        expect(canvas.connectionDrag()).toBeUndefined();
        expect(canvas.nodeMenu()?.source?.direction).toBe(direction);
        expect(canvas.connectionPreview()?.pointer).toEqual({ x: 220, y: 190 });
      };

      start();
      release();
      window.dispatchEvent(Object.assign(new Event("pointermove"), pointer));
      flush();
      expect(canvas.connectionPreview()?.pointer).toEqual({ x: 220, y: 190 });
      canvas.setNodeMenu(undefined);
      flush();
      expect(canvas.connectionPreview()).toBeUndefined();

      start();
      window.dispatchEvent(Object.assign(new Event("pointercancel"), pointer));
      flush();
      expect(canvas.nodeMenu()).toBeUndefined();
      expect(canvas.connectionPreview()).toBeUndefined();

      start();
      release();
      let complete = () => {};
      const pending = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const creation = canvas.createNodeFromMenu(() => pending);
      canvas.setNodeMenu(undefined);
      flush();
      expect(canvas.nodeMenu()).toBeUndefined();
      expect(canvas.connectionPreview()?.pointer).toEqual({ x: 220, y: 190 });
      complete();
      await creation;
      flush();
      expect(canvas.connectionPreview()).toBeUndefined();

      start();
      release();
      await expect(
        canvas.createNodeFromMenu(() => Promise.reject(new Error("failed"))),
      ).rejects.toThrow("failed");
      flush();
      expect(canvas.connectionPreview()).toBeUndefined();

      start();
      release();
      const earlierCreation = canvas.createNodeFromMenu(() => Promise.resolve());
      start();
      release();
      await earlierCreation;
      flush();
      expect(canvas.nodeMenu()).toBeDefined();
      expect(canvas.connectionPreview()).toBeDefined();
    },
  );

  it.each(["mouse", "touch"])("blurs inputs and cleans up %s canvas gestures", (pointerType) => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const canvas = createRoot((cleanup) => {
      dispose = cleanup;
      const editor = createEditorStore();
      return createEditorCanvas({
        editor,
        client: () => null,
        canEdit: () => false,
        publishPointer: () => {},
        selectedGraphId: () => null,
        selectedGraph: () => null,
        nodes: () => [],
        selectedNodeIds: () => [],
        setSelectedNodeIds: () => {},
        canvasScale: () => 1,
        setCanvasScale: () => {},
        canvasOrigin: () => ({ x: 0, y: 0 }),
        setCanvasOrigin: () => {},
      });
    });
    flush();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    const blur = vi.fn();
    input.addEventListener("blur", blur);

    canvas.onCanvasPointerDown(
      Object.assign(new Event("pointerdown"), {
        pointerType,
        button: 0,
        clientX: 10,
        clientY: 20,
        shiftKey: false,
      }) as PointerEvent,
    );
    expect(document.activeElement).not.toBe(input);
    expect(blur).toHaveBeenCalledOnce();
    const listeners = add.mock.calls.filter(([type]) => type.startsWith("pointer"));
    expect(listeners.map(([type]) => type)).toEqual(["pointermove", "pointerup", "pointercancel"]);
    dispose();
    for (const [type, listener] of listeners) expect(remove).toHaveBeenCalledWith(type, listener);
  });
});
