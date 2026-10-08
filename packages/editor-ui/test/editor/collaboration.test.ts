// @vitest-environment happy-dom

import type { EditorEvent } from "@macrograph/editor";

import {
  Actor,
  Canvas,
  ConnectionId,
  IoId,
  NodeId,
  PackageId,
  Project,
  SchemaId,
} from "@macrograph/core";
import { Presence } from "@macrograph/editor";
import { createRoot, createSignal, flush, untrack } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activityHighlightMs,
  createEditorActivity,
  neutralActivityColor,
} from "../../src/editor/session/createEditorActivity";
import {
  createEditorFollow,
  followTarget,
  viewForTarget,
} from "../../src/editor/session/createEditorFollow";
import { createEditorStore } from "../../src/editor/store";
import { defaultGraphView } from "../../src/editor/workspace/workspace";
import { followCandidate, groupPresence } from "../../src/presence/presenceGroups";

vi.mock(
  "solid-js",
  () => import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href),
);

let dispose = () => {};
afterEach(() => {
  dispose();
  vi.useRealTimers();
});

const client = (overrides: Partial<Presence.Client> & { id: string }): Presence.Client => ({
  kind: "browser",
  userId: null,
  displayName: overrides.id,
  email: null,
  color: "#ffffff",
  canEdit: true,
  activeGraph: null,
  cursor: null,
  viewport: null,
  selectedNodeIds: [],
  remote: null,
  lastActiveAt: 0,
  expiresAt: null,
  ...overrides,
});

const node = (id: string, x: number, y: number) => ({
  id: NodeId.make(id),
  name: id,
  schema: { package: PackageId.make("test"), schema: SchemaId.make("test") },
  position: { x, y },
  properties: {},
  inputDefaults: {},
  foldPins: false,
});

const storeWithGraphs = () => {
  const editor = createEditorStore();
  editor.setProject(
    {
      ...Project.empty(),
      graphs: {
        a: { ...Canvas.empty("a"), nodes: { n: node("n", 100, 200) } },
        b: Canvas.empty("b"),
      },
    },
    {},
  );
  return editor;
};

describe("presence groups", () => {
  it("groups a user's tabs and agents, leaving out your own tabs", () => {
    const groups = groupPresence(
      [
        client({ id: "zed-tab", userId: "zed", displayName: "zed", lastActiveAt: 1 }),
        client({ id: "mcp:ada", kind: "mcp", userId: "ada", displayName: "", lastActiveAt: 9 }),
        client({ id: "ada-tab", userId: "ada", displayName: "ada", email: "ada@example.com" }),
        client({ id: "self", userId: "me", displayName: "me" }),
        client({ id: "self-other-tab", userId: "me", displayName: "me" }),
        client({ id: "anonymous", displayName: "Calm Fox", canEdit: false }),
      ],
      "self",
    );
    expect(groups.map((group) => group.displayName)).toEqual(["ada", "Calm Fox", "zed"]);
    const ada = groups[0]!;
    expect(ada.clients.map((entry) => entry.id)).toEqual(["ada-tab", "mcp:ada"]);
    expect(ada.email).toBe("ada@example.com");
    expect(groups[1]!.canEdit).toBe(false);
    // Choosing a person follows whichever of their clients acted most recently.
    expect(followCandidate(ada)?.id).toBe("mcp:ada");
  });

  it("keeps your own agents so they can be followed", () => {
    const groups = groupPresence(
      [
        client({ id: "self", userId: "me", displayName: "me" }),
        client({ id: "mcp:me", kind: "mcp", userId: "me", displayName: "me" }),
      ],
      "self",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.isSelf).toBe(true);
    expect(groups[0]!.clients.map((entry) => entry.id)).toEqual(["mcp:me"]);
  });
});

