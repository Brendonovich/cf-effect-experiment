import { assert, describe, it } from "@effect/vitest";
import {
  CustomEvent,
  GraphId,
  NodeId,
  PackageId,
  Project,
  ResourceConstant,
  SchemaId,
} from "@macrograph/core";
import { Effect, Exit, Option, Scope, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { vi } from "vitest";

import { MACROGRAPH_AUTH_SESSION_KEY, makeBrowserCredentialProvider } from "./BrowserCredentials";
import { makeLocalConnection } from "./LocalRuntime";
import {
  encodeLocalProject,
  makeLocalProjectStore,
  type StorageLike,
} from "./LocalStoragePersistence";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

class MockObsWebSocket extends EventTarget {
  readonly readyState = 1;
  readonly sent: Array<{ readonly op: number; readonly d: Record<string, unknown> }> = [];

  constructor(readonly url: string) {
    super();
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            op: 0,
            d: {
              obsWebSocketVersion: "5.5.2",
              rpcVersion: 1,
              authentication: { challenge: "challenge", salt: "salt" },
            },
          }),
        }),
      ),
    );
  }

  send(data: string) {
    const packet = JSON.parse(data) as { readonly op: number; readonly d: Record<string, unknown> };
    this.sent.push(packet);
    if (packet.op === 1)
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }),
          }),
        ),
      );
  }

  close() {}
}

