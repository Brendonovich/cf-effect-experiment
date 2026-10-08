import { Actor } from "@macrograph/core";
import { EditorAccess, Presence } from "@macrograph/editor";
import { Context } from "effect";

export interface ApiKeyRef {
  readonly id: string;
  readonly name: string;
}

export interface McpClientInfo {
  readonly name: string;
  readonly version: string;
}

/**
 * Identifies the REST or MCP client acting for the current user.
 *
 * `id` names the specific API key or MCP session. Without one, every API call by a user is
 * attributed to a single per-user API actor.
 */
export interface Caller {
  readonly kind: "api" | "mcp";
  readonly id: string | null;
  /** The authenticated user's email, when the authenticator knows it. */
  readonly email: string | null;
  readonly apiKey: ApiKeyRef | null;
  readonly mcpSessionId: string | null;
  /** The `clientInfo` an MCP client sent when it initialized its session. */
  readonly mcpClient: McpClientInfo | null;
}

export const anonymous: Caller = {
  kind: "api",
  id: null,
  email: null,
  apiKey: null,
  mcpSessionId: null,
  mcpClient: null,
};

export const Current = Context.Reference<Caller>("macrograph/ApiCaller", {
  defaultValue: () => anonymous,
});

/** A REST caller authenticated by an API key. */
export const forApiKey = (apiKey: ApiKeyRef, email: string | null): Caller => ({
  ...anonymous,
  id: apiKey.id,
  email,
  apiKey,
});

/** Narrows a caller to an MCP session, which is a more specific client than its API key. */
export const forMcp = (
  caller: Caller,
  sessionId: string | null,
  client: McpClientInfo | null,
): Caller => ({
  ...caller,
  kind: "mcp",
  id: sessionId ?? caller.id,
  mcpSessionId: sessionId,
  mcpClient: client,
});

/** The editor actor for an API caller. Prefixed IDs cannot collide with browser connection IDs. */
export const actorFor = (caller: Caller, userId: string): Actor.Client =>
  Actor.client(caller.kind, `${caller.kind}:${caller.id ?? `user:${userId}`}`, userId);

export const remoteClient = (caller: Caller): EditorAccess.RemoteClient => ({
  apiKeyId: caller.apiKey?.id ?? null,
  apiKeyName: caller.apiKey?.name ?? null,
  mcpSessionId: caller.mcpSessionId,
  mcpClientName: caller.mcpClient?.name ?? null,
  mcpClientVersion: caller.mcpClient?.version ?? null,
});

/** The editor connection identity for an API caller, as used for presence and attribution. */
export const identityFor = (
  caller: Caller,
  access: {
    readonly userId: string;
    readonly projectId: string;
    readonly canEdit: boolean;
    readonly canManageCredentials: boolean;
  },
): EditorAccess.ConnectionIdentity => ({
  actor: actorFor(caller, access.userId),
  // Without an email, use the same per-project name as the user's browser tabs.
  displayName:
    caller.email === null
      ? Presence.fallbackName(`${access.projectId}\0${access.userId}`)
      : Presence.nameFromEmail(caller.email),
  email: caller.email,
  projectId: access.projectId,
  canEdit: access.canEdit,
  canManageCredentials: access.canManageCredentials,
  remote: remoteClient(caller),
});

export * as ApiCaller from "./ApiCaller.ts";