describe("remote activity", () => {
  it("highlights other actors' edits in their colour and remembers where they edited", () => {
    vi.useFakeTimers();
    const editor = storeWithGraphs();
    const [clients] = createSignal([
      client({ id: "self" }),
      client({ id: "bob-tab", userId: "bob", color: "#ec4899" }),
    ]);
    const activity = createRoot((cleanup) => {
      dispose = cleanup;
      return createEditorActivity({ editor, presenceClients: clients, selfId: () => "self" });
    });
    const moved = (actor: Actor.Model, nodeId = "n"): EditorEvent.EditorEvent => ({
      _tag: "NodePositionChanged",
      actor,
      graphId: "a",
      nodeId,
      x: 5,
      y: 6,
    });

    activity.record(moved(Actor.client("browser", "bob-tab", "bob")));

    flush();
    expect(untrack(() => activity.nodeHighlight("a", "n"))?.color).toBe("#ec4899");
    expect(untrack(() => activity.lastEdit("bob-tab"))).toMatchObject({
      graphId: "a",
      position: { x: 5, y: 6 },
    });

    // An agent that is not in presence uses its user's colour, or a neutral one without a user.
    activity.record(moved(Actor.client("api", "api:key", "carol"), "m"));
    flush();
    expect(untrack(() => activity.nodeHighlight("a", "m"))?.color).toBe(Presence.colorFor("carol"));
    activity.record(moved(Actor.client("api", "api:anon"), "o"));
    flush();
    expect(untrack(() => activity.nodeHighlight("a", "o"))?.color).toBe(neutralActivityColor);

    activity.record({
      _tag: "ConnectionCreated",
      actor: Actor.client("mcp", "mcp:bob", "bob"),
      graphId: "a",
      connection: {
        id: ConnectionId.make("wire"),
        outNodeId: NodeId.make("n"),
        outIo: { _tag: "Port", id: IoId.make("out") },
        inNodeId: NodeId.make("n"),
        inIoId: IoId.make("in"),
      },
    });

    flush();
    // An agent of a present user shares that user's colour.
    expect(untrack(() => activity.connectionHighlight("a", "wire"))?.color).toBe("#ec4899");
    expect(untrack(() => activity.lastEdit("mcp:bob"))?.position).toEqual({ x: 100, y: 200 });

    activity.record(moved(Actor.system, "p"));

    flush();
    activity.record(moved(Actor.client("browser", "self"), "q"));
    flush();
    expect(untrack(() => activity.nodeHighlight("a", "p"))).toBeUndefined();
    expect(untrack(() => activity.nodeHighlight("a", "q"))).toBeUndefined();

    const first = untrack(() => activity.nodeHighlight("a", "n"));
    vi.advanceTimersByTime(activityHighlightMs - 100);
    flush();
    activity.record(moved(Actor.client("browser", "bob-tab", "bob")));
    flush();
    const replayed = untrack(() => activity.nodeHighlight("a", "n"));
    expect(replayed?.token).not.toBe(first?.token);
    vi.advanceTimersByTime(200);
    flush();
    expect(untrack(() => activity.nodeHighlight("a", "n"))).toBe(replayed);
    vi.advanceTimersByTime(activityHighlightMs);
    flush();
    expect(untrack(() => activity.nodeHighlight("a", "n"))).toBeUndefined();
    expect(untrack(() => activity.connectionHighlight("a", "wire"))).toBeUndefined();
    // The last edit location outlives the highlight so agents stay followable.
    expect(untrack(() => activity.lastEdit("bob-tab"))?.graphId).toBe("a");
  });
});

