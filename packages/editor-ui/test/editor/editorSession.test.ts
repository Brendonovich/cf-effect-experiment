// @vitest-environment happy-dom

import type { Presence } from "@macrograph/editor";

import { Graph, NodeId, PackageId, Project, SchemaId } from "@macrograph/core";
import { Effect, Stream } from "effect";
import { RpcClientError } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import { createRoot, createSignal, flush, untrack } from "solid-js";
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
afterEach(() => dispose());

type TestClient<Keys extends keyof EditorRpcClient> = {
  [Key in Keys]: (...args: Parameters<EditorRpcClient[Key]>) => ReturnType<EditorRpcClient[Key]>;
};

describe("editor presence lifecycle", () => {
  it("clears stale presence and reconnects when only the presence stream fails", async () => {
    let fail = () => {};
    let attempts = 0;
    const closed = vi.fn();
    const client = {
      GetPackages: () => Effect.succeed([]),
      GetIngressEndpoints: () => Effect.succeed([]),
      GetPluginSettingsCapabilities: () => Effect.succeed([]),
      ProjectEventsStream: () => Stream.never,
      QueueStateStream: () => Stream.succeed([]).pipe(Stream.concat(Stream.never)),
      PresenceStream: () =>
        Stream.succeed({
          _tag: "PresenceSnapshot",
          selfConnectionId: `self-${attempts}`,
          clients: [
            {
              connectionId: attempts === 1 ? "previous" : `self-${attempts}`,
              displayName: "Previous",
              color: "#ffffff",
              canEdit: true,
              activeGraph: "graph",
              cursor: null,
              selectedNodeIds: attempts === 1 ? ["node"] : [],
            },
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
      | "GetPluginSettingsCapabilities"
      | "ProjectEventsStream"
      | "QueueStateStream"
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
            return { client: client as unknown as EditorRpcClient, pluginSettings: new Map() };
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
      expect(untrack(connection.selfConnectionId)).toBeUndefined();
      expect(untrack(connection.client)).toBeNull();
      expect(closed).toHaveBeenCalledOnce();
    });
    await vi.waitFor(
      () => {
        expect(attempts).toBe(2);
        expect(untrack(connection.selfConnectionId)).toBe("self-2");
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
      const [selfConnectionId, setSelfConnectionId] = createSignal<string>();
      const editor = createEditorStore();
      const graph = Graph.empty("graph");
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
        presenceClients: () => [],
        selfConnectionId,
      });
      return { presence, setSelfConnectionId };
    });
    flush();
    state.presence.publishPointer({ x: 1, y: 2 }, true);
    await Promise.resolve();
    expect(updates).toEqual([]);
    state.setSelfConnectionId("connected");
    flush();
    await vi.waitFor(() =>
      expect(updates).toEqual([
        {
          activeGraph: "graph",
          cursor: { x: 1, y: 2 },
          selectedNodeIds: ["node"],
        },
      ]),
    );
    state.presence.dispose();
    await Promise.resolve();
    expect(updates).toHaveLength(1);
  });
});
