import type { Graph, ResourceConstant } from "@macrograph/core";
import type { Schema } from "effect";

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectMeta = sqliteTable("project_meta", {
  name: text("name").notNull(),
  engines: text("engines", { mode: "json" })
    .notNull()
    .$type<Record<string, Schema.Json>>()
    .default({}),
  constants: text("constants", { mode: "json" })
    .notNull()
    .$type<Record<string, ResourceConstant.Model>>()
    .default({}),
});

export const graphs = sqliteTable("graphs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().$type<"ordinary" | "function">().default("ordinary"),
  signature: text("signature", { mode: "json" }).$type<Graph.FunctionSignature>(),
});

export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  properties: text("properties", { mode: "json" }).notNull().$type<Record<string, Schema.Json>>(),
  inputDefaults: text("input_defaults", { mode: "json" })
    .notNull()
    .$type<Record<string, Schema.Json>>()
    .default({}),
  foldPins: integer("fold_pins", { mode: "boolean" }).notNull().default(false),
  schemaPackage: text("schema_package").notNull(),
  schemaSchema: text("schema_schema").notNull(),
  positionX: real("position_x").notNull(),
  positionY: real("position_y").notNull(),
  graphId: text("graph_id").notNull(),
});

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  outNodeId: text("out_node_id").notNull(),
  outIoId: text("out_io_id").notNull(),
  inNodeId: text("in_node_id").notNull(),
  inIoId: text("in_io_id").notNull(),
  graphId: text("graph_id").notNull(),
});