const obsAuthentication = async (password: string) => {
  const digest = async (value: string) => {
    const bytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  return digest(`${await digest(`${password}salt`)}challenge`);
};

describe("local browser runtime", () => {
  it.effect(
    "authors custom events via RPC and restores stable generated nodes after localStorage reload",
    () =>
      Effect.gen(function* () {
        const storage = new MemoryStorage();
        const store = makeLocalProjectStore(storage);
        const event: CustomEvent.Model = {
          id: "greeting",
          name: "Greeting",
          fields: [{ id: "message", name: "Message", type: { _tag: "String" } }],
        };
        yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* makeLocalConnection(store);
            yield* connection.client.PutCustomEvent({ event });
            const { graph } = yield* connection.client.CreateGraph({ graph: { name: "Events" } });
            yield* connection.client.CreateNode({
              graphId: graph.id,
              node: {
                schema: {
                  package: CustomEvent.packageId,
                  schema: CustomEvent.schemaId(event.id, "emit"),
                },
                inputDefaults: { "field:message": "hello" },
              },
            });
            yield* connection.client.PutCustomEvent({
              event: { ...event, name: "Renamed", fields: [{ ...event.fields[0]!, name: "Text" }] },
            });
            store.flush();
          }),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* makeLocalConnection(makeLocalProjectStore(storage));
            const project = yield* connection.client.GetProject({});
            assert.strictEqual(project.customEvents.greeting?.name, "Renamed");
            const schema = (yield* connection.client.GetPackages({}))
              .find((pkg) => pkg.id === CustomEvent.packageId)!
              .schemas.find((schema) => schema.id === "emit:greeting")!;
            assert.deepStrictEqual(schema.dataInputs[0], {
              id: CustomEvent.fieldId("message"),
              name: "Text",
              type: { _tag: "String" },
            });
            const node = Object.values(Object.values(project.graphs)[0]!.nodes)[0]!;
            assert.strictEqual(node.schema.schema, "emit:greeting");
            assert.deepStrictEqual(node.inputDefaults, { "field:message": "hello" });
          }),
        );
      }),
  );
  it.effect("exposes connected Twitch credentials in plugin settings and resources", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const storage = new MemoryStorage();
        storage.setItem(
          MACROGRAPH_AUTH_SESSION_KEY,
          JSON.stringify({
            state: "connected",
            token: "session-secret",
            userId: "user-1",
            email: "user@example.com",
            expiresAt: 60_000,
          }),
        );
        const credentials = yield* makeBrowserCredentialProvider({
          storage,
          now: () => 1_000,
        }).pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  Response.json([
                    {
                      provider: "twitch",
                      id: "twitch-1",
                      displayName: "Streamer",
                      token: {
                        access_token: "twitch-access",
                        expires_in: 3600,
                        token_type: "bearer",
                        issuedAt: 1,
                      },
                    },
                  ]),
                ),
              ),
            ),
          ),
        );
        const connection = yield* makeLocalConnection(makeLocalProjectStore(storage), credentials);
        const catalog = yield* connection.client.GetCredentialCatalog();
        assert.strictEqual(catalog._tag, "CredentialCatalogAvailable");
        const settings = connection.pluginSettings.get("twitch")!;
        assert.deepStrictEqual(
          yield* settings.load((pluginId) => connection.client.GetPluginClientState({ pluginId })),
          {
            transport: "websocket",
            accounts: [
              {
                id: "twitch-1",
                displayName: "Streamer",
                eventSubSocket: { state: "disconnected" },
                enabledSubscriptions: [],
              },
            ],
          },
        );
        assert.deepStrictEqual(
          yield* connection.client.GetResourceValues({
            package: "twitch",
            resource: "TwitchAccount",
          }),
          [{ id: "twitch-1", display: "Streamer" }],
        );
        yield* connection.client.DisconnectCredentialAuth();
        assert.deepStrictEqual(
          yield* settings.load((pluginId) => connection.client.GetPluginClientState({ pluginId })),
          { transport: "websocket", accounts: [] },
        );
      }),
    ),
  );

  it.effect("projects editor mutations and exposes only browser-safe plugins", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* makeLocalConnection(makeLocalProjectStore(new MemoryStorage()));
        assert.isDefined(connection.activity);
        assert.deepStrictEqual(
          Option.getOrThrow(yield* connection.activity!.pipe(Stream.runHead)),
          [],
        );
        const snapshot = yield* connection.client.ProjectEventsStream().pipe(Stream.runHead);
        assert.isTrue(Option.isSome(snapshot));
        if (Option.isSome(snapshot)) assert.strictEqual(snapshot.value._tag, "ProjectSnapshot");

        const created = yield* connection.client.CreateGraph({ graph: { name: "Browser graph" } });
        const concurrent = yield* Effect.all(
          ["Concurrent A", "Concurrent B"].map((name) =>
            connection.client.CreateGraph({ graph: { name } }),
          ),
          { concurrency: "unbounded" },
        );
        const project = yield* connection.client.GetProject({});
        assert.strictEqual(project.graphs[created.graph.id]?.name, "Browser graph");
        assert.deepStrictEqual(
          concurrent.map((event) => project.graphs[event.graph.id]?.name).sort(),
          ["Concurrent A", "Concurrent B"],
        );

        const packageIds = (yield* connection.client.GetPackages({})).map((pkg) => pkg.id).sort();
        assert.deepStrictEqual(packageIds, [
          "http-client",
          "json",
          "list",
          "logic",
          "math",
          "obs",
          "project-events",
          "string",
          "twitch",
          "util",
          "websocket-client",
        ]);
        assert.strictEqual(new Set(packageIds).size, packageIds.length);
        assert.deepStrictEqual(
          [...connection.pluginSettings.keys()],
          ["util", "obs", "twitch", "websocket-client"],
        );
        assert.deepStrictEqual(
          yield* connection.pluginSettings
            .get("util")!
            .load((pluginId) => connection.client.GetPluginClientState({ pluginId })),
          { running: true },
        );
        assert.deepStrictEqual(
          yield* connection.client.GetResourceValues({ package: "obs", resource: "OBSWebSocket" }),
          [],
        );
        assert.deepStrictEqual(
          yield* connection.client.GetResourceValues({
            package: "twitch",
            resource: "TwitchAccount",
          }),
          [],
        );

        const presence = yield* connection.client.PresenceStream().pipe(Stream.runHead);
        assert.isTrue(Option.isSome(presence));
        if (Option.isSome(presence) && presence.value._tag === "PresenceSnapshot") {
          assert.strictEqual(presence.value.clients.length, 1);
          assert.strictEqual(presence.value.clients[0]?.canEdit, true);
        }
        const presenceAfterInterrupt = yield* connection.client
          .PresenceStream()
          .pipe(Stream.runHead);
        assert.isTrue(Option.isSome(presenceAfterInterrupt));
        if (
          Option.isSome(presenceAfterInterrupt) &&
          presenceAfterInterrupt.value._tag === "PresenceSnapshot"
        )
          assert.strictEqual(presenceAfterInterrupt.value.clients.length, 1);
      }),
    ),
  );

  it.effect("restores data across scoped runtime reloads without duplicating packages", () =>
    Effect.gen(function* () {
      const storage = new MemoryStorage();
      const store = makeLocalProjectStore(storage);
      const firstScope = yield* Scope.make();
      const first = yield* makeLocalConnection(store).pipe(Scope.provide(firstScope));
      const created = yield* first.client.CreateGraph({ graph: { name: "Restored" } });
      yield* Scope.close(firstScope, Exit.void);
      store.flush();

      const secondScope = yield* Scope.make();
      const second = yield* makeLocalConnection(makeLocalProjectStore(storage)).pipe(
        Scope.provide(secondScope),
      );
      const project = yield* second.client.GetProject({});
      assert.strictEqual(project.graphs[created.graph.id]?.name, "Restored");
      const packages = yield* second.client.GetPackages({});
      assert.strictEqual(packages.length, new Set(packages.map((pkg) => pkg.id)).size);
      yield* Scope.close(secondScope, Exit.void);
    }),
  );

  it.effect("reconnects OBS from storage and streams real event and node activity", () =>
    Effect.gen(function* () {
      const storage = new MemoryStorage();
      const persisted = makeLocalProjectStore(storage);
      persisted.importProject(
        encodeLocalProject({
          ...Project.empty(),
          constants: {
            socket: {
              id: ResourceConstant.Id.make("socket"),
              name: "OBS",
              resource: { package: "obs", resource: "OBSWebSocket" },
              value: "ws://localhost:4455",
            },
          },
          graphs: {
            graph: {
              id: GraphId.make("graph"),
              name: "OBS events",
              connections: [],
              nodes: {
                event: {
                  id: NodeId.make("event"),
                  name: "Custom Event",
                  schema: { package: PackageId.make("obs"), schema: SchemaId.make("CustomEvent") },
                  properties: { socket: "socket" },
                  inputDefaults: {},
                  foldPins: false,
                  position: { x: 0, y: 0 },
                },
              },
            },
          },
          engines: {
            obs: {
              sockets: {
                "ws://localhost:4455": {
                  password: "reload-secret",
                  connectOnStartup: true,
                },
              },
            },
          },
        }),
      );
      const sockets: Array<MockObsWebSocket> = [];
      vi.stubGlobal(
        "WebSocket",
        class extends MockObsWebSocket {
          constructor(url: string) {
            super(url);
            sockets.push(this);
          }
        },
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* makeLocalConnection(makeLocalProjectStore(storage));
          while (sockets[0]?.sent[0] === undefined) yield* Effect.yieldNow;
          const authentication = yield* Effect.promise(() => obsAuthentication("reload-secret"));
          assert.strictEqual(sockets[0]?.url, "ws://localhost:4455");
          assert.deepStrictEqual(sockets[0]?.sent[0], {
            op: 1,
            d: {
              rpcVersion: 1,
              eventSubscriptions: 0x7ff,
              authentication,
            },
          });
          sockets[0]!.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                op: 5,
                d: {
                  eventType: "CustomEvent",
                  eventIntent: 512,
                  eventData: { eventData: { message: "hello" } },
                },
              }),
            }),
          );
          const events = Option.getOrThrow(
            yield* connection.activity!.pipe(
              Stream.filter((events) => events[0]?.status === "complete"),
              Stream.runHead,
            ),
          );
          assert.strictEqual(events[0]?.pluginId, "obs");
          assert.strictEqual(events[0]?.name, "CustomEvent");
          assert.include(events[0]!.payload, "hello");
          assert.lengthOf(events[0]!.nodes, 1);
          assert.strictEqual(events[0]?.nodes[0]?.graphId, "graph");
          assert.strictEqual(events[0]?.nodes[0]?.nodeId, "event");
          assert.strictEqual(events[0]?.nodes[0]?.status, "complete");
          assert.isDefined(connection.replayEvent);
          yield* connection.replayEvent!(events[0]!.id);
          const replayed = Option.getOrThrow(
            yield* connection.activity!.pipe(
              Stream.filter(
                (snapshot) =>
                  snapshot[0]?.source === "Replay" && snapshot[0]?.status === "complete",
              ),
              Stream.runHead,
            ),
          );
          assert.lengthOf(replayed, events.length + 1);
          assert.notStrictEqual(replayed[0]?.id, events[0]?.id);
          assert.strictEqual(replayed[0]?.payload, events[0]?.payload);
          assert.strictEqual(replayed[0]?.nodes[0]?.nodeId, "event");
          assert.strictEqual(replayed[0]?.nodes[0]?.status, "complete");
          assert.deepStrictEqual(replayed[1], events[0]);
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())));
    }),
  );
});
