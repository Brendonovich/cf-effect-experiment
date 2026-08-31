import { Effect, Schema } from "effect";

import { Connection } from "./Connection.ts";
import { NodeIO } from "./IO.ts";
import { Node } from "./Node.ts";

export const maxBytes = 1_000_000;
export const maxNodes = 500;
export const maxConnections = 2_000;

export const Fragment = Schema.Struct({
  format: Schema.Literal("macrograph/nodes"),
  version: Schema.Literal(1),
  nodes: Schema.Array(Node.Model),
  connections: Schema.Array(Connection.Model),
  source: Schema.optional(Schema.Struct({ session: Schema.String, graphId: Schema.String })),
  externalConnections: Schema.optional(Schema.Array(Connection.Model)),
  nodeIO: Schema.optional(Schema.Record(Schema.String, NodeIO)),
});
export type Fragment = typeof Fragment.Type;

export class InvalidError extends Schema.TaggedError<InvalidError>()("InvalidClipboardFragment", {
  reason: Schema.String,
}) {}

export const Binding = Schema.Struct({
  nodeId: Schema.String,
  property: Schema.optional(Schema.String),
  target: Schema.String,
});
export type Binding = typeof Binding.Type;
export const RebindRequest = Schema.Struct({
  nodeId: Schema.String,
  property: Schema.optional(Schema.String),
  label: Schema.String,
  kind: Schema.Literals(["resource", "schema"]),
  candidates: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
export type RebindRequest = typeof RebindRequest.Type;
export class RebindRequired extends Schema.TaggedError<RebindRequired>()(
  "ClipboardRebindRequired",
  {
    requests: Schema.Array(RebindRequest),
  },
) {}

export const validPosition = (position: { readonly x: number; readonly y: number }) =>
  Number.isFinite(position.x) &&
  Number.isFinite(position.y) &&
  Math.abs(position.x) <= 10_000_000 &&
  Math.abs(position.y) <= 10_000_000;

/** Decode before touching any editor state; reject dangerous keys even inside JSON values. */
export const decode = (text: string) =>
  Effect.try({
    try: () => {
      if (
        text.length > maxBytes ||
        encodeURIComponent(text).replace(/%[0-9A-F]{2}|./g, "x").length > maxBytes
      )
        throw new Error("Clipboard exceeds the 1 MB limit");
      const raw: unknown = JSON.parse(text);
      const pending: Array<{ value: unknown; depth: number }> = [{ value: raw, depth: 0 }];
      while (pending.length > 0) {
        const { value, depth } = pending.pop()!;
        if (depth > 32) throw new Error("Clipboard nesting exceeds the limit");
        if (typeof value === "number" && !Number.isFinite(value))
          throw new Error("Non-finite number");
        if (value !== null && typeof value === "object") {
          for (const [key, child] of Object.entries(value)) {
            if (["__proto__", "constructor", "prototype"].includes(key))
              throw new Error("Unsafe clipboard key");
            pending.push({ value: child, depth: depth + 1 });
          }
        }
      }
      const fragment = Schema.decodeUnknownSync(Fragment)(raw, { onExcessProperty: "error" });
      if (
        fragment.nodes.length === 0 ||
        fragment.nodes.length > maxNodes ||
        fragment.connections.length + (fragment.externalConnections?.length ?? 0) > maxConnections
      )
        throw new Error("Clipboard must contain 1-500 nodes and at most 2000 connections");
      const ids = new Set<string>();
      for (const node of fragment.nodes) {
        if (
          !node.id ||
          ["__proto__", "constructor", "prototype"].includes(node.id) ||
          ids.has(node.id)
        )
          throw new Error("Invalid or duplicate node id");
        ids.add(node.id);
        if (!validPosition(node.position)) throw new Error("Invalid node position");
      }
      const connections = new Set<string>();
      const inputs = new Set<string>();
      for (const connection of fragment.connections) {
        const input = JSON.stringify([connection.inNodeId, connection.inIoId]);
        if (!connection.id || connections.has(connection.id) || inputs.has(input))
          throw new Error("Duplicate connection or multiply connected input");
        if (!ids.has(connection.inNodeId) || !ids.has(connection.outNodeId))
          throw new Error("Connection endpoint is outside the fragment");
        connections.add(connection.id);
        inputs.add(input);
      }
      for (const connection of fragment.externalConnections ?? []) {
        if (ids.has(connection.inNodeId) === ids.has(connection.outNodeId))
          throw new Error("External connection must have exactly one fragment endpoint");
        if (connections.has(connection.id)) throw new Error("Duplicate connection id");
        connections.add(connection.id);
      }
      return fragment;
    },
    catch: (error) =>
      new InvalidError({ reason: error instanceof Error ? error.message : "Invalid clipboard" }),
  });

export * as Clipboard from "./Clipboard.ts";
