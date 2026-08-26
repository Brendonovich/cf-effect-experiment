import { assert, describe, it } from "@effect/vitest";
import { CurrentUser } from "@macrograph/cloud-api";
import { Context, Effect, Option, Ref } from "effect";
import { Tool } from "effect/unstable/ai";
import {
  HttpEffect,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiError } from "effect/unstable/httpapi";

import * as CloudMcp from "../src/api/CloudMcp.ts";

const { toolkit } = CloudMcp;

describe("Cloud MCP toolkit", () => {
  it("exposes the authenticated project and graph editing capabilities", () => {
    assert.deepStrictEqual(Object.keys(toolkit.tools), [
      "listProjects",
      "getProject",
      "createProject",
      "listGraphs",
      "getGraph",
      "createGraph",
      "deleteGraph",
      "searchSchemas",
      "listResources",
      "createNode",
      "createConnection",
    ]);
  });

  it("prominently exposes compound graph creation with inline nodes and connections", () => {
    const tool = toolkit.tools.createGraph;
    const schema = Tool.getJsonSchema(tool);

    assert.include(Tool.getDescription(tool), "PREFERRED");
    assert.include(Tool.getDescription(tool), "nodes, and connections");
    assert.containsAllKeys(schema.properties, ["projectId", "name", "nodes", "connections"]);
    assert.include(schema.required, "projectId");
  });

  it("marks read-only and destructive tools appropriately", () => {
    assert.isTrue(Context.get(toolkit.tools.listProjects.annotations, Tool.Readonly));
    assert.isTrue(Context.get(toolkit.tools.searchSchemas.annotations, Tool.Readonly));
    assert.isTrue(Context.get(toolkit.tools.listResources.annotations, Tool.Readonly));
    assert.isTrue(Context.get(toolkit.tools.deleteGraph.annotations, Tool.Destructive));
  });

  it("exposes bounded multi-query schema discovery with required project context", () => {
    const schema = Tool.getJsonSchema(toolkit.tools.searchSchemas);

    assert.strictEqual(schema.type, "object");
    assert.containsAllKeys(schema.properties, ["projectId", "query", "queries", "limit"]);
    assert.include(schema.required, "projectId");
    assert.notInclude(schema.required, "query");
    assert.notInclude(schema.required, "queries");
    assert.notInclude(schema.required, "limit");
    assert.include(
      Tool.getDescription(toolkit.tools.searchSchemas),
      "matching configured resource",
    );
  });

  it("flattens graph and node identifiers into mutation parameters", () => {
    const node = Tool.getJsonSchema(toolkit.tools.createNode);
    const connection = Tool.getJsonSchema(toolkit.tools.createConnection);

    assert.containsAllKeys(node.properties, ["projectId", "graphId", "schema"]);
    assert.containsAllKeys(connection.properties, [
      "projectId",
      "graphId",
      "outNodeId",
      "outIoId",
      "inNodeId",
      "inIoId",
    ]);
  });

  it.effect("authenticates initialize, tool discovery, and request-scoped tool execution", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handlers = toolkit.of({
          listProjects: () =>
            Effect.map(CurrentUser, (user) => ({
              projects: [
                {
                  id: "project-1",
                  teamId: "team-1",
                  createdBy: user.id,
                  access: "team" as const,
                  name: user.id,
                  currentDeploymentId: null,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                },
              ],
            })),
          getProject: () => Effect.die("unused"),
          createProject: () => Effect.die("unused"),
          listGraphs: () => Effect.die("unused"),
          getGraph: () => Effect.die("unused"),
          createGraph: () => Effect.die("unused"),
          deleteGraph: () => Effect.die("unused"),
          searchSchemas: () => Effect.die("unused"),
          listResources: () => Effect.die("unused"),
          createNode: () => Effect.die("unused"),
          createConnection: () => Effect.die("unused"),
        });
        const app = yield* CloudMcp.layer(handlers).pipe(HttpRouter.toHttpEffect);
        const authenticate = Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const authorization = request.headers.authorization;
          if (authorization !== "Bearer alice" && authorization !== "Bearer bob")
            return yield* new HttpApiError.Unauthorized();
          return { id: authorization.slice("Bearer ".length), sessionId: undefined };
        });
        const send = (body: object, authorization?: string, sessionId?: string) =>
          Effect.gen(function* () {
            const response = yield* Ref.make(Option.none<HttpServerResponse.HttpServerResponse>());
            yield* HttpEffect.toHandled(CloudMcp.authenticated(app, authenticate), (_, value) =>
              Ref.set(response, Option.some(value)),
            ).pipe(
              Effect.provideService(
                HttpServerRequest.HttpServerRequest,
                HttpServerRequest.fromWeb(
                  new Request("http://localhost/api/mcp", {
                    method: "POST",
                    headers: {
                      accept: "application/json, text/event-stream",
                      "content-type": "application/json",
                      ...(authorization === undefined ? {} : { authorization }),
                      ...(sessionId === undefined
                        ? {}
                        : {
                            "mcp-session-id": sessionId,
                            "mcp-protocol-version": "2025-06-18",
                          }),
                    },
                    body: JSON.stringify(body),
                  }),
                ),
              ),
            );
            return Option.getOrThrow(yield* Ref.get(response));
          });
        const initialize = {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
        };

        const rejected = yield* send(initialize);
        assert.strictEqual(rejected.status, 401);
        const invalidKey = yield* send(initialize, "Bearer invalid");
        assert.strictEqual(invalidKey.status, 401);

        const initialized = yield* send(initialize, "Bearer alice");
        assert.strictEqual(initialized.status, 200);
        const sessionId = initialized.headers["mcp-session-id"];
        assert.isString(sessionId);

        const listRequest = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
        const unauthorizedList = yield* send(listRequest, undefined, sessionId);
        assert.strictEqual(unauthorizedList.status, 401);

        const listed = yield* send(listRequest, "Bearer alice", sessionId);
        const listedBody = yield* Effect.promise(() => HttpServerResponse.toWeb(listed).json());
        assert.lengthOf(listedBody.result.tools, 11);
        assert.include(
          listedBody.result.tools.map((tool: { name: string }) => tool.name),
          "createGraph",
        );
        const searchSchemas = listedBody.result.tools.find(
          (tool: { name: string }) => tool.name === "searchSchemas",
        );
        assert.strictEqual(searchSchemas.inputSchema.type, "object");
        assert.strictEqual(searchSchemas.inputSchema.properties.projectId.type, "string");
        assert.strictEqual(searchSchemas.inputSchema.properties.query.type, "string");
        assert.strictEqual(searchSchemas.inputSchema.properties.queries.type, "array");
        assert.strictEqual(searchSchemas.inputSchema.properties.limit.type, "integer");
        assert.include(searchSchemas.inputSchema.required, "projectId");
        assert.notInclude(searchSchemas.inputSchema.required, "query");

        const callRequest = {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "listProjects", arguments: {} },
        };
        const unauthorizedCall = yield* send(callRequest, undefined, sessionId);
        assert.strictEqual(unauthorizedCall.status, 401);

        const called = yield* send(callRequest, "Bearer bob", sessionId);
        const calledBody = yield* Effect.promise(() => HttpServerResponse.toWeb(called).json());
        assert.strictEqual(calledBody.result.isError, false);
        assert.strictEqual(calledBody.result.structuredContent.projects[0].createdBy, "bob");

        const calledAgain = yield* send({ ...callRequest, id: 4 }, "Bearer alice", sessionId);
        const calledAgainBody = yield* Effect.promise(() =>
          HttpServerResponse.toWeb(calledAgain).json(),
        );
        assert.strictEqual(calledAgainBody.result.isError, false);
        assert.strictEqual(calledAgainBody.result.structuredContent.projects[0].createdBy, "alice");
      }),
    ),
  );
});
