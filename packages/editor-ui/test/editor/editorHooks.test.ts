// @vitest-environment happy-dom

import { Actor, Graph, IoId, Node, PackageId, Project, SchemaId } from "@macrograph/core";
import { Effect } from "effect";
import { createMemo, createRoot, createSignal, flush, untrack } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorRpcClient } from "../../src/editor/Editor";

import { createEditorController } from "../../src/editor/createEditorController";
import { createEditorCanvas } from "../../src/editor/graph/createEditorCanvas";
import { createEditorStore } from "../../src/editor/store";
import { createEditorWorkspace } from "../../src/editor/workspace/createEditorWorkspace";
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
      const pointer = { pointerId: 1, clientX: 10, clientY: 20, shiftKey: true };
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
      else if (end === "pointercancel") expect(publishPointer).toHaveBeenLastCalledWith(null, true);
      const calls = publishPointer.mock.calls.length;
      window.dispatchEvent(Object.assign(new Event("pointermove"), pointer));
      expect(publishPointer).toHaveBeenCalledTimes(calls);
      for (const node of nodes) expect(canvas.isNodeDragging(node.id)).toBe(false);
      if (end !== "dispose") expect(untrack(dragging)).toEqual([false, false, false]);
    },
  );

  it.each([0.5, 1, 2])(
    "snaps the grabbed node at scale %s while preserving group offsets and live Shift",
    async (scale) => {
      const { canvas, editor, rpc } = createRoot((cleanup) => {
        dispose = cleanup;
        const editor = createEditorStore();
        const nodes = [
          { id: "first", position: { x: 13, y: -27 } },
          { id: "second", position: { x: 76, y: 18 } },
        ].map(
          ({ id, position }): Node.Model => ({
            id: Node.NodeId.make(id),
            name: id,
            schema: { package: PackageId.make("test"), schema: SchemaId.make("test") },
            properties: {},
            inputDefaults: {},
            foldPins: false,
            position,
          }),
        );
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
        const rpc = vi.fn((payload: Parameters<EditorRpcClient["SetNodePosition"]>[0]) =>
          Effect.succeed({ _tag: "NodePositionChanged" as const, actor: Actor.system, ...payload }),
        );
        const canvas = createEditorCanvas({
          editor,
          client: () => ({ SetNodePosition: rpc }) as unknown as EditorRpcClient,
          canEdit: () => true,
          publishPointer: () => {},
          selectedGraphId: () => "main",
          selectedGraph: () => editor.store.project!.graphs.main!,
          nodes: () => nodes,
          selectedNodeIds: () => ["first", "second"],
          setSelectedNodeIds: () => {},
          canvasScale: () => scale,
          setCanvasScale: () => {},
          canvasOrigin: () => ({ x: 123, y: -456 }),
          setCanvasOrigin: () => {},
        });
        return { canvas, editor, rpc };
      });
      flush();
      const pointer = { pointerId: 1, clientX: 100, clientY: 100, shiftKey: true };
      const start = () => {
        canvas.onNodeMouseDown(
          Object.assign(new Event("pointerdown"), pointer) as PointerEvent,
          editor.store.project!.graphs.main!.nodes.second!,
        );
        flush();
      };
      const positions = () =>
        ["first", "second"].map((id) => editor.store.project!.graphs.main!.nodes[id]!.position);
      start();
      window.dispatchEvent(Object.assign(new Event("pointermove"), pointer));
      window.dispatchEvent(Object.assign(new Event("pointerup"), pointer));
      flush();
      expect(positions()).toEqual([
        { x: 13, y: -27 },
        { x: 76, y: 18 },
      ]);
      expect(rpc).not.toHaveBeenCalled();

      start();
      const moved = { ...pointer, clientX: 100 + 31 * scale, clientY: 100 - 35 * scale };
      window.dispatchEvent(Object.assign(new Event("pointermove"), { ...moved, shiftKey: false }));
      flush();
      expect(positions()).toEqual([
        { x: 57, y: -45 },
        { x: 120, y: 0 },
      ]);
      window.dispatchEvent(Object.assign(new Event("pointermove"), moved));
      flush();
      expect(positions()).toEqual([
        { x: 44, y: -62 },
        { x: 107, y: -17 },
      ]);
      // Release Shift without another move: the final placement must still snap.
      window.dispatchEvent(Object.assign(new Event("pointerup"), { ...moved, shiftKey: false }));
      await vi.waitFor(() =>
        expect(rpc.mock.calls.filter(([payload]) => !payload.ephemeral)).toHaveLength(2),
      );
      flush();
      expect(positions()).toEqual([
        { x: 57, y: -45 },
        { x: 120, y: 0 },
      ]);

      rpc.mockClear();
      start();
      window.dispatchEvent(Object.assign(new Event("pointermove"), { ...moved, shiftKey: false }));
      window.dispatchEvent(Object.assign(new Event("pointerup"), moved));
      await vi.waitFor(() =>
        expect(rpc.mock.calls.filter(([payload]) => !payload.ephemeral)).toHaveLength(2),
      );
      flush();
      expect(positions()).toEqual([
        { x: 88, y: -80 },
        { x: 151, y: -35 },
      ]);
      expect(rpc).toHaveBeenCalledWith({ graphId: "main", nodeId: "second", x: 151, y: -35 });
    },
  );

  it.each([false, true])(
    "retains placement gesture Shift=%s through the node menu",
    async (shiftKey) => {
      const canvas = createRoot((cleanup) => {
        dispose = cleanup;
        return createEditorCanvas({
          editor: createEditorStore(),
          client: () => null,
          canEdit: () => true,
          publishPointer: () => {},
          selectedGraphId: () => "main",
          selectedGraph: () => null,
          nodes: () => [],
          selectedNodeIds: () => [],
          setSelectedNodeIds: () => {},
          canvasScale: () => 2,
          setCanvasScale: () => {},
          canvasOrigin: () => ({ x: 20, y: -30 }),
          setCanvasOrigin: () => {},
        });
      });
      canvas.setGraphCanvas({
        getBoundingClientRect: () => ({ left: 100, top: 80 }),
      } as HTMLDivElement);
      flush();
      const pointer = { pointerId: 1, pointerType: "mouse", button: 2, clientX: 170, clientY: 130 };
      canvas.onCanvasPointerDown(
        Object.assign(new Event("pointerdown"), {
          ...pointer,
          shiftKey: !shiftKey,
        }) as PointerEvent,
      );
      window.dispatchEvent(Object.assign(new Event("pointerup"), { ...pointer, shiftKey }));
      flush();
      await canvas.createNodeFromMenu((menu) => {
        expect(menu.graph).toEqual({ x: 55, y: -5 });
        expect(menu.shiftKey).toBe(shiftKey);
        return Promise.resolve();
      });
    },
  );

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
      const release = (shiftKey = false) => {
        window.dispatchEvent(
          Object.assign(new Event("pointerup"), {
            ...pointer,
            clientX: 500,
            clientY: 400,
            shiftKey,
          }),
        );
        flush();
        expect(canvas.connectionDrag()).toBeUndefined();
        expect(canvas.nodeMenu()?.source?.direction).toBe(direction);
        expect(canvas.nodeMenu()?.shiftKey).toBe(shiftKey);
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
      release(true);
      let complete = () => {};
      const pending = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const creation = canvas.createNodeFromMenu((menu) => {
        expect(menu.shiftKey).toBe(true);
        return pending;
      });
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
