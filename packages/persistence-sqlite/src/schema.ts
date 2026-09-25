import type { ResourceConstant, OutputRef, IoId, Queue } from "@macrograph/core";
import type { DataType } from "@macrograph/module/DataType";
import type { Schema } from "effect";

import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectMeta = sqliteTable("project_meta", {
  types: text("types", { mode: "json" }).notNull().$type<DataType.Definitions>().default({}),
  name: text("name").notNull(),
  engines: text("engines", { mode: "json" })
    .notNull()
    .$type<Record<string, Schema.Json>>()
    .default({}),
  constants: text("constants", { mode: "json" })
    .notNull()
    .$type<Record<string, ResourceConstant.Model>>()
    .default({}),
  queues: text("queues", { mode: "json" })
    .notNull()
    .$type<Record<string, Queue.Model>>()
    .default({}),
});

export const canvases = sqliteTable("canvases", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const graphs = sqliteTable("graphs", {
  canvasId: text("canvas_id")
    .primaryKey()
    .references(() => canvases.id, { onDelete: "cascade" }),
});

export const functions = sqliteTable("functions", {
  canvasId: text("canvas_id")
    .primaryKey()
    .references(() => canvases.id, { onDelete: "cascade" }),
  arguments: text("arguments", { mode: "json" })
    .notNull()
    .$type<
      ReadonlyArray<{ readonly id: string; readonly name: string; readonly type: DataType.Any }>
    >(),
  returns: text("returns", { mode: "json" })
    .notNull()
    .$type<
      ReadonlyArray<{ readonly id: string; readonly name: string; readonly type: DataType.Any }>
    >(),
  inputPosition: text("input_position", { mode: "json" })
    .notNull()
    .$type<{ readonly x: number; readonly y: number }>(),
  outputPosition: text("output_position", { mode: "json" })
    .notNull()
    .$type<{ readonly x: number; readonly y: number }>(),
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
  splitScopeOutputs: text("split_scope_outputs", { mode: "json" }).$type<ReadonlyArray<IoId>>(),
  schemaPackage: text("schema_package").notNull(),
  schemaSchema: text("schema_schema").notNull(),
  positionX: real("position_x").notNull(),
  positionY: real("position_y").notNull(),
  canvasId: text("canvas_id").notNull(),
});

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  outNodeId: text("out_node_id").notNull(),
  outIo: text("out_io", { mode: "json" }).notNull().$type<OutputRef.Model>(),
  inNodeId: text("in_node_id").notNull(),
  inIoId: text("in_io_id").notNull(),
  canvasId: text("canvas_id").notNull(),
});
