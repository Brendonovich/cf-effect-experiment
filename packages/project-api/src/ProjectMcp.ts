import {
  CreateConnectionResponse,
  CreateGraphRequest,
  CreateGraphResponse,
  CurrentUser,
  ProjectRecord,
} from "@macrograph/cloud-api";
import {
  Canvas,
  Connection,
  GraphId,
  Node,
  NodeIO,
  Package,
  PackageId,
  ResourceConstant,
} from "@macrograph/core";
import { Cause, Context, Effect, Layer, Option, Schema, Sink, Stream } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiError } from "effect/unstable/httpapi";

import { ApiCaller } from "./ApiCaller.ts";

export const projectParameters = {
  projectId: Schema.String.annotate({
    description: "Accessible project ID returned by listProjects.",
  }),
};
const graphParameters = {
  ...projectParameters,
  graphId: Schema.String.annotate({
    description: "Graph ID returned by listGraphs or createGraph.",
  }),
};

export const listProjects = Tool.make("listProjects", {
  description: "List all projects accessible to the authenticated user.",
  success: Schema.Struct({ projects: Schema.Array(ProjectRecord) }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const getProject = Tool.make("getProject", {
  description: "Get an accessible project's metadata by project ID.",
  parameters: Schema.Struct(projectParameters),
  success: Schema.Struct({ project: ProjectRecord }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const listGraphs = Tool.make("listGraphs", {
  description: "List graph IDs and names in an accessible project.",
  parameters: Schema.Struct(projectParameters),
  success: Schema.Struct({
    graphs: Schema.Array(Schema.Struct({ id: GraphId, name: Schema.String })),
  }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const getGraph = Tool.make("getGraph", {
  description:
    "Inspect a graph, including all nodes, connections, and node inputs and outputs. Wildcard port types show the types inferred from the graph's connections; wildcards that are not yet constrained remain wildcards.",
  parameters: Schema.Struct(graphParameters),
  success: Schema.Struct({ graph: Canvas.Model, nodeIO: Schema.Record(Schema.String, NodeIO) }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const createGraph = Tool.make("createGraph", {
  description:
    "PREFERRED: Create an entire graph in one request, including its name, nodes, and connections. Nodes are keyed by temporary local IDs, and connections reference those IDs. The response maps each temporary ID to its created node ID in nodeIds, and includes each created node's inputs and outputs in nodeIO. Ports that depend on node properties, such as Format String placeholders, are listed there and can be connected with createConnection in the same script. Node schemas use { package, schema }; resource properties use matching resource IDs returned by searchSchemas. Use searchSchemas only if schema IDs, ports, or resources are unknown. Prefer this compound tool over separate createNode/createConnection calls.",
  parameters: Schema.Struct({ ...projectParameters, ...CreateGraphRequest.fields }),
  success: CreateGraphResponse,
  failure: Schema.Unknown,
}).addDependency(CurrentUser);

export const deleteGraph = Tool.make("deleteGraph", {
  description: "Permanently delete a graph and all of its nodes and connections.",
  parameters: Schema.Struct(graphParameters),
  success: Schema.Struct({ deleted: Schema.Boolean }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Destructive, true);

export const searchSchemas = Tool.make("searchSchemas", {
  description:
    "Find ranked node schemas by package, name, ID, or description. Use queries to find multiple unrelated node types in one request. Results include ports, properties, and matching configured resource IDs for resource-backed properties. Returns at most 20 schemas by default and up to 100 with limit.",
  parameters: Schema.Struct({
    ...projectParameters,
    query: Schema.optionalKey(
      Schema.String.annotate({
        description: "Search phrase; all words must match the same package or schema.",
      }),
    ),
    queries: Schema.optionalKey(
      Schema.Array(Schema.String).annotate({
        description:
          "Alternative search phrases. Schemas matching any phrase are returned, allowing multiple node types to be discovered in one call.",
      }),
    ),
    limit: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).annotate({
        description: "Maximum number of ranked schemas to return, from 1 to 100; defaults to 20.",
        default: 20,
      }),
    ),
  }),
  success: Schema.Struct({
    schemas: Schema.Array(
      Schema.Struct({
        package: PackageId,
        schema: Package.SchemaModel,
        resources: Schema.Record(
          Schema.String,
          Schema.Array(Schema.Struct({ id: ResourceConstant.Id, name: Schema.String })),
        ).annotate({
          description:
            "Matching configured resources keyed by resource-backed property ID. Use a resource ID as that node property's value; an empty array means none are configured.",
        }),
      }),
    ),
  }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const listResources = Tool.make("listResources", {
  description:
    "List configured resource constants and their IDs. Use these IDs for matching resource-typed node properties when creating graphs or nodes.",
  parameters: Schema.Struct(projectParameters),
  success: Schema.Struct({ resources: Schema.Array(ResourceConstant.Model) }),
  failure: Schema.Unknown,
})
  .addDependency(CurrentUser)
  .annotate(Tool.Readonly, true);

export const createNode = Tool.make("createNode", {
  description:
    "Add one node to an existing graph and return its inputs and outputs, including ports that depend on its properties. Prefer createGraph when building a complete graph.",
  parameters: Schema.Struct({ ...graphParameters, ...Node.CreateInput.fields }),
  success: Schema.Struct({ node: Node.Model, io: NodeIO }),
  failure: Schema.Unknown,
}).addDependency(CurrentUser);

export const createConnection = Tool.make("createConnection", {
  description:
    "Connect an output pin to an input pin in an existing graph. Returns nodeIO for the connected nodes and every other node whose inferred wildcard types changed. Prefer createGraph for complete graphs.",
  parameters: Schema.Struct({ ...graphParameters, ...Connection.CreateInput.fields }),
  success: CreateConnectionResponse,
  failure: Schema.Unknown,
}).addDependency(CurrentUser);

/** Tools for reading and editing graphs, served by every MacroGraph host. */
export const editorTools = [
  listGraphs,
  getGraph,
  createGraph,
  deleteGraph,
  searchSchemas,
  listResources,
  createNode,
  createConnection,
] as const;

/** The tool set of hosts with a fixed set of projects, such as self-hosted servers. */
export const toolkit = Toolkit.make(listProjects, getProject, ...editorTools);

const supportedProtocolVersions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const defaultProtocolVersion = "2025-06-18";

interface McpSession {
  readonly id: string;
  readonly client: ApiCaller.McpClientInfo | null;
}

const base64UrlEncode = (value: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const base64UrlDecode = (value: string) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
      char.charCodeAt(0),
    ),
  );

/**
 * Session IDs carry the client's `clientInfo` so any host instance can attribute a call without
 * shared session state. They are labels, not credentials: every request is authenticated separately.
 */
const encodeSessionId = (client: ApiCaller.McpClientInfo | null) =>
  `${crypto.randomUUID()}.${base64UrlEncode(JSON.stringify(client))}`;

const decodeSessionId = (sessionId: string): McpSession => {
  const [, encodedClient] = sessionId.split(".", 2);
  try {
    const client: unknown =
      encodedClient === undefined ? null : JSON.parse(base64UrlDecode(encodedClient));
    if (
      typeof client === "object" &&
      client !== null &&
      "name" in client &&
      "version" in client &&
      typeof client.name === "string" &&
      typeof client.version === "string"
    )
      return { id: sessionId, client: { name: client.name, version: client.version } };
  } catch {}
  return { id: sessionId, client: null };
};

const clientInfoFrom = (params: unknown): ApiCaller.McpClientInfo | null => {
  if (typeof params !== "object" || params === null || !("clientInfo" in params)) return null;
  const { clientInfo } = params;
  if (
    typeof clientInfo !== "object" ||
    clientInfo === null ||
    !("name" in clientInfo) ||
    typeof clientInfo.name !== "string"
  )
    return null;
  const version =
    "version" in clientInfo && typeof clientInfo.version === "string" ? clientInfo.version : "";
  return { name: clientInfo.name.slice(0, 200), version: version.slice(0, 100) };
};

type JsonRpcId = string | number | null;

interface JsonRpcMessage {
  readonly id?: JsonRpcId;
  readonly method?: unknown;
  readonly params?: unknown;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: JsonRpcId, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/**
 * Serves a toolkit over MCP's streamable HTTP transport without server-side session state, so
 * requests can be handled by any instance, such as stateless Cloudflare Workers. Tool calls run as
 * the authenticated user and as an `mcp` caller identified by the MCP session, falling back to the
 * API key.
 */
export const layer = <Tools extends Record<string, Tool.Any>>(options: {
  readonly name: string;
  readonly path: `/${string}`;
  readonly toolkit: Toolkit.Toolkit<Tools>;
  readonly handlers: Toolkit.HandlersFrom<Tools>;
}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const built = yield* options.toolkit;
      const tools = Object.values(built.tools).map((tool) => {
        const outputSchema = Tool.getJsonSchemaFromSchema(tool.successSchema);
        return {
          name: tool.name,
          description: Tool.getDescription(tool),
          inputSchema: Tool.getJsonSchema(tool),
          ...(outputSchema.type === "object" ? { outputSchema } : {}),
          annotations: {
            readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
            destructiveHint: Context.get(tool.annotations, Tool.Destructive),
            idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
            openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
          },
        };
      });

      const callTool = (params: unknown, session: McpSession | null) =>
        Effect.gen(function* () {
          if (!isRecord(params) || typeof params.name !== "string")
            return { error: "Invalid tools/call params" } as const;
          const name = params.name;
          if (!Object.hasOwn(built.tools, name)) return { error: `Unknown tool: ${name}` } as const;
          const user = yield* Effect.serviceOption(CurrentUser);
          if (Option.isNone(user))
            return yield* Effect.die("MCP tool request is missing its authenticated user");
          const caller = ApiCaller.forMcp(
            yield* ApiCaller.Current,
            session?.id ?? null,
            session?.client ?? null,
          );
          const result = yield* built
            .handle(name as keyof Tools, (params.arguments ?? {}) as never)
            .pipe(
              Stream.unwrap,
              Stream.run(Sink.last()),
              Effect.flatMap(Effect.fromOption),
              Effect.provideService(CurrentUser, user.value),
              Effect.provideService(ApiCaller.Current, caller),
            );
          return {
            result: {
              isError: false,
              ...(typeof result.encodedResult === "object" && result.encodedResult !== null
                ? { structuredContent: result.encodedResult }
                : {}),
              content: [{ type: "text", text: JSON.stringify(result.encodedResult) }],
            },
          } as const;
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.succeed({
              result: { isError: true, content: [{ type: "text", text: Cause.pretty(cause) }] },
            } as const),
          ),
        );

      const handleMessage = (message: JsonRpcMessage, session: McpSession | null) =>
        Effect.gen(function* () {
          const id = message.id ?? null;
          switch (message.method) {
            case "initialize": {
              const requested = isRecord(message.params)
                ? message.params.protocolVersion
                : undefined;
              const protocolVersion =
                typeof requested === "string" && supportedProtocolVersions.includes(requested)
                  ? requested
                  : defaultProtocolVersion;
              return rpcResult(id, {
                protocolVersion,
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: options.name, version: "1.0.0" },
              });
            }
            case "ping":
              return rpcResult(id, {});
            case "tools/list":
              return rpcResult(id, { tools });
            case "tools/call": {
              const outcome = yield* callTool(message.params, session);
              return "error" in outcome
                ? rpcError(id, -32602, outcome.error)
                : rpcResult(id, outcome.result);
            }
            default:
              return rpcError(id, -32601, `Method not found: ${String(message.method)}`);
          }
        });

      yield* router.add("POST", options.path, (request) =>
        Effect.gen(function* () {
          const body = yield* request.json.pipe(Effect.catch(() => Effect.succeed(undefined)));
          const messages = Array.isArray(body) ? body : [body];
          if (messages.length === 0 || !messages.every(isRecord))
            return HttpServerResponse.jsonUnsafe(rpcError(null, -32700, "Parse error"), {
              status: 400,
            });
          const requests = (messages as ReadonlyArray<JsonRpcMessage>).filter(
            (message) => message.id !== undefined && typeof message.method === "string",
          );
          if (requests.length === 0) return HttpServerResponse.empty({ status: 202 });

          const initialize = requests.find((message) => message.method === "initialize");
          const sessionHeader = request.headers["mcp-session-id"];
          const session =
            initialize !== undefined
              ? decodeSessionId(encodeSessionId(clientInfoFrom(initialize.params)))
              : sessionHeader === undefined
                ? null
                : decodeSessionId(sessionHeader);
          const responses = yield* Effect.forEach(requests, (message) =>
            handleMessage(message, session),
          );
          return HttpServerResponse.jsonUnsafe(Array.isArray(body) ? responses : responses[0], {
            headers:
              initialize !== undefined && session !== null ? { "mcp-session-id": session.id } : {},
          });
        }),
      );
      for (const method of ["GET", "DELETE"] as const)
        yield* router.add(method, options.path, () =>
          Effect.succeed(HttpServerResponse.empty({ status: 405, headers: { allow: "POST" } })),
        );
    }),
  ).pipe(Layer.provide(options.toolkit.toLayer(options.handlers)));

/** An API-key-authenticated user and the key they used. */
export interface Principal {
  readonly user: CurrentUser["Service"];
  readonly caller: ApiCaller.Caller;
}

/** Runs an MCP app as the request's authenticated principal, answering 401 when it has none. */
export const authenticated = <A, E, R>(
  app: Effect.Effect<A, E, R>,
  authenticate: Effect.Effect<
    Principal,
    HttpApiError.Unauthorized,
    HttpServerRequest.HttpServerRequest
  >,
) =>
  authenticate.pipe(
    Effect.flatMap(({ user, caller }) =>
      app.pipe(
        Effect.provideService(CurrentUser, user),
        Effect.provideService(ApiCaller.Current, caller),
      ),
    ),
    Effect.catchTag("Unauthorized", () =>
      Effect.succeed(HttpServerResponse.empty({ status: 401 })),
    ),
  );

export * as ProjectMcp from "./ProjectMcp.ts";