describe("follow mode", () => {
  it("fits a shared viewport and centres on a point when there is none", () => {
    const current = { origin: { x: 0, y: 0 }, scale: 1 };
    expect(
      viewForTarget(
        { graphId: "a", viewport: { x: 100, y: 100, width: 400, height: 200 } },
        { width: 800, height: 800 },
        current,
      ),
    ).toEqual({ origin: { x: 100, y: 0 }, scale: 2 });
    expect(
      viewForTarget(
        { graphId: "a", point: { x: 50, y: 50 } },
        { width: 200, height: 100 },
        current,
      ),
    ).toEqual({ origin: { x: -50, y: 0 }, scale: 1 });
    expect(viewForTarget({ graphId: "a", point: null }, null, current)).toBeNull();

    const agent = client({ id: "mcp:bob", kind: "mcp", activeGraph: "a" });
    expect(
      followTarget(agent, () => ({ graphId: "b", position: { x: 1, y: 2 }, token: 1 })),
    ).toEqual({ graphId: "b", point: { x: 1, y: 2 } });
    expect(followTarget(agent, () => undefined)).toEqual({ graphId: "a", point: null });
  });

  const setup = (initialClients: ReadonlyArray<Presence.Client>) => {
    const editor = storeWithGraphs();
    const [clients, setClients] = createSignal(initialClients);
    const [graphId, setGraphId] = createSignal<string | null>("a");
    const [origin, setOrigin] = createSignal({ x: 0, y: 0 });
    const [scale, setScale] = createSignal(1);
    const follow = createRoot((cleanup) => {
      dispose = cleanup;
      const activity = createEditorActivity({
        editor,
        presenceClients: clients,
        selfId: () => "self",
      });
      const follow = createEditorFollow({
        editor,
        presenceClients: clients,
        selfId: () => "self",
        activity,
        canvasSize: () => ({ width: 1000, height: 500 }),
        layout: {
          activeWorkspaceView: () => ({
            type: "graph",
            id: "tab",
            graphId: graphId() ?? "a",
            view: defaultGraphView(),
          }),
          selectedGraphId: graphId,
          // Opening a graph restores its saved view after a microtask, like the workspace does.
          setSelectedGraphId: (id) =>
            queueMicrotask(() => {
              setGraphId(id);
              setOrigin({ x: 0, y: 0 });
              setScale(1);
            }),
          canvasOrigin: origin,
          setCanvasOrigin: setOrigin,
          canvasScale: scale,
          setCanvasScale: setScale,
        },
      });
      return { follow, activity };
    });
    const settle = async () => {
      flush();
      await Promise.resolve();
      flush();
      await Promise.resolve();
      flush();
    };
    return { ...follow, clients, setClients, graphId, origin, scale, setOrigin, settle };
  };

  const viewer = (overrides: Partial<Presence.Client> = {}) =>
    client({
      id: "bob",
      displayName: "bob",
      color: "#22c55e",
      activeGraph: "b",
      viewport: { x: 0, y: 0, width: 1000, height: 500 },
      ...overrides,
    });

  it("switches to the followed graph, tracks their viewport, and stops on manual panning", async () => {
    const state = setup([client({ id: "self" }), viewer()]);
    state.follow.follow("bob");
    await state.settle();
    expect(state.graphId()).toBe("b");
    expect(state.origin()).toEqual({ x: 0, y: 0 });
    expect(untrack(state.follow.followingId)).toBe("bob");

    state.setClients([
      client({ id: "self" }),
      viewer({ viewport: { x: 300, y: 100, width: 500, height: 250 } }),
    ]);
    await state.settle();
    expect(state.scale()).toBe(2);
    expect(state.origin()).toEqual({ x: 300, y: 100 });
    expect(untrack(state.follow.followingId)).toBe("bob");

    state.setOrigin({ x: 999, y: 100 });
    await state.settle();
    expect(untrack(state.follow.followingId)).toBeNull();
  });

  it("stops with a notice when the followed client leaves, and on Escape", async () => {
    const state = setup([client({ id: "self" }), viewer({ activeGraph: "a" })]);
    state.follow.follow("bob");
    await state.settle();
    state.setClients([client({ id: "self" })]);
    await state.settle();
    expect(untrack(state.follow.followingId)).toBeNull();
    expect(untrack(state.follow.notice)).toEqual({
      name: "bob",
      color: "#22c55e",
      message: "left the project",
    });

    state.setClients([client({ id: "self" }), viewer({ activeGraph: "a" })]);
    state.follow.follow("bob");
    await state.settle();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    flush();
    expect(untrack(state.follow.followingId)).toBeNull();
    state.follow.follow("self");
    flush();
    expect(untrack(state.follow.followingId)).toBeNull();
  });

  it("follows an agent to the location of its latest edit", async () => {
    const agent = client({ id: "mcp:bob", kind: "mcp", userId: "bob", displayName: "" });
    const state = setup([client({ id: "self" }), agent]);
    state.follow.follow("mcp:bob");
    await state.settle();
    expect(state.graphId()).toBe("a");

    state.activity.record({
      _tag: "NodeCreated",
      actor: Actor.client("mcp", "mcp:bob", "bob"),
      graphId: "b",
      node: node("created", 700, 400),
      io: { dataInputs: [], dataOutputs: [], executionInputs: [], executionOutputs: [] },
    });
    await state.settle();
    expect(state.graphId()).toBe("b");
    expect(state.origin()).toEqual({ x: 200, y: 150 });
    expect(untrack(state.follow.followingId)).toBe("mcp:bob");
  });
});
