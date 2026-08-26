import type { Headers } from "effect/unstable/http";

import { Actor } from "@macrograph/core";
import { Context, Effect, Layer, Schema } from "effect";

export class Forbidden extends Schema.TaggedError<Forbidden>()("EditorForbidden", {
  operation: Schema.String,
}) {}

export interface ConnectionIdentity {
  readonly actor: Actor.Model;
  readonly connectionId: string;
  readonly displayName: string;
  readonly projectId: string;
  readonly canEdit: boolean;
  readonly canManageCredentials: boolean;
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

const fallbackIdentity = (clientId: number, projectId: string): ConnectionIdentity => {
  const connectionId = `local-${clientId}`;
  return {
    actor: { type: "CLIENT", id: connectionId },
    connectionId,
    displayName: `Local ${clientId + 1}`,
    projectId,
    canEdit: true,
    canManageCredentials: true,
  };
};

export const permissivePolicy = (projectId = "local") =>
  Layer.succeed(
    Policy,
    Policy.of({
      resolve: (_headers, clientId) => Effect.succeed(fallbackIdentity(clientId, projectId)),
    }),
  );

export const permissivePolicyLayer = permissivePolicy();

export * as EditorAccess from "./EditorAccess.ts";
