import { assert, describe, it } from "@effect/vitest";
import { CloudCredentials } from "@macrograph/cloud-credentials";
import { GraphId, NodeId, PackageId, Project, ResourceConstant, SchemaId } from "@macrograph/core";
import { StaticRegistry } from "@macrograph/module-host/core";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Effect, Exit, Option, Scope, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { readFileSync } from "node:fs";
import { vi } from "vitest";

import { makeLocalConnection, type LocalEditorConnection } from "./LocalRuntime";
import {
  encodeLocalProject,
  makeLocalProjectStore,
  type StorageLike,
} from "./LocalStoragePersistence";
import { moduleUIs } from "./ModuleUIs";
import { modules } from "./PlaygroundModules";

/** Connects a bundled settings UI to the engine mounted in the local runtime, as the editor does. */
const connectSettings = (connection: LocalEditorConnection, moduleId: string) =>
  Effect.gen(function* () {
    const ui = moduleUIs.get(moduleId);
    const loaded = yield* Effect.promise(async () => (typeof ui === "function" ? await ui() : ui));
    const descriptor = loaded !== undefined && "default" in loaded ? loaded.default : loaded;
    const settings = descriptor?.settings;
    const rpc = yield* connection.moduleRpcProtocol(moduleId);
    if (settings === undefined || rpc._tag !== "InProcess")
      return yield* Effect.die(`No in-process settings for ${moduleId}`);
    return yield* settings.connectInProcess.pipe(Effect.provide(rpc.context));
  });

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

const sessionCredentials = [
  {
    provider: "twitch",
    id: "twitch-1",
    displayName: "Streamer",
    token: { access_token: "twitch-access", expires_in: 3600, token_type: "bearer", issuedAt: 1 },
  },
];

/** The website API, signed in until `signOut` is called. */
const websiteApi = () => {
  let signedIn = true;
  return {
    signOut: () => {
      signedIn = false;
    },
    client: HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new URL(request.url).pathname === "/api/credentials" && signedIn
            ? Response.json(sessionCredentials)
            : new Response(null, { status: 403 }),
        ),
      ),
    ),
  };
};

