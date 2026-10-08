import { NodeHttpServer } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { IoId, Package, PackageId, Project, SchemaId } from "@macrograph/core";
import { Editor, EditorEvents, Packages, Presence } from "@macrograph/editor";
import { t } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer, PubSub } from "effect";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http";

import type { AtomicFileStore } from "../src/AtomicFileStore.ts";

import { ApiKeys } from "../src/ApiKeys.ts";
import { ClientSessions } from "../src/ClientSessions.ts";
import { ProjectApi } from "../src/ProjectApi.ts";

const memoryStore = (): AtomicFileStore => {
  let stored: string | null = null;
  return {
    read: Effect.sync(() => stored),
    write: (value) => Effect.sync(() => void (stored = value)),
    clear: Effect.sync(() => void (stored = null)),
  };
};

const basePath = "/macrograph";
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

const sessions = ClientSessions.make(memoryStore());
const apiKeys = ApiKeys.make(memoryStore());
const adminIds = new Set(["admin"]);

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

const TestLayer = HttpRouter.serve(
  ProjectApi.layer({
    basePath,
    apiKeys,
    sessions,
    ownerId: Effect.succeed("owner"),
    adminIds,
    projectTimestamps: Effect.succeed({
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }),
  }),
).pipe(Layer.provideMerge(EditorLayer), Layer.provideMerge(NodeHttpServer.layerTest));

const send = (
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: {
    readonly token?: string | undefined;
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
  } = {},
) =>
  Effect.gen(function* () {
    let request = HttpClientRequest.make(method)(`${basePath}${path}`).pipe(
      HttpClientRequest.setHeaders(options.headers ?? {}),
    );
    if (options.token !== undefined)
      request = HttpClientRequest.bearerToken(request, options.token);
    if (options.body !== undefined)
      request = HttpClientRequest.bodyJsonUnsafe(request, options.body);
    const response = yield* HttpClient.execute(request);
    const text = yield* response.text;
    return {
      status: response.status,
      headers: response.headers,
      body: text === "" ? null : JSON.parse(text),
    };
  }).pipe(Effect.orDie);

const mcp = (token: string | undefined, sessionId: string | undefined, body: object) =>
  send("POST", "/api/mcp", {
    token,
    body: { jsonrpc: "2.0", ...body },
    headers: {
      accept: "application/json, text/event-stream",
      ...(sessionId === undefined
        ? {}
        : { "mcp-session-id": sessionId, "mcp-protocol-version": "2025-06-18" }),
    },
  });

const createSession = (userId: string) =>
  sessions.create({ userId, email: `${userId}.person@example.com` });

