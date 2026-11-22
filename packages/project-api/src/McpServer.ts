import { CurrentUser } from "@macrograph/cloud-api";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { ApiCaller } from "./ApiCaller.ts";

/** A tool as listed by `tools/list`. */
export interface ToolDescriptor {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly outputSchema?: unknown;
  readonly annotations?: {
    readonly title?: string;
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
}

/** The result of `tools/call`; failures the agent should see are results with `isError`. */
export interface CallToolResult {
  readonly isError: boolean;
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly structuredContent?: unknown;
}

export class UnknownTool {
  readonly _tag = "UnknownTool";
}

/** A tool result carrying a JSON value as both structured and text content. */
export const jsonResult = (value: unknown, isError = false): CallToolResult => ({
  isError,
  ...(typeof value === "object" && value !== null && !Array.isArray(value)
    ? { structuredContent: value }
    : {}),
  content: [{ type: "text", text: JSON.stringify(value) }],
});

export const textResult = (text: string, isError = false): CallToolResult => ({
  isError,
  content: [{ type: "text", text }],
});

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
 * Serves tools over MCP's streamable HTTP transport without server-side session state, so requests
 * can be handled by any instance, such as stateless Cloudflare Workers. Tools are listed and
 * called as the authenticated user, with `ApiCaller.Current` narrowed to the MCP session.
 */
export const layer = <RList, RCall>(options: {
  readonly name: string;
  readonly path: `/${string}`;
  readonly instructions?: string;
  readonly listTools: Effect.Effect<ReadonlyArray<ToolDescriptor>, never, RList>;
  readonly callTool: (
    name: string,
    args: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<CallToolResult | UnknownTool, never, RCall>;
}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;

      const withCaller = <A, E, R>(effect: Effect.Effect<A, E, R>, session: McpSession | null) =>
        Effect.gen(function* () {
          const user = yield* Effect.serviceOption(CurrentUser);
          if (Option.isNone(user))
            return yield* Effect.die("MCP request is missing its authenticated user");
          const caller = ApiCaller.forMcp(
            yield* ApiCaller.Current,
            session?.id ?? null,
            session?.client ?? null,
          );
          return yield* effect.pipe(
            Effect.provideService(CurrentUser, user.value),
            Effect.provideService(ApiCaller.Current, caller),
          );
        });

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
                ...(options.instructions === undefined
                  ? {}
                  : { instructions: options.instructions }),
              });
            }
            case "ping":
              return rpcResult(id, {});
            case "tools/list":
              return rpcResult(id, { tools: yield* withCaller(options.listTools, session) });
            case "tools/call": {
              const params = message.params;
              if (!isRecord(params) || typeof params.name !== "string")
                return rpcError(id, -32602, "Invalid tools/call params");
              const args = isRecord(params.arguments) ? params.arguments : {};
              const result = yield* withCaller(options.callTool(params.name, args), session);
              return result instanceof UnknownTool
                ? rpcError(id, -32602, `Unknown tool: ${params.name}`)
                : rpcResult(id, result);
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
  );

export * as McpServer from "./McpServer.ts";