describe("local browser runtime", () => {
  it.effect(
    "exposes the signed-in user's Twitch credentials in module settings and resources",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const api = websiteApi();
          const credentials = yield* CloudCredentials.makeSession({
            origin: "https://macrograph.app",
          }).pipe(Effect.provideService(HttpClient.HttpClient, api.client));
          const connection = yield* makeLocalConnection(
            makeLocalProjectStore(new MemoryStorage()),
            credentials,
          );
          const catalog = yield* connection.client.GetCredentialCatalog();
          assert.strictEqual(catalog._tag, "CredentialCatalogAvailable");
          const settings = yield* connectSettings(connection, "macrograph.app/macrograph/twitch");
          assert.deepStrictEqual(
            yield* settings.load(
              connection.client.GetModuleClientState({
                moduleId: "macrograph.app/macrograph/twitch",
              }),
            ),
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
              package: "macrograph.app/macrograph/twitch",
              resource: "TwitchAccount",
            }),
            [{ id: "twitch-1", display: "Streamer" }],
          );
          api.signOut();
          assert.strictEqual(
            (yield* connection.client.RefetchCredentials())._tag,
            "CredentialCatalogUnavailable",
          );
          assert.deepStrictEqual(
            yield* settings.load(
              connection.client.GetModuleClientState({
                moduleId: "macrograph.app/macrograph/twitch",
              }),
            ),
            { transport: "websocket", accounts: [] },
          );
        }),
      ),
  );

  it.effect("doesn't request credentials for signed-out visitors", () =>
    Effect.gen(function* () {
      const requests: Array<string> = [];
      const credentials = yield* CloudCredentials.makeSession({
        signedIn: Effect.succeed(false),
      }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => {
              requests.push(request.url);
              return HttpClientResponse.fromWeb(request, new Response(null, { status: 403 }));
            }),
          ),
        ),
      );
      assert.deepStrictEqual(yield* credentials.get, []);
      const catalog = yield* credentials.catalog!;
      assert.strictEqual(catalog._tag, "CredentialCatalogUnavailable");
      assert.deepStrictEqual(requests, []);
    }),
  );

  it.effect("projects editor mutations and exposes only browser-safe modules", () =>
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
        assert.strictEqual(project.graphs[created.graph.id]?.canvas.name, "Browser graph");
        assert.deepStrictEqual(
          concurrent.map((event) => project.graphs[event.graph.id]?.canvas.name).sort(),
          ["Concurrent A", "Concurrent B"],
        );

        const packageIds = (yield* connection.client.GetPackages({})).map((pkg) => pkg.id).sort();
        assert.deepStrictEqual(
          packageIds,
          [
            ...[
              "macrograph.app/macrograph/custom-types",
              "macrograph.app/macrograph/http-client",
              "macrograph.app/macrograph/json",
              "macrograph.app/macrograph/list",
              "macrograph.app/macrograph/logic",
              "macrograph.app/macrograph/functions",
              "macrograph.app/macrograph/queues",
              "macrograph.app/macrograph/math",
              "macrograph.app/macrograph/obs",
              "macrograph.app/macrograph/string",
              "macrograph.app/macrograph/twitch",
              "macrograph.app/macrograph/utilities",
              "macrograph.app/macrograph/websocket-client",
            ],
          ].sort(),
        );
        assert.strictEqual(new Set(packageIds).size, packageIds.length);
        for (const moduleId of [
          "macrograph.app/macrograph/utilities",
          "macrograph.app/macrograph/obs",
          "macrograph.app/macrograph/twitch",
          "macrograph.app/macrograph/websocket-client",
        ])
          assert.strictEqual(
            (yield* connection.moduleRpcProtocol(moduleId))._tag,
            "InProcess",
            moduleId,
          );
        assert.isTrue(
          Exit.isFailure(
            yield* Effect.exit(connection.moduleRpcProtocol("macrograph.app/macrograph/json")),
          ),
        );
        assert.deepStrictEqual(
          yield* (yield* connectSettings(connection, "macrograph.app/macrograph/utilities")).load(
            connection.client.GetModuleClientState({
              moduleId: "macrograph.app/macrograph/utilities",
            }),
          ),
          { running: true },
        );
        assert.deepStrictEqual(
          yield* connection.client.GetResourceValues({
            package: "macrograph.app/macrograph/obs",
            resource: "OBSWebSocket",
          }),
          [],
        );
        assert.deepStrictEqual(
          yield* connection.client.GetResourceValues({
            package: "macrograph.app/macrograph/twitch",
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

  it.effect("loads bundled modules through the registry and unloads them by scope", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* makeLocalConnection(makeLocalProjectStore(new MemoryStorage()));
        const catalog = yield* connection.moduleCatalog.fetch([]);
        assert.deepStrictEqual(
          catalog.map((entry) => [entry.id, entry.status]),
          modules.map((module) => [StaticRegistry.id(module.static), "loaded"]).sort(),
        );
        for (const module of modules) {
          const packageJson = JSON.parse(
            readFileSync(
              new URL(
                `../../../../packages/modules/${module.static.manifest.name}/package.json`,
                import.meta.url,
              ),
              "utf8",
            ),
          );
          const config = packageJson.macrograph;
          assert.deepStrictEqual(
            [
              module.static.manifest.displayName,
              module.static.manifest.description,
              module.static.manifest.version,
            ],
            [config.displayName, config.description, config.version],
            module.static.manifest.name,
          );
        }
        for (const id of moduleUIs.keys())
          assert.isTrue(
            catalog.some((entry) => entry.id === id),
            id,
          );

        const obs = "macrograph.app/macrograph/obs" as const;
        const obsId = Option.getOrThrow(ModuleId.parse(obs));
        yield* connection.modules.unload(obsId);
        assert.isFalse((yield* connection.client.GetPackages({})).some((pkg) => pkg.id === obs));
        assert.isTrue(Exit.isFailure(yield* Effect.exit(connection.moduleRpcProtocol(obs))));
        yield* connection.modules.load(obsId);
        assert.isTrue((yield* connection.client.GetPackages({})).some((pkg) => pkg.id === obs));
        assert.strictEqual((yield* connection.moduleRpcProtocol(obs))._tag, "InProcess");
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
      assert.strictEqual(project.graphs[created.graph.id]?.canvas.name, "Restored");
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
              resource: { package: "macrograph.app/macrograph/obs", resource: "OBSWebSocket" },
              value: "ws://localhost:4455",
            },
          },
          graphs: {
            graph: {
              canvas: {
                id: GraphId.make("graph"),
                name: "OBS events",
                connections: [],
                nodes: {
                  event: {
                    id: NodeId.make("event"),
                    name: "Custom Event",
                    schema: {
                      package: PackageId.make("macrograph.app/macrograph/obs"),
                      schema: SchemaId.make("CustomEvent"),
                    },
                    properties: { socket: "socket" },
                    inputDefaults: {},
                    foldPins: false,
                    position: { x: 0, y: 0 },
                  },
                },
              },
            },
          },
          engines: {
            "macrograph.app/macrograph/obs": {
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
          assert.strictEqual(events[0]?.moduleId, "macrograph.app/macrograph/obs");
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
