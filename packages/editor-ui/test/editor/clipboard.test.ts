// @vitest-environment happy-dom
import {
  Clipboard,
  Actor,
  ConnectionId,
  Graph,
  IoId,
  Node,
  NodeId,
  PackageId,
  Project,
  SchemaId,
} from "@macrograph/core";
import { onlineManager } from "@tanstack/solid-query";
import { Effect } from "effect";
import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

import type { EditorRpcClient } from "../../src/editor/Editor";

import { createEditorCommands } from "../../src/editor/createEditorCommands";
import { createEditorStore } from "../../src/editor/store";

vi.mock(
  "solid-js",
  () => import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href),
);
let dispose = () => {};
afterEach(() => {
  dispose();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

const ref = { package: PackageId.make("test"), schema: SchemaId.make("normal") };
const nodes: Node.Model[] = ["a", "b", "protected"].map((id, index) => ({
  id: NodeId.make(id),
  name: id,
  schema: { ...ref, schema: SchemaId.make(id === "protected" ? "internal" : "normal") },
  properties: {},
  inputDefaults: {},
  foldPins: true,
  position: { x: index * 83, y: 13 },
}));
const edge = {
  id: ConnectionId.make("edge"),
  outNodeId: "a",
  outIoId: IoId.make("exec"),
  inNodeId: "b",
  inIoId: IoId.make("exec"),
};
const setup = (canEdit = true) =>
  createRoot((cleanup) => {
    dispose = cleanup;
    const editor = createEditorStore();
    editor.setProject(
      {
        ...Project.empty(),
        graphs: {
          source: {
            ...Graph.empty("source"),
            nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
            connections: [edge],
          },
          other: Graph.empty("other"),
        },
      },
      { source: {} },
    );
    editor.setPackages([
      {
        id: ref.package,
        name: "Test",
        resources: [],
        schemas: ["normal", "internal"].map((id) => ({
          id: SchemaId.make(id),
          name: id,
          internal: id === "internal",
          type: "event",
          properties: [],
          dataInputs: [],
          dataOutputs: [],
          executionInputs: [],
          executionOutputs: [],
        })),
      },
    ]);
    const [graphId, setGraphId] = createSignal("source");
    const [selected, setSelected] = createSignal<string[]>(["a", "b", "protected"]);
    const deleteFragment = vi.fn(
      ({ graphId, nodeIds }: { graphId: string; nodeIds: ReadonlyArray<string> }) =>
        Effect.succeed({
          _tag: "FragmentDeleted" as const,
          actor: Actor.system,
          graphId,
          nodeIds,
          deletedConnectionIds: [edge.id],
        }),
    );
    const pasteFragment = vi.fn(
      ({ graphId }: { graphId: string; text: string; position: { x: number; y: number } }) =>
        Effect.succeed({
          _tag: "FragmentPasted" as const,
          actor: Actor.system,
          graphId,
          nodes: [{ ...nodes[0]!, id: NodeId.make("fresh") }],
          connections: [],
          nodeIO: {},
        }),
    );
    const client = {
      DeleteFragment: deleteFragment,
      GetClipboardIdentity: () => Effect.succeed("session"),
      PasteFragment: pasteFragment,
    } as unknown as EditorRpcClient;
    const commands = createEditorCommands(
      editor,
      { client: () => client, canEdit: () => canEdit },
      {
        selectedGraphId: graphId,
        selectedGraph: () => editor.store.project?.graphs[graphId()] ?? null,
        selectedNodeId: () => null,
        setSelectedGraphId: (id) => {
          if (id) setGraphId(id);
        },
        setSelectedNodeIds: setSelected,
      },
    );
    const clipboard = {
      writeText: vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined),
      readText: vi.fn<() => Promise<string>>().mockResolvedValue(
        JSON.stringify({
          format: "macrograph/nodes",
          version: 1,
          nodes: nodes.slice(0, 2),
          connections: [edge],
        }),
      ),
    };
    vi.stubGlobal("navigator", { clipboard });
    return {
      editor,
      commands,
      clipboard,
      deleteFragment,
      pasteFragment,
      selected,
      setSelected,
      setGraphId,
    };
  });

it("copies ordinary event nodes and internal edges, skipping only internal schemas", async () => {
  const state = setup(false);
  await state.commands.copyNodes(["a", "b", "protected"]);
  expect(JSON.parse(state.clipboard.writeText.mock.calls[0]![0])).toMatchObject({
    format: "macrograph/nodes",
    version: 1,
    nodes: [{ id: "a" }, { id: "b" }],
    connections: [edge],
  });
  await state.commands.copyNodes(["a"], true);
  await state.commands.pasteNodes({ x: 13, y: 27 });
  expect(state.clipboard.writeText).toHaveBeenCalledTimes(1);
  expect(state.deleteFragment).not.toHaveBeenCalled();
  expect(state.pasteFragment).not.toHaveBeenCalled();
});

it("does not delete or change selection if clipboard write fails", async () => {
  const state = setup();
  state.clipboard.writeText.mockRejectedValue(new Error("Permission denied"));
  await state.commands.copyNodes(["a", "b"], true);
  expect(state.deleteFragment).not.toHaveBeenCalled();
  expect(state.selected()).toEqual(["a", "b", "protected"]);
  expect(state.commands.clipboardError()).toContain("Permission denied");
  expect(state.commands.clipboardMutation.isError).toBe(true);
  expect(state.commands.clipboardMutation.isPending).toBe(false);
  expect(state.clipboard.writeText).toHaveBeenCalledTimes(1);
  state.commands.dismissClipboardError();
  expect(state.commands.clipboardMutation.isIdle).toBe(true);
  expect(state.commands.clipboardError()).toBeUndefined();
  state.clipboard.writeText.mockResolvedValue(undefined);
  await state.commands.copyNodes(["a", "b"], true);
  expect(state.commands.clipboardMutation.isSuccess).toBe(true);
  expect(state.deleteFragment).toHaveBeenCalledTimes(1);
});

it.each(["copy", "cut", "paste"] as const)(
  "tracks pending %s and blocks overlapping clipboard actions immediately",
  async (operation) => {
    const state = setup();
    let resolve = () => {};
    const permission = new Promise<void>((done) => {
      resolve = done;
    });
    if (operation === "paste") {
      const text = await state.clipboard.readText();
      state.clipboard.readText.mockClear();
      state.clipboard.readText.mockImplementation(async () => {
        await permission;
        return text;
      });
    } else {
      state.clipboard.writeText.mockReturnValue(permission);
    }
    const pending =
      operation === "paste"
        ? state.commands.pasteNodes({ x: 0, y: 0 })
        : state.commands.copyNodes(["a", "b"], operation === "cut");
    expect(state.commands.clipboardMutation.isPending).toBe(true);
    state.commands.dismissClipboardError();
    expect(state.commands.clipboardMutation.isPending).toBe(true);
    await state.commands.copyNodes(["a"], true);
    await state.commands.pasteNodes({ x: 0, y: 0 });
    expect(state.deleteFragment).not.toHaveBeenCalled();
    expect(state.pasteFragment).not.toHaveBeenCalled();
    resolve();
    await pending;
    expect(state.clipboard.readText).toHaveBeenCalledTimes(operation === "paste" ? 1 : 0);
    expect(state.clipboard.writeText).toHaveBeenCalledTimes(operation === "paste" ? 0 : 1);
    expect(state.commands.clipboardMutation.isPending).toBe(false);
    expect(state.commands.clipboardMutation.isSuccess).toBe(true);
    await state.commands.pasteNodes({ x: 0, y: 0 });
    expect(state.pasteFragment).toHaveBeenCalledTimes(operation === "paste" ? 2 : 1);
  },
);

it("runs clipboard and local editor mutations offline", async () => {
  const state = setup();
  onlineManager.setOnline(false);
  const cut = state.commands.copyNodes(["a"], true);
  expect(state.commands.clipboardMutation.isPaused).toBe(false);
  await cut;
  await state.commands.pasteNodes({ x: 0, y: 0 });
  expect(state.deleteFragment).toHaveBeenCalledTimes(1);
  expect(state.pasteFragment).toHaveBeenCalledTimes(1);
  expect(state.commands.clipboardMutation.isSuccess).toBe(true);
});

it("cuts the captured source selection after graph focus changes", async () => {
  const state = setup();
  let resolve = () => {};
  state.clipboard.writeText.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const cut = state.commands.copyNodes(["a", "b", "protected"], true);
  await vi.waitFor(() => expect(state.clipboard.writeText).toHaveBeenCalled());
  state.setGraphId("other");
  state.setSelected(["other-selected"]);
  flush();
  resolve();
  await cut;
  expect(state.deleteFragment).toHaveBeenCalledWith({ graphId: "source", nodeIds: ["a", "b"] });
  expect(state.selected()).toEqual(["other-selected"]);
  expect(Object.keys(state.editor.store.project!.graphs.source!.nodes)).toEqual(["protected"]);
});

it("captures paste destination, snaps one anchor and does not select nodes in another graph", async () => {
  const state = setup();
  let resolve = (_text: string) => {};
  state.clipboard.readText.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const paste = state.commands.pasteNodes({ x: 13, y: 27 });
  state.setGraphId("other");
  state.setSelected(["other-selected"]);
  flush();
  await vi.waitFor(() => expect(state.clipboard.readText).toHaveBeenCalled());
  resolve(
    JSON.stringify({
      format: "macrograph/nodes",
      version: 1,
      nodes: nodes.slice(0, 2),
      connections: [edge],
    }),
  );
  await paste;
  expect(state.pasteFragment.mock.calls[0]![0]).toMatchObject({
    graphId: "source",
    position: { x: 0, y: 40 },
  });
  expect(state.selected()).toEqual(["other-selected"]);
});

it("selects pasted nodes and rejects malformed clipboard without calling the server", async () => {
  const state = setup();
  await state.commands.pasteNodes({ x: 0, y: 0 });
  expect(state.selected()).toEqual(["fresh"]);
  state.clipboard.readText.mockResolvedValue("not a fragment");
  await state.commands.pasteNodes({ x: 0, y: 0 });
  expect(state.pasteFragment).toHaveBeenCalledTimes(1);
  expect(state.selected()).toEqual(["fresh"]);
  expect(state.commands.clipboardError()).toContain("Paste failed");
  const retry = state.commands.copyNodes(["a"]);
  expect(state.commands.clipboardError()).toBeUndefined();
  expect(state.commands.clipboardMutation.isPending).toBe(true);
  await retry;
  expect(state.commands.clipboardMutation.isSuccess).toBe(true);
});

it("rebind cancellation never inserts nodes and confirmation sends explicit mappings", async () => {
  const state = setup();
  const request: Clipboard.RebindRequest = {
    nodeId: "a",
    property: "account",
    label: "Account",
    kind: "resource",
    candidates: [{ id: "destination-account", name: "Destination" }],
  };
  const requireRebind = () => Effect.fail(new Clipboard.RebindRequired({ requests: [request] }));
  state.pasteFragment.mockImplementationOnce(
    requireRebind as unknown as typeof state.pasteFragment,
  );
  const cancel = state.commands.pasteNodes({ x: 0, y: 0 });
  await vi.waitFor(() => expect(state.commands.clipboardRebind()).toEqual([request]));
  expect(state.commands.clipboardMutation.isPending).toBe(true);
  await state.commands.copyNodes(["a"], true);
  await state.commands.pasteNodes({ x: 0, y: 0 });
  expect(state.clipboard.writeText).not.toHaveBeenCalled();
  expect(state.clipboard.readText).toHaveBeenCalledTimes(1);
  expect(state.editor.store.project!.graphs.source!.nodes.fresh).toBeUndefined();
  state.commands.finishClipboardRebind();
  await cancel;
  expect(state.commands.clipboardMutation.isPending).toBe(false);
  expect(state.commands.clipboardError()).toBeUndefined();
  expect(state.pasteFragment).toHaveBeenCalledTimes(1);
  state.pasteFragment.mockImplementationOnce(
    requireRebind as unknown as typeof state.pasteFragment,
  );
  const confirm = state.commands.pasteNodes({ x: 0, y: 0 });
  await vi.waitFor(() => expect(state.commands.clipboardRebind()).toEqual([request]));
  expect(state.commands.clipboardMutation.isPending).toBe(true);
  state.commands.finishClipboardRebind([
    { nodeId: "a", property: "account", target: "destination-account" },
  ]);
  await confirm;
  expect(state.commands.clipboardMutation.isSuccess).toBe(true);
  expect(state.pasteFragment.mock.calls[2]![0]).toMatchObject({
    bindings: [{ nodeId: "a", property: "account", target: "destination-account" }],
  });
  expect(state.selected()).toEqual(["fresh"]);
});

it("cancels or force-inserts fragments with missing schemas", async () => {
  const schemas: Clipboard.MissingSchema[] = [{ package: "missing", schema: "node" }];
  const requireConfirmation = () => Effect.fail(new Clipboard.MissingSchemas({ schemas }));

  const cancelled = setup();
  cancelled.pasteFragment.mockImplementationOnce(
    requireConfirmation as unknown as typeof cancelled.pasteFragment,
  );
  const cancel = cancelled.commands.pasteNodes({ x: 0, y: 0 });
  await vi.waitFor(() => expect(cancelled.commands.clipboardMissingSchemas()).toEqual(schemas));
  cancelled.commands.finishClipboardMissingSchemas(false);
  await cancel;
  expect(cancelled.pasteFragment).toHaveBeenCalledTimes(1);

  const confirmed = setup();
  confirmed.pasteFragment.mockImplementationOnce(
    requireConfirmation as unknown as typeof confirmed.pasteFragment,
  );
  const confirm = confirmed.commands.pasteNodes({ x: 0, y: 0 });
  await vi.waitFor(() => expect(confirmed.commands.clipboardMissingSchemas()).toEqual(schemas));
  confirmed.commands.finishClipboardMissingSchemas(true);
  await confirm;
  expect(confirmed.pasteFragment).toHaveBeenCalledTimes(2);
  expect(confirmed.pasteFragment.mock.calls[1]![0]).toMatchObject({
    bindings: [],
    forceMissingSchemas: true,
  });
  expect(confirmed.selected()).toEqual(["fresh"]);
});
