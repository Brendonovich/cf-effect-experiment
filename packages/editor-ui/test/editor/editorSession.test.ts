// @vitest-environment happy-dom

import type { Presence } from "@macrograph/editor";

import { Canvas, NodeId, PackageId, Project, SchemaId } from "@macrograph/core";
import { Effect, PubSub, Stream } from "effect";
import { RpcClientError } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import { createMemo, createRoot, createSignal, flush, untrack } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorRpcClient } from "../../src/editor/Editor";

import { createEditorConnection } from "../../src/editor/session/createEditorConnection";
import { createEditorPresence } from "../../src/editor/session/createEditorPresence";
import { createEditorStore } from "../../src/editor/store";
import { defaultGraphView } from "../../src/editor/workspace/workspace";

vi.mock(
  "solid-js",
  () => import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href),
);

let dispose = () => {};

const presenceClient = (overrides: Partial<Presence.Client> & { id: string }): Presence.Client => ({
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
afterEach(() => dispose());

type TestClient<Keys extends keyof EditorRpcClient> = {
  [Key in Keys]: (...args: Parameters<EditorRpcClient[Key]>) => ReturnType<EditorRpcClient[Key]>;
};

describe("editor presence lifecycle", () => {
  it("exposes current edit permissions outside tracking and handles revocation", async () => {
    const events = Effect.runSync(PubSub.unbounded<Presence.Snapshot | Presence.Changed>());
    const self = presenceClient({ id: "self", displayName: "Self" });
    const client = {
      GetPackages: () => Effect.succeed([]),
      GetIngressEndpoints: () => Effect.succeed([]),
      GetModuleSettingsCapabilities: () => Effect.succeed([]),
      QueueStateStream: () => Stream.never,
      ProjectEventsStream: () =>
        Stream.succeed({
          _tag: "ProjectSnapshot" as const,
          snapshot: { project: { ...Project.empty(), graphs: {} }, nodeIO: {} },
        }).pipe(Stream.concat(Stream.never)),
      PresenceStream: () => Stream.fromPubSub(events),
    } satisfies TestClient<
      | "GetPackages"
      | "GetIngressEndpoints"
      | "GetModuleSettingsCapabilities"
      | "QueueStateStream"
      | "ProjectEventsStream"
      | "PresenceStream"
    >;
    const { connection, ready } = createRoot((cleanup) => {
      dispose = cleanup;
      const connection = createEditorConnection(
        {
          settingsDescriptors: [],
          connection: Effect.succeed({
            client: client as unknown as EditorRpcClient,
            moduleSettings: new Map(),
          }),
        },
        createEditorStore(),
        () => {},
        () => {},
      );
      return { connection, ready: createMemo(connection.editorReady) };
    });
    await vi.waitFor(() => expect(untrack(ready)).toBe(true));
    expect(untrack(connection.canEdit)).toBe(false);
    await Effect.runPromise(
      PubSub.publish(events, {
        _tag: "PresenceSnapshot",
        selfId: "self",
        clients: [self],
      }),
    );
    await vi.waitFor(() => expect(untrack(connection.canEdit)).toBe(true));
    await Effect.runPromise(
      PubSub.publish(events, { _tag: "PresenceChanged", clients: [{ ...self, canEdit: false }] }),
    );
    await vi.waitFor(() => expect(untrack(connection.canEdit)).toBe(false));
    await Effect.runPromise(PubSub.publish(events, { _tag: "PresenceChanged", clients: [self] }));
    await vi.waitFor(() => expect(untrack(connection.canEdit)).toBe(true));
    await Effect.runPromise(PubSub.shutdown(events));
  });

  it("clears stale presence and reconnects when only the presence stream fails", async () => {
    let fail = () => {};
    let attempts = 0;
    const closed = vi.fn();
    const client = {
      GetPackages: () => Effect.succeed([]),
      GetIngressEndpoints: () => Effect.succeed([]),
      GetModuleSettingsCapabilities: () => Effect.succeed([]),
      QueueStateStream: () => Stream.never,
      ProjectEventsStream: () => Stream.never,
      PresenceStream: () =>
        Stream.succeed({
          _tag: "PresenceSnapshot",
          selfId: `self-${attempts}`,
          clients: [
            presenceClient({
              id: attempts === 1 ? "previous" : `self-${attempts}`,
              displayName: "Previous",
              activeGraph: "graph",
              selectedNodeIds: attempts === 1 ? ["node"] : [],
            }),
          ],
        } satisfies Presence.Snapshot).pipe(
          Stream.concat(
            Stream.fromEffect(
              Effect.callback<never, RpcClientError.RpcClientError>((resume) => {
                fail = () =>
                  resume(
                    Effect.fail(
                      new RpcClientError.RpcClientError({
                        reason: new Socket.SocketCloseError({ code: 1000 }),
                      }),
                    ),
                  );
              }),
            ),
          ),
        ),
    } satisfies TestClient<
      | "GetPackages"
      | "GetIngressEndpoints"
      | "GetModuleSettingsCapabilities"
      | "QueueStateStream"
      | "ProjectEventsStream"
      | "PresenceStream"
    >;
    const connection = createRoot((cleanup) => {
      dispose = cleanup;
      return createEditorConnection(
        {
          settingsDescriptors: [],
          reconnect: true,
          connection: Effect.gen(function* () {
            attempts++;
            yield* Effect.addFinalizer(() => Effect.sync(closed));
            return { client: client as unknown as EditorRpcClient, moduleSettings: new Map() };
          }),
        },
        createEditorStore(),
        () => {},
        () => {},
      );
    });
    await vi.waitFor(() => expect(untrack(connection.presenceClients)).toHaveLength(1));
    fail();
    await vi.waitFor(() => {
      expect(untrack(connection.presenceClients)).toEqual([]);
      expect(untrack(connection.selfId)).toBeUndefined();
      expect(untrack(connection.client)).toBeNull();
      expect(closed).toHaveBeenCalledOnce();
    });
    await vi.waitFor(
      () => {
        expect(attempts).toBe(2);
        expect(untrack(connection.selfId)).toBe("self-2");
        expect(untrack(connection.presenceClients).map((client) => client.selectedNodeIds)).toEqual(
          [[]],
        );
      },
      { timeout: 2000 },
    );
  });

  it("publishes current selection after registration and does not send updates on disposal", async () => {
    const updates: Presence.Update[] = [];
    const client = {
      UpdatePresence: (update: Presence.Update) =>
        Effect.sync(() => {
          updates.push(update);
        }),
    } satisfies TestClient<"UpdatePresence">;
    const state = createRoot((cleanup) => {
      dispose = cleanup;
      const [selfId, setSelfId] = createSignal<string>();
      const editor = createEditorStore();
      const graph = Canvas.empty("graph");
      editor.setProject(
        {
          ...Project.empty(),
          graphs: {
            graph: {
              ...graph,
              nodes: {
                node: {
                  id: NodeId.make("node"),
                  name: "Node",
                  schema: { package: PackageId.make("test"), schema: SchemaId.make("test") },
                  position: { x: 0, y: 0 },
                  properties: {},
                  inputDefaults: {},
                  foldPins: false,
                },
              },
            },
          },
        },
        {},
      );
      const presence = createEditorPresence({
        client: () => client as unknown as EditorRpcClient,
        editor,
        selectedGraphId: () => "graph",
        selectedNodeIds: () => ["node"],
        activeWorkspaceView: () => ({
          type: "graph",
          graphId: "graph",
          id: "tab",
          view: defaultGraphView(),
        }),
        canvasOrigin: () => ({ x: 0, y: 0 }),
        canvasScale: () => 1,
        presenceClients: () => [],
        selfId,
      });
      return { presence, setSelfId };
    });
    flush();
    state.presence.publishPointer({ x: 1, y: 2 }, true);
    await Promise.resolve();
    expect(updates).toEqual([]);
    state.setSelfId("connected");
    flush();
    await vi.waitFor(() =>
      expect(updates).toEqual([
        {
          activeGraph: "graph",
          cursor: { x: 1, y: 2 },
          viewport: null,
          selectedNodeIds: ["node"],
        },
      ]),
    );
    state.presence.dispose();
    await Promise.resolve();
    expect(updates).toHaveLength(1);
  });

  it("shares the visible viewport in graph coordinates", async () => {
    const updates: Presence.Update[] = [];
    const client = {
      UpdatePresence: (update: Presence.Update) =>
        Effect.sync(() => {
          updates.push(update);
        }),
    } satisfies TestClient<"UpdatePresence">;
    const state = createRoot((cleanup) => {
      dispose = cleanup;
      const editor = createEditorStore();
      editor.setProject({ ...Project.empty(), graphs: { graph: Canvas.empty("graph") } }, {});
      const [scale, setScale] = createSignal(1);
      const presence = createEditorPresence({
        client: () => client as unknown as EditorRpcClient,
        editor,
        selectedGraphId: () => "graph",
        selectedNodeIds: () => [],
        activeWorkspaceView: () => ({
          type: "graph",
          graphId: "graph",
          id: "tab",
          view: defaultGraphView(),
        }),
        canvasOrigin: () => ({ x: 10, y: 20 }),
        canvasScale: scale,
        presenceClients: () => [],
        selfId: () => "self",
      });
      return { presence, setScale };
    });
    flush();
    state.presence.setCanvasSize({ width: 800, height: 400 });
    flush();
    await vi.waitFor(() =>
      expect(updates.at(-1)?.viewport).toEqual({ x: 10, y: 20, width: 800, height: 400 }),
    );
    state.setScale(2);
    flush();
    await vi.waitFor(() =>
      expect(updates.at(-1)?.viewport).toEqual({ x: 10, y: 20, width: 400, height: 200 }),
    );
    state.presence.dispose();
  });
});
