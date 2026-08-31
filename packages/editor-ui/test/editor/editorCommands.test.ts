import type { EditorEvent } from "@macrograph/editor";

import {
  Actor,
  ConnectionId,
  Graph,
  IoId,
  Node,
  PackageId,
  Project,
  SchemaId,
  type NodeIO,
} from "@macrograph/core";
import { Effect } from "effect";
import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorRpcClient } from "../../src/editor/Editor";

import { createEditorCommands } from "../../src/editor/createEditorCommands";
import { graphNodeWidth, graphPortOffset } from "../../src/editor/graph/graphPresentation";
import { createEditorStore } from "../../src/editor/store";

vi.mock(
  "solid-js",
  () => import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href),
);

let dispose = () => {};
let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
});
afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});
const paint = () => {
  const callbacks = frames;
  frames = [];
  callbacks.forEach((callback) => callback(0));
  flush();
};

const schema = { package: PackageId.make("test"), schema: SchemaId.make("test") };
const position = { x: 420, y: 190 };
type RpcMethod<Key extends keyof EditorRpcClient> = (
  ...args: Parameters<EditorRpcClient[Key]>
) => ReturnType<EditorRpcClient[Key]>;
const io: NodeIO = {
  executionInputs: [{ id: IoId.make("exec") }],
  executionOutputs: [{ id: IoId.make("exec") }],
  dataInputs: [
    { id: IoId.make("other"), type: { _tag: "Bool" } },
    { id: IoId.make("value"), type: { _tag: "String" } },
  ],
  dataOutputs: [
    { id: IoId.make("other"), type: { _tag: "Bool" } },
    { id: IoId.make("value"), type: { _tag: "String" } },
  ],
};

const setup = () =>
  createRoot((cleanup) => {
    dispose = cleanup;
    const editor = createEditorStore();
    const [selectedGraphId, setSelectedGraphId] = createSignal<string | null>("main");
    editor.setProject({ ...Project.empty(), graphs: { main: Graph.empty("main") } }, {});
    const rpc = {
      CreateNode: vi.fn<RpcMethod<"CreateNode">>((payload) =>
        Effect.succeed({
          _tag: "NodeCreated",
          actor: Actor.system,
          graphId: payload.graphId,
          node: {
            id: Node.NodeId.make("created"),
            name: payload.node.name!,
            schema: payload.node.schema,
            position: payload.node.position!,
            properties: {},
            inputDefaults: {},
            foldPins: false,
          },
          io,
        }),
      ),
      SetNodePosition: vi.fn<RpcMethod<"SetNodePosition">>((payload) =>
        Effect.succeed({
          _tag: "NodePositionChanged",
          actor: Actor.system,
          ...payload,
        }),
      ),
      CreateConnection: vi.fn<RpcMethod<"CreateConnection">>((payload) =>
        Effect.succeed({
          _tag: "ConnectionCreated",
          actor: Actor.system,
          graphId: payload.graphId,
          connection: { ...payload.connection, id: ConnectionId.make("connection") },
        }),
      ),
      DeleteNode: vi.fn<RpcMethod<"DeleteNode">>((payload) =>
        Effect.succeed({
          _tag: "NodeDeleted",
          actor: Actor.system,
          ...payload,
          deletedConnectionIds: [],
        }),
      ),
    };
    const commands = createEditorCommands(
      editor,
      {
        client: () => rpc as unknown as EditorRpcClient,
        canEdit: () => true,
      },
      {
        selectedGraphId,
        selectedGraph: () => editor.store.project!.graphs.main!,
        selectedNodeId: () => null,
        setSelectedGraphId,
        setSelectedNodeIds: () => {},
      },
    );
    return { editor, rpc, commands };
  });

