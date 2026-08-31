// @vitest-environment jsdom
import { render } from "@solidjs/web";
import { Effect } from "effect";
import { flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  ConnectionId,
  Graph,
  IoId,
  Node,
  PackageId,
  Project,
  SchemaId,
  type NodeIO,
} from "../../../../packages/core/src/index";
import {
  createEditorController,
  type EditorController,
} from "../../../../packages/editor-ui/src/editor/createEditorController";
import { Editor } from "../../../../packages/editor-ui/src/editor/Editor";
import {
  createWorkspaceState,
  type PaneDirection,
  type TabInput,
} from "../../../../packages/editor-ui/src/editor/workspace/workspace";

const firstNode: Node.Model = {
  id: Node.NodeId.make("first"),
  name: "First node",
  schema: { package: PackageId.make("twitch"), schema: SchemaId.make("test") },
  properties: {},
  inputDefaults: {},
  foldPins: false,
  position: { x: 80, y: 120 },
};
const secondNode = {
  ...firstNode,
  id: Node.NodeId.make("second"),
  name: "Second node",
  position: { x: 400, y: 120 },
};
const io: NodeIO = {
  dataInputs: [],
  dataOutputs: [{ id: IoId.make("username"), name: "Username", type: { _tag: "String" } }],
  executionInputs: [{ id: IoId.make("in") }],
  executionOutputs: [{ id: IoId.make("out") }],
};
const graph: Graph.Model = {
  ...Graph.empty("main"),
  nodes: { [firstNode.id]: firstNode, [secondNode.id]: secondNode },
  connections: [
    {
      id: ConnectionId.make("edge"),
      outNodeId: firstNode.id,
      outIoId: IoId.make("out"),
      inNodeId: secondNode.id,
      inIoId: IoId.make("in"),
    },
  ],
};
const secondaryGraph = Graph.empty("other");
const nodeIds = (pane: Element) =>
  new Set(
    [...pane.querySelectorAll("[data-node-id]")].map((pin) => pin.getAttribute("data-node-id")),
  );

let dispose = () => {};
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: false }));
});
afterEach(() => {
  dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const setup = (direction: PaneDirection) => {
  let controller!: EditorController;
  let graphPaneId!: string;
  let otherPaneId!: string;
  dispose = render(() => {
    controller = createEditorController({
      connection: Effect.never,
      workspaceId: "pane-test",
      userId: "user",
      settingsDescriptors: [],
      projectSettings: true,
    });
    // Render the retained project without requiring an RPC transport.
    return (
      <Editor
        controller={{
          ...controller,
          connection: {
            ...controller.connection,
            reconnecting: () => true,
            editorReady: () => true,
          },
        }}
        renderProjectSettings={() => <div>Project settings content</div>}
      />
    );
  }, document.body);
  controller.editor.setProject(
    {
      ...Project.empty(),
      graphs: {
        [graph.id]: graph,
        [secondaryGraph.id]: {
          ...secondaryGraph,
          nodes: { [firstNode.id]: { ...firstNode, name: "Other graph node" } },
        },
      },
    },
    {
      [graph.id]: { [firstNode.id]: io, [secondNode.id]: io },
      [secondaryGraph.id]: {
        [firstNode.id]: {
          ...io,
          dataOutputs: [],
          executionOutputs: [],
        },
      },
    },
  );
  controller.editor.setPackages([
    { id: PackageId.make("twitch"), name: "Twitch", schemas: [], resources: [] },
  ]);
  const workspace = createWorkspaceState({ type: "graph", graphId: graph.id });
  graphPaneId = workspace.focusedPaneId;
  controller.layout.setWorkspace(workspace);
  flush();
  controller.layout.activateWorkspacePane(graphPaneId);
  flush();
  controller.layout.setCanvasOrigin({ x: 120, y: 80 });
  controller.layout.setCanvasScale(0.75);
  controller.layout.setSelectedNodeIds([firstNode.id]);
  flush();
  controller.layout.dispatchWorkspace({ type: "split-pane", paneId: graphPaneId, direction });
  flush();
  otherPaneId = controller.layout.workspace().focusedPaneId;
  controller.layout.activateWorkspacePane(otherPaneId);
  flush();
  const pane = (id: string) => {
    const element = document.querySelector(`[aria-label="Workspace pane ${id}"]`);
    expect(element).not.toBeNull();
    return element!;
  };
  return { controller, graphPaneId, otherPaneId, pane };
};

it.each([
  ["horizontal", { type: "settings" }],
  ["vertical", { type: "settings" }],
  ["horizontal", { type: "package", packageId: "twitch" }],
  ["vertical", { type: "package", packageId: "twitch" }],
] satisfies [PaneDirection, TabInput][])(
  "keeps the graph visible when %s split settings are focused: %o",
  (direction, tab) => {
    const { controller, graphPaneId, otherPaneId, pane } = setup(direction);
    controller.layout.dispatchWorkspace({ type: "open-tab", paneId: otherPaneId, tab });
    flush();
    controller.layout.activateWorkspacePane(otherPaneId);
    flush();
    expect(controller.layout.selectedGraphId()).toBeNull();
    expect(nodeIds(pane(graphPaneId))).toEqual(new Set([firstNode.id, secondNode.id]));
    expect(
      pane(graphPaneId).querySelectorAll('path[stroke-width="2"][opacity="0.75"]'),
    ).toHaveLength(1);
    expect(pane(graphPaneId).textContent).toContain("Username");
    expect(pane(graphPaneId).textContent).not.toContain("Select a graph");
    expect(pane(graphPaneId).querySelector('[style*="scale(0.75)"]')).not.toBeNull();
    expect(pane(graphPaneId).querySelector('[style*="translate(-120px, -80px)"]')).not.toBeNull();

    controller.editor.updateNodePosition(graph.id, firstNode.id, 250, 160);
    flush();
    expect(
      pane(graphPaneId)
        .querySelector(`[data-node-id="${firstNode.id}"]`)
        ?.closest('[style*="translate("]')
        ?.getAttribute("style"),
    ).toContain("250px");

    controller.layout.activateWorkspacePane(graphPaneId);
    flush();
    expect(controller.layout.selectedGraphId()).toBe(graph.id);
    expect(controller.layout.canvasOrigin()).toEqual({ x: 120, y: 80 });
    expect(controller.layout.canvasScale()).toBe(0.75);
    expect(controller.layout.selectedNodeIds()).toEqual([firstNode.id]);
  },
);

it("renders each pane's graph and IO instead of duplicating the focused graph", () => {
  const { controller, graphPaneId, otherPaneId, pane } = setup("horizontal");
  controller.layout.dispatchWorkspace({
    type: "open-tab",
    paneId: otherPaneId,
    tab: { type: "graph", graphId: secondaryGraph.id },
  });
  flush();
  controller.layout.activateWorkspacePane(otherPaneId);
  flush();
  expect(nodeIds(pane(graphPaneId))).toEqual(new Set([firstNode.id, secondNode.id]));
  expect(pane(graphPaneId).textContent).toContain("Username");
  expect(pane(graphPaneId).textContent).not.toContain("Other graph node");
  expect(nodeIds(pane(otherPaneId))).toEqual(new Set([firstNode.id]));
  expect(pane(otherPaneId).textContent).toContain("Other graph node");
  expect(pane(otherPaneId).textContent).not.toContain("Username");
  controller.layout.activateWorkspacePane(graphPaneId);
  flush();
  expect(nodeIds(pane(otherPaneId))).toEqual(new Set([firstNode.id]));
  expect(pane(otherPaneId).textContent).toContain("Other graph node");
});
