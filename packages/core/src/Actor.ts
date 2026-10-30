import { Schema } from "effect";

/** How a client reaches the project: an editor tab, a REST caller, or an MCP session. */
export const ClientKind = Schema.Literals(["browser", "api", "mcp"]);
export type ClientKind = typeof ClientKind.Type;

/**
 * A single editor tab, API caller, or MCP session acting on a project.
 *
 * `id` identifies this specific client and decides echo suppression. `userId` links the clients
 * that belong to the same person, so one user's tabs and agents can be grouped together.
 */
export const Client = Schema.Struct({
  type: Schema.Literal("CLIENT"),
  kind: ClientKind,
  id: Schema.String,
  userId: Schema.NullOr(Schema.String),
});
export type Client = typeof Client.Type;

export const System = Schema.Struct({ type: Schema.Literal("SYSTEM") });
export type System = typeof System.Type;

export const Model = Schema.Union([Client, System]);
export type Model = typeof Model.Type;

export const system: Model = { type: "SYSTEM" };

export const client = (kind: ClientKind, id: string, userId: string | null = null): Client => ({
  type: "CLIENT",
  kind,
  id,
  userId,
});

export const isClient = (actor: Model): actor is Client => actor.type === "CLIENT";

/** Whether two actors are the same client, regardless of which user they belong to. */
export const isSameClient = (left: Model, right: Model) =>
  left.type === "CLIENT" &&
  right.type === "CLIENT" &&
  left.kind === right.kind &&
  left.id === right.id;
