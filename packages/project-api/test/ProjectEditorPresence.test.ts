import { assert, describe, it } from "@effect/vitest";
import { IoId, Package, PackageId, Project, SchemaId } from "@macrograph/core";
import { Editor, EditorAccess, EditorEvents, Packages, Presence } from "@macrograph/editor";
import { t } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer, Stream } from "effect";
import { TestClock } from "effect/testing";

import { ApiCaller, ProjectEditor } from "../src/index.ts";

const pkg: Package.Model = {
  id: PackageId.make("test"),
  name: "Test",
  resources: [],
  schemas: [
    {
      id: SchemaId.make("text"),
      name: "Text",
      type: "pure",
      properties: [],
      dataInputs: [{ id: IoId.make("in"), type: t.String }],
      dataOutputs: [{ id: IoId.make("out"), type: t.String }],
      executionInputs: [],
      executionOutputs: [],
    },
  ],
};

const EditorLayer = Editor.layer.pipe(
  Layer.provideMerge(EditorEvents.layer),
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Presence.layer),
  Layer.provide(
    Layer.effectDiscard(
      Persistence.Service.use((persistence) => persistence.saveProject(Project.empty())),
    ),
  ),
  Layer.provideMerge(Persistence.layerMemory),
);

const access = { userId: "user-1", projectId: "local", canEdit: true, canManageCredentials: false };
const restKey = { id: "key-1", name: "CI deploy key" };
const rest = ApiCaller.identityFor(ApiCaller.forApiKey(restKey, "ada@example.com"), access);
const mcp = ApiCaller.identityFor(
  ApiCaller.forMcp(ApiCaller.forApiKey(restKey, "ada@example.com"), "session-1", {
    name: "Claude Desktop",
    version: "1.2.3",
  }),
  access,
);

const entry = (identity: EditorAccess.ConnectionIdentity) =>
  Effect.gen(function* () {
    const presence = yield* Presence.Registry;
    return (yield* presence.snapshot("local")).find((client) => client.id === identity.actor.id);
  });

describe("project editor presence", () => {
  it.effect("shows REST and MCP callers where they are working, then expires them", () =>
    Effect.gen(function* () {
      yield* (yield* Packages.Service).loadPackage(pkg);
      const operations = yield* ProjectEditor.make;
      const node = { schema: { package: pkg.id, schema: SchemaId.make("text") } };

      // Project-wide reads show the caller without a graph.
      yield* operations.listGraphs(mcp);
      const listed = yield* entry(mcp);
      assert.strictEqual(listed?.kind, "mcp");
      assert.strictEqual(listed?.userId, "user-1");
      assert.strictEqual(listed?.displayName, "ada");
      assert.strictEqual(listed?.email, "ada@example.com");
      assert.strictEqual(listed?.color, Presence.colorFor("user-1"));
      assert.isNull(listed?.activeGraph);
      assert.deepStrictEqual(listed?.remote, {
        name: "Claude Desktop",
        version: "1.2.3",
        apiKeyName: "CI deploy key",
      });
      assert.strictEqual(listed?.lastActiveAt, 0);
      assert.strictEqual(listed?.expiresAt, 90_000);

      const graph = yield* operations.createGraph({ name: "Agent graph" }, mcp);
      assert.isDefined(graph);
      const graphId = graph!.id;
      assert.strictEqual((yield* entry(mcp))?.activeGraph, graphId);

      yield* TestClock.adjust("10 seconds");
      yield* operations.createNode(graphId, { ...node, position: { x: 120, y: 40 } }, mcp);
      const created = yield* entry(mcp);
      assert.deepStrictEqual(created?.cursor, { x: 120, y: 40 });
      assert.strictEqual(created?.lastActiveAt, 10_000);
      assert.strictEqual(created?.expiresAt, 100_000);

      // Reads that are not about a graph keep the caller's graph and location.
      yield* operations.searchSchemas({ query: "text" }, mcp);
      yield* operations.listResources(mcp);
      assert.strictEqual((yield* entry(mcp))?.activeGraph, graphId);
      assert.deepStrictEqual((yield* entry(mcp))?.cursor, { x: 120, y: 40 });

      // REST callers are separate entries labelled by their key.
      const other = yield* operations.createGraph({ name: "CI graph" }, rest);
      yield* operations.getGraph(other!.id, rest);
      const api = yield* entry(rest);
      assert.strictEqual(api?.kind, "api");
      assert.strictEqual(api?.activeGraph, other!.id);
      assert.deepStrictEqual(api?.remote, {
        name: "CI deploy key",
        version: null,
        apiKeyName: "CI deploy key",
      });

      // Deleting the graph a caller is on moves it off the graph.
      yield* operations.deleteGraph(other!.id, rest);
      assert.isNull((yield* entry(rest))?.activeGraph);

      // Expiry is broadcast so open editors drop the entry live.
      const changes: Array<ReadonlyArray<string>> = [];
      yield* Effect.provideService(
        Presence.stream.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => void changes.push(event.clients.map((client) => client.id))),
          ),
        ),
        EditorAccess.Connection,
        {
          actor: { type: "CLIENT", kind: "browser", id: "tab", userId: "user-2" },
          displayName: "observer",
          email: null,
          projectId: "local",
          canEdit: true,
          canManageCredentials: false,
        },
      ).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      assert.include(changes.at(-1) ?? [], "mcp:session-1");

      yield* TestClock.adjust("91 seconds");
      assert.isUndefined(yield* entry(mcp));
      assert.isUndefined(yield* entry(rest));
      assert.deepStrictEqual(changes.at(-1), ["tab"]);
    }).pipe(Effect.provide(EditorLayer), Effect.scoped),
  );

  it.effect("drops a revoked key's callers immediately", () =>
    Effect.gen(function* () {
      const operations = yield* ProjectEditor.make;
      const presence = yield* Presence.Registry;
      yield* operations.listGraphs(rest);
      yield* operations.listGraphs(mcp);
      assert.lengthOf(yield* presence.snapshot("local"), 2);
      yield* presence.apiKeyRevoked("other-key");
      assert.lengthOf(yield* presence.snapshot("local"), 2);
      yield* presence.apiKeyRevoked(restKey.id);
      assert.deepStrictEqual(yield* presence.snapshot("local"), []);
    }).pipe(Effect.provide(EditorLayer)),
  );
});
