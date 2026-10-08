import type { Headers } from "effect/unstable/http";

import { Actor } from "@macrograph/core";
import { Context, Effect, Layer, Schema } from "effect";

export class Forbidden extends Schema.TaggedError<Forbidden>()("EditorForbidden", {
  operation: Schema.String,
}) {}

/** How a REST or MCP client reached the project, such as "CI key" or "Claude Desktop". */
export interface RemoteClient {
  readonly apiKeyId: string | null;
  readonly apiKeyName: string | null;
  readonly mcpSessionId: string | null;
  readonly mcpClientName: string | null;
  readonly mcpClientVersion: string | null;
}

export interface ConnectionIdentity {
  /** The client acting on the project; `actor.id` identifies this connection or session. */
  readonly actor: Actor.Client;
  readonly displayName: string;
  readonly email: string | null;
  readonly projectId: string;
  readonly canEdit: boolean;
  readonly canManageCredentials: boolean;
  /** Present for REST and MCP callers. */
  readonly remote?: RemoteClient;
}

/** Provides the current editor connection's identity, project, and permissions. */
export class Connection extends Context.Service<Connection, ConnectionIdentity>()(
  "macrograph/EditorConnection",
) {}

/** Resolves request headers and client identity into an authorized editor connection. */
export class Policy extends Context.Service<
  Policy,
  {
    readonly resolve: (
      headers: Headers.Headers,
      clientId: number,
    ) => Effect.Effect<ConnectionIdentity, Forbidden>;
  }
>()("macrograph/EditorAccessPolicy") {}

const fallbackIdentity = (clientId: number, projectId: string): ConnectionIdentity => ({
  actor: Actor.client("browser", `local-${clientId}`),
  displayName: `Local ${clientId + 1}`,
  email: null,
  projectId,
  canEdit: true,
  canManageCredentials: true,
});

export const permissivePolicy = (projectId = "local") =>
  Layer.succeed(
    Policy,
    Policy.of({
      resolve: (_headers, clientId) => Effect.succeed(fallbackIdentity(clientId, projectId)),
    }),
  );

export const permissivePolicyLayer = permissivePolicy();

export * as EditorAccess from "./EditorAccess.ts";
