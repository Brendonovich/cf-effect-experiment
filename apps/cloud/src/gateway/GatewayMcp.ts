import { CurrentUser } from "@macrograph/cloud-api";
import { Catalog, type Tool } from "@macrograph/gateway";
import { ApiCaller, McpServer, type ProjectMcp } from "@macrograph/project-api";
import { Effect, Layer } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiError } from "effect/http-api";

import * as McpOAuthConfig from "../auth/McpOAuthConfig.ts";
import { Gateway } from "./Gateway.ts";

export const path = McpOAuthConfig.gateway.path;

/** How long a call holds its request open for the user to approve it. */
const defaultApprovalWaitMs = 25_000;

export const listAccountsTool = "gateway_list_accounts";
export const awaitApprovalTool = "gateway_await_approval";

const instructions =
  "Calls the user's connected accounts (such as Twitch and GitHub) as them. Each tool runs as one connected account: pass `account` when several of a provider are connected (see gateway_list_accounts). The user decides per tool whether calls run immediately or wait for their approval. A call that needs approval returns an approvalId and a link for the user; once they decide, gateway_await_approval returns the outcome. Approved calls run with exactly the arguments you sent.";

export const approvalUrl = (id: string) =>
  `${new URL(McpOAuthConfig.issuer()).origin}/account/gateway?approval=${encodeURIComponent(id)}`;

const callerLabel = (caller: ApiCaller.Caller) =>
  caller.mcpClient !== null
    ? caller.mcpClient.name
    : caller.apiKey !== null
      ? `API key "${caller.apiKey.name}"`
      : null;

const describeAccount = (account: Gateway.Account) =>
  account.displayName === null ? account.id : `${account.displayName} (${account.id})`;

export const descriptor = (
  tool: Tool,
  accounts: ReadonlyArray<Gateway.Account>,
  policy: Gateway.ToolState["policy"],
): McpServer.ToolDescriptor => {
  const provider = Catalog.provider(tool.provider)?.displayName ?? tool.provider;
  return {
    name: tool.name,
    title: `${provider}: ${tool.title}`,
    description: `${tool.description}${policy === "approve" ? " Waits for the user's approval before running." : ""}`,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        account: {
          type: "string",
          description: `${provider} account to act as, by ID or name. Optional when only one is connected. Connected: ${accounts.map(describeAccount).join(", ")}.`,
          ...(accounts.length > 1 ? {} : { default: accounts[0]?.id }),
        },
        ...tool.inputSchema.properties,
      },
      required:
        accounts.length > 1 ? ["account", ...tool.inputSchema.required] : tool.inputSchema.required,
    },
    annotations: {
      title: `${provider}: ${tool.title}`,
      readOnlyHint: tool.readOnly,
      destructiveHint: tool.method === "DELETE",
      openWorldHint: true,
    },
  };
};

const metaTools: ReadonlyArray<McpServer.ToolDescriptor> = [
  {
    name: listAccountsTool,
    description: "List the user's connected accounts that gateway tools can act as.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: awaitApprovalTool,
    description:
      "Wait for the user to approve or deny a call that needed approval, then return its outcome. Waits up to about 25 seconds; call again while it is still pending.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: { type: "string", description: "The approvalId a call returned." },
      },
      required: ["approvalId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

/** Answers the agent with what became of an approval. */
export const approvalResult = (approval: Gateway.Approval): McpServer.CallToolResult => {
  switch (approval.status) {
    case "succeeded":
      return McpServer.jsonResult(
        approval.result ?? { status: 0, body: null },
        (approval.result?.status ?? 0) >= 400,
      );
    case "failed":
      return McpServer.textResult(approval.error ?? "The call failed", true);
    case "denied":
      return McpServer.textResult("The user denied this call.", true);
    case "expired":
      return McpServer.textResult("The user did not approve this call in time.", true);
    case "pending":
    case "running":
      return McpServer.jsonResult({
        status: "pending_approval",
        approvalId: approval.id,
        approveUrl: approvalUrl(approval.id),
        message: `This call is waiting for the user's approval. Ask them to review it at ${approvalUrl(approval.id)}, then call ${awaitApprovalTool} with this approvalId.`,
      });
  }
};

export const layer = (options: { readonly approvalWaitMs?: number } = {}) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const approvalWaitMs = options.approvalWaitMs ?? defaultApprovalWaitMs;
      const gateway = yield* Gateway.Service;
      return McpServer.layer({
        name: McpOAuthConfig.gateway.name,
        path,
        instructions,
        listTools: Effect.gen(function* () {
          const user = yield* CurrentUser;
          if (!gateway.allows(user.id)) return [];
          const accounts = yield* gateway.accounts(user.id);
          const states = yield* gateway.tools(user.id);
          return [
            ...metaTools,
            ...states.flatMap(({ tool, policy }) => {
              const connected = accounts.filter((account) => account.provider === tool.provider);
              return connected.length === 0 ? [] : [descriptor(tool, connected, policy)];
            }),
          ];
        }),
        callTool: (name, args) =>
          Effect.gen(function* () {
            const user = yield* CurrentUser;
            if (!gateway.allows(user.id))
              return McpServer.textResult("The gateway isn't enabled for this account.", true);
            if (name === listAccountsTool)
              return McpServer.jsonResult({ accounts: yield* gateway.accounts(user.id) });
            if (name === awaitApprovalTool) {
              if (typeof args.approvalId !== "string")
                return McpServer.textResult("approvalId must be a string", true);
              const approval = yield* gateway.await(user.id, args.approvalId, approvalWaitMs);
              return approval === undefined
                ? McpServer.textResult("No approval with that ID", true)
                : approvalResult(approval);
            }
            const tool = Catalog.tool(name);
            if (tool === undefined) return new McpServer.UnknownTool();
            const { account, ...rest } = args;
            if (account !== undefined && typeof account !== "string")
              return McpServer.textResult("account must be a string", true);
            const outcome = yield* gateway.call({
              userId: user.id,
              tool,
              account,
              arguments: rest,
              caller: callerLabel(yield* ApiCaller.Current),
            });
            switch (outcome._tag) {
              case "Completed":
                return McpServer.jsonResult(outcome.response, outcome.response.status >= 400);
              case "Failed":
                return McpServer.textResult(outcome.message, true);
              case "Approval": {
                const decided = yield* gateway.await(user.id, outcome.approval.id, approvalWaitMs);
                return approvalResult(decided ?? outcome.approval);
              }
            }
          }),
      });
    }),
  );

/** Runs the gateway as the bearer's user, pointing unauthenticated clients at its OAuth metadata. */
export const authenticated = <A, E, R>(
  app: Effect.Effect<A, E, R>,
  authenticate: Effect.Effect<
    ProjectMcp.Principal,
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
      Effect.succeed(
        HttpServerResponse.empty({
          status: 401,
          headers: {
            "www-authenticate": `Bearer realm="mcp", resource_metadata="${McpOAuthConfig.protectedResourceMetadataUrl(McpOAuthConfig.gateway)}", scope="${McpOAuthConfig.scope}"`,
          },
        }),
      ),
    ),
  );

export * as GatewayMcp from "./GatewayMcp.ts";