it.layer(TestLayer)("self-hosted project API", (it) => {
  it.effect("lets only signed-in owners and admins manage API keys", () =>
    Effect.gen(function* () {
      const admin = yield* createSession("admin");
      const reader = yield* createSession("reader");

      assert.strictEqual((yield* send("GET", "/auth/api-keys")).status, 401);
      assert.strictEqual((yield* send("GET", "/auth/api-keys", { token: "bogus" })).status, 401);
      const denied = yield* send("POST", "/auth/api-keys", { token: reader, body: { name: "x" } });
      assert.strictEqual(denied.status, 403);
      assert.strictEqual((yield* send("GET", "/auth/api-keys", { token: reader })).status, 403);

      const invalid = yield* send("POST", "/auth/api-keys", { token: admin, body: { name: " " } });
      assert.strictEqual(invalid.status, 400);

      const created = yield* send("POST", "/auth/api-keys", {
        token: admin,
        body: { name: "  CI key " },
      });
      assert.strictEqual(created.status, 201);
      assert.strictEqual(created.headers["cache-control"], "no-store");
      assert.match(created.body.key, /^mg_[0-9a-f]{64}$/);
      assert.strictEqual(created.body.name, "CI key");
      assert.strictEqual(created.body.userId, "admin");
      assert.strictEqual(created.body.email, "admin.person@example.com");
      assert.isNull(created.body.lastUsedAt);

      const listed = yield* send("GET", "/auth/api-keys", { token: admin });
      const entry = listed.body.keys.find((key: { id: string }) => key.id === created.body.id);
      assert.deepStrictEqual(Object.keys(entry).sort(), [
        "createdAt",
        "email",
        "id",
        "lastUsedAt",
        "name",
        "userId",
      ]);

      const revoked = yield* send("DELETE", `/auth/api-keys/${created.body.id}`, { token: admin });
      assert.strictEqual(revoked.status, 204);
      const missing = yield* send("DELETE", `/auth/api-keys/${created.body.id}`, { token: admin });
      assert.strictEqual(missing.status, 404);
      const readerRevoke = yield* send("DELETE", `/auth/api-keys/anything`, { token: reader });
      assert.strictEqual(readerRevoke.status, 403);
    }),
  );

  it.effect("authenticates REST calls with API keys and attributes edits to the key", () =>
    Effect.gen(function* () {
      yield* (yield* Packages.Service).loadPackage(pkg);
      const events = yield* (yield* EditorEvents.Service).subscribe;
      const owner = yield* createSession("owner");
      const { body: key } = yield* send("POST", "/auth/api-keys", {
        token: owner,
        body: { name: "CI key" },
      });

      assert.strictEqual((yield* send("GET", "/api/projects")).status, 401);
      assert.strictEqual((yield* send("GET", "/api/projects", { token: "mg_bad" })).status, 401);
      // A browser session token is not an API key.
      assert.strictEqual((yield* send("GET", "/api/projects", { token: owner })).status, 401);

      const projects = yield* send("GET", "/api/projects", { token: key.key });
      assert.strictEqual(projects.status, 200);
      assert.deepStrictEqual(projects.body.projects, [
        {
          id: "local",
          teamId: "local",
          createdBy: "owner",
          access: "team",
          name: "New Project",
          currentDeploymentId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ]);
      assert.strictEqual(
        (yield* send("GET", "/api/projects/other/graphs", { token: key.key })).status,
        404,
      );

      const graph = yield* send("POST", "/api/projects/local/graphs", {
        token: key.key,
        body: {
          name: "From CI",
          nodes: {
            a: { schema: { package: "test", schema: "text" }, position: { x: 0, y: 0 } },
            b: { schema: { package: "test", schema: "text" }, position: { x: 200, y: 0 } },
          },
          connections: [
            {
              outNodeId: "a",
              outIo: { _tag: "Port", id: "out" },
              inNodeId: "b",
              inIoId: "in",
            },
          ],
        },
      });
      assert.strictEqual(graph.status, 201);
      assert.strictEqual(graph.body.graph.name, "From CI");
      assert.lengthOf(Object.keys(graph.body.graph.nodes), 2);
      assert.lengthOf(graph.body.graph.connections, 1);

      const created = yield* PubSub.take(events);
      assert.strictEqual(created._tag, "GraphCreated");
      assert.deepStrictEqual(created.actor, {
        type: "CLIENT",
        kind: "api",
        id: `api:${key.id}`,
        userId: "owner",
      });

      const graphId = graph.body.graph.id;
      const node = yield* send("POST", `/api/projects/local/graphs/${graphId}/nodes`, {
        token: key.key,
        body: { schema: { package: "test", schema: "text" }, position: { x: 400, y: 0 } },
      });
      assert.strictEqual(node.status, 201);
      const presence = yield* Presence.Registry;
      const restClient = (yield* presence.snapshot("local")).find(
        (client) => client.id === `api:${key.id}`,
      );
      assert.strictEqual(restClient?.kind, "api");
      assert.strictEqual(restClient?.userId, "owner");
      assert.strictEqual(restClient?.displayName, "owner.person");
      assert.strictEqual(restClient?.activeGraph, graph.body.graph.id);
      assert.deepStrictEqual(restClient?.cursor, { x: 400, y: 0 });
      assert.deepStrictEqual(restClient?.remote, {
        name: "CI key",
        version: null,
        apiKeyName: "CI key",
      });
      assert.isNumber(restClient?.expiresAt);
      const badNode = yield* send("POST", `/api/projects/local/graphs/${graphId}/nodes`, {
        token: key.key,
        body: { schema: { package: "test", schema: "missing" }, position: { x: 0, y: 0 } },
      });
      assert.strictEqual(badNode.status, 400);

      const fetched = yield* send("GET", `/api/projects/local/graphs/${graphId}`, {
        token: key.key,
      });
      assert.lengthOf(Object.keys(fetched.body.graph.nodes), 3);
      const schemas = yield* send("GET", "/api/projects/local/schemas?query=text", {
        token: key.key,
      });
      assert.strictEqual(schemas.body.schemas[0].schema.id, "text");

      const listed = yield* send("GET", "/auth/api-keys", { token: owner });
      const used = listed.body.keys.find((entry: { id: string }) => entry.id === key.id);
      assert.isString(used.lastUsedAt);

      const deleted = yield* send("DELETE", `/api/projects/local/graphs/${graphId}`, {
        token: key.key,
      });
      assert.strictEqual(deleted.status, 200);
      assert.strictEqual(
        (yield* send("GET", `/api/projects/local/graphs/${graphId}`, { token: key.key })).status,
        404,
      );

      yield* send("DELETE", `/auth/api-keys/${key.id}`, { token: owner });
      assert.strictEqual((yield* send("GET", "/api/projects", { token: key.key })).status, 401);
      // Revoking the key removes its caller from presence without waiting for expiry.
      assert.isFalse(
        (yield* presence.snapshot("local")).some((client) => client.id === `api:${key.id}`),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("allows reads but not edits once a key's creator is no longer an admin", () =>
    Effect.gen(function* () {
      const admin = yield* createSession("admin");
      const { body: key } = yield* send("POST", "/auth/api-keys", {
        token: admin,
        body: { name: "Former admin" },
      });
      adminIds.delete("admin");
      try {
        assert.strictEqual(
          (yield* send("GET", "/api/projects/local/graphs", { token: key.key })).status,
          200,
        );
        const denied = yield* send("POST", "/api/projects/local/graphs", {
          token: key.key,
          body: { name: "Denied" },
        });
        assert.strictEqual(denied.status, 403);
        const mcpInit = yield* mcp(key.key, undefined, {
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "Agent", version: "1" },
          },
        });
        const call = yield* mcp(key.key, mcpInit.headers["mcp-session-id"], {
          id: 2,
          method: "tools/call",
          params: { name: "createGraph", arguments: { projectId: "local", name: "Denied" } },
        });
        assert.isTrue(call.body.result.isError);
      } finally {
        adminIds.add("admin");
      }
    }),
  );

  it.effect("serves MCP tools as an MCP caller identified by its session", () =>
    Effect.gen(function* () {
      const events = yield* (yield* EditorEvents.Service).subscribe;
      const owner = yield* createSession("owner");
      const { body: key } = yield* send("POST", "/auth/api-keys", {
        token: owner,
        body: { name: "Desktop" },
      });
      const initialize = {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "Claude Desktop", version: "1.2.3" },
        },
      };

      assert.strictEqual((yield* mcp(undefined, undefined, initialize)).status, 401);
      assert.strictEqual((yield* mcp("mg_bad", undefined, initialize)).status, 401);

      const initialized = yield* mcp(key.key, undefined, initialize);
      assert.strictEqual(initialized.status, 200);
      assert.strictEqual(initialized.body.result.serverInfo.name, "MacroGraph Server");
      const sessionId = initialized.headers["mcp-session-id"];
      assert.isString(sessionId);

      const tools = yield* mcp(key.key, sessionId, { id: 2, method: "tools/list", params: {} });
      assert.deepStrictEqual(
        tools.body.result.tools.map((tool: { name: string }) => tool.name),
        [
          "listProjects",
          "getProject",
          "listGraphs",
          "getGraph",
          "createGraph",
          "deleteGraph",
          "searchSchemas",
          "listResources",
          "createNode",
          "createConnection",
        ],
      );

      const projects = yield* mcp(key.key, sessionId, {
        id: 3,
        method: "tools/call",
        params: { name: "listProjects", arguments: {} },
      });
      assert.isFalse(projects.body.result.isError);
      assert.strictEqual(projects.body.result.structuredContent.projects[0].id, "local");

      const graph = yield* mcp(key.key, sessionId, {
        id: 4,
        method: "tools/call",
        params: { name: "createGraph", arguments: { projectId: "local", name: "From MCP" } },
      });
      assert.isFalse(graph.body.result.isError);
      assert.strictEqual(graph.body.result.structuredContent.graph.name, "From MCP");

      const created = yield* PubSub.take(events);
      assert.strictEqual(created._tag, "GraphCreated");
      assert.deepStrictEqual(created.actor, {
        type: "CLIENT",
        kind: "mcp",
        id: `mcp:${sessionId}`,
        userId: "owner",
      });
      const agent = (yield* (yield* Presence.Registry).snapshot("local")).find(
        (client) => client.id === `mcp:${sessionId}`,
      );
      assert.strictEqual(agent?.kind, "mcp");
      assert.strictEqual(agent?.activeGraph, graph.body.result.structuredContent.graph.id);
      assert.deepStrictEqual(agent?.remote, {
        name: "Claude Desktop",
        version: "1.2.3",
        apiKeyName: "Desktop",
      });

      const unauthorized = yield* mcp(undefined, sessionId, {
        id: 5,
        method: "tools/call",
        params: { name: "listProjects", arguments: {} },
      });
      assert.strictEqual(unauthorized.status, 401);
    }).pipe(Effect.scoped),
  );
});

describe("API keys", () => {
  it.effect("stores only key hashes and throttles last-used writes", () =>
    Effect.gen(function* () {
      const writes: Array<string> = [];
      let time = Date.parse("2026-01-01T00:00:00.000Z");
      const keys = ApiKeys.make(
        {
          read: Effect.sync(() => writes.at(-1) ?? null),
          write: (value) => Effect.sync(() => void writes.push(value)),
          clear: Effect.void,
        },
        () => new Date(time),
      );
      const created = yield* keys.create({ userId: "u", email: "u@example.com" }, "Key");
      assert.notInclude(writes.at(-1), created.key);

      assert.isUndefined(yield* keys.authenticate("mg_wrong"));
      const first = yield* keys.authenticate(created.key);
      assert.strictEqual(first?.lastUsedAt, "2026-01-01T00:00:00.000Z");
      const writesAfterFirstUse = writes.length;
      time += 30_000;
      yield* keys.authenticate(created.key);
      assert.strictEqual(writes.length, writesAfterFirstUse);
      time += 60_000;
      const later = yield* keys.authenticate(created.key);
      assert.strictEqual(later?.lastUsedAt, "2026-01-01T00:01:30.000Z");

      assert.isTrue(yield* keys.revoke(created.id));
      assert.isUndefined(yield* keys.authenticate(created.key));
      assert.isFalse(yield* keys.revoke(created.id));
    }),
  );
});
