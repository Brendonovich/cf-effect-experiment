import { sqliteTable, text, real } from "drizzle-orm/sqlite-core";

export const projectMeta = sqliteTable("project_meta", {
  name: text("name").notNull(),
});

export const graphs = sqliteTable("graphs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  properties: text("properties", { mode: "json" }).notNull().$type<Record<string, any>>(),
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