describe("node creation placement", () => {
  it.each([
    ["input", "execution", false],
    ["output", "execution", false],
    ["input", "data", false],
    ["output", "data", false],
    ["input", "execution", true],
    ["output", "execution", true],
    ["input", "data", true],
    ["output", "data", true],
  ] as const)(
    "places from an %s %s pin with Shift=%s after applying the pin offset",
    async (direction, kind, shiftKey) => {
      const { editor, rpc, commands } = setup();
      let finishPosition = (_event: EditorEvent.NodePositionChanged) => {};
      rpc.SetNodePosition.mockImplementationOnce(() =>
        Effect.promise(
          () =>
            new Promise<EditorEvent.NodePositionChanged>((resolve) => {
              finishPosition = resolve;
            }),
        ),
      );
      const creation = commands.createNode(
        schema,
        "A node with a long title",
        position,
        {
          nodeId: "source",
          direction,
          port:
            kind === "execution"
              ? { kind, id: "exec" }
              : { kind, id: "value", type: { _tag: "String" } },
        },
        shiftKey,
      );
      await vi.waitFor(() => expect(rpc.SetNodePosition).toHaveBeenCalledOnce());
      flush();
      expect(commands.isNodePositioning("created")).toBe(true);
      expect(commands.isNodePositioning("source")).toBe(false);
      const graph = editor.store.project!.graphs.main!;
      const offset = graphPortOffset(
        graphNodeWidth(io, "A node with a long title"),
        direction === "output" ? "input" : "output",
        kind === "execution" ? 0 : 2,
      );
      const aligned = { x: position.x - offset.x, y: position.y - offset.y };
      expect(graph.nodes.created!.position).toEqual(
        shiftKey
          ? aligned
          : {
              x: Math.round(aligned.x / 40) * 40,
              y: Math.round(aligned.y / 40) * 40,
            },
      );
      const payload = rpc.SetNodePosition.mock.calls[0]![0];
      expect(payload).toEqual({
        graphId: "main",
        nodeId: "created",
        ...graph.nodes.created!.position,
      });
      expect(rpc.CreateConnection).not.toHaveBeenCalled();
      finishPosition({ _tag: "NodePositionChanged", actor: Actor.system, ...payload });
      await creation;
      flush();
      expect(rpc.CreateConnection).toHaveBeenCalledOnce();
      expect(editor.store.project!.graphs.main!.nodes.created!.position).toEqual(
        graph.nodes.created!.position,
      );
      expect(commands.isNodePositioning("created")).toBe(true);
      paint();
      expect(commands.isNodePositioning("created")).toBe(true);
      paint();
      expect(commands.isNodePositioning("created")).toBe(false);
    },
  );

  it.each([false, true])("places ordinary menu creation with Shift=%s", async (shiftKey) => {
    const { editor, rpc, commands } = setup();
    await commands.createNode(schema, "Node", position, undefined, shiftKey);
    flush();
    expect(editor.store.project!.graphs.main!.nodes.created!.position).toEqual(
      shiftKey ? position : { x: 440, y: 200 },
    );
    expect(rpc.CreateNode).toHaveBeenCalledWith({
      graphId: "main",
      node: { name: "Node", schema, position: shiftKey ? position : { x: 440, y: 200 } },
    });
    expect(rpc.SetNodePosition).not.toHaveBeenCalled();
    expect(rpc.CreateConnection).not.toHaveBeenCalled();
    expect(commands.isNodePositioning("created")).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it("keeps smoothing disabled through a paint when creation completes immediately", async () => {
    const { commands } = setup();
    await commands.createNode(schema, "Node", position, {
      nodeId: "source",
      direction: "output",
      port: { kind: "execution", id: "exec" },
    });
    flush();
    expect(commands.isNodePositioning("created")).toBe(true);
    paint();
    expect(commands.isNodePositioning("created")).toBe(true);
    paint();
    expect(commands.isNodePositioning("created")).toBe(false);
  });

  it("removes the new node if positioning fails instead of connecting at the wrong position", async () => {
    const { editor, rpc, commands } = setup();
    rpc.SetNodePosition.mockReturnValueOnce(Effect.fail(new Node.NotFoundError({ id: "created" })));
    await commands.createNode(schema, "Node", position, {
      nodeId: "source",
      direction: "output",
      port: { kind: "execution", id: "exec" },
    });
    flush();
    expect(rpc.DeleteNode).toHaveBeenCalledWith({ graphId: "main", nodeId: "created" });
    expect(rpc.CreateConnection).not.toHaveBeenCalled();
    expect(editor.store.project!.graphs.main!.nodes.created).toBeUndefined();
    paint();
    paint();
    expect(commands.isNodePositioning("created")).toBe(false);
  });
});
