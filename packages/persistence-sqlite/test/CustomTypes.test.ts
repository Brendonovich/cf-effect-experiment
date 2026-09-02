import { Project } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { DataType } from "@macrograph/plugin/DataType";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import { Effect, Layer, Schema } from "effect";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DrizzleDriver } from "../src/DrizzleDriver.ts";
import { SqlitePersistence } from "../src/SqlitePersistence.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const leafId = DataType.DefinitionId.make("leaf");
const resultId = DataType.DefinitionId.make("result");
const project = Schema.decodeUnknownSync(Project.Model)({
  ...Project.empty(),
  name: "Custom types persistence",
  types: {
    leaf: {
      _tag: "Struct",
      id: leafId,
      name: "Leaf",
      fields: [
        { name: "label", type: DataType.String },
        { name: "children", type: DataType.List(DataType.Custom(leafId)) },
      ],
    },
    result: {
      _tag: "Enum",
      id: resultId,
      name: "Result",
      variants: [
        { name: "Empty", fields: [] },
        { name: "Found", fields: [{ name: "leaf", type: DataType.Custom(leafId) }] },
      ],
    },
  },
  graphs: {
    graph: {
      id: "graph",
      name: "Graph",
      nodes: {
        node: {
          id: "node",
          name: "Preserved node",
          schema: { package: "CustomTypes", schema: '["result","stringify"]' },
          position: { x: 10, y: 20 },
          properties: {},
          foldPins: false,
          inputDefaults: {
            value: {
              _type: "result",
              _tag: "Found",
              leaf: { _type: "leaf", label: "keep", children: [] },
            },
            orphan: "never discard",
          },
        },
      },
      connections: [
        { id: "wire", outNodeId: "node", outIoId: "removed", inNodeId: "node", inIoId: "orphan" },
      ],
    },
  },
});

const run = <A, E>(path: string, effect: Effect.Effect<A, E, Persistence.Service>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        SqlitePersistence.layer.pipe(
          Layer.provide(DrizzleDriver.layerNodeSqlite(path, migrationsFolder)),
        ),
      ),
      Effect.scoped,
    ),
  );

test("SQLite roundtrips recursive tagged types, preserved invalid defaults and wires across reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "macrograph-types-"));
  const path = join(directory, "project.sqlite");
  try {
    await run(
      path,
      Effect.gen(function* () {
        yield* (yield* Persistence.Service).saveProject(project);
      }),
    );
    const loaded = await run(
      path,
      Effect.gen(function* () {
        return yield* (yield* Persistence.Service).loadProject();
      }),
    );
    assert.deepEqual(loaded, project);
    const deleted: Project.Model = { ...loaded, types: { result: loaded.types.result! } };
    await run(
      path,
      Effect.gen(function* () {
        yield* (yield* Persistence.Service).saveProject(deleted);
      }),
    );
    const reopened = await run(
      path,
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        const current = yield* persistence.loadProject();
        yield* persistence.saveGraph(current.graphs.graph!);
        return yield* persistence.loadProject();
      }),
    );
    assert.deepEqual(reopened, deleted);
    assert.equal(reopened.graphs.graph!.nodes.node!.inputDefaults.orphan, "never discard");
    assert.equal(Object.hasOwn(reopened.types, "leaf"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("generated types migration upgrades old projects without changing saved defaults", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const directory of readdirSync(migrationsFolder).sort()) {
      if (directory >= "20260831063306_spicy_jazinda") continue;
      sqlite.exec(readFileSync(join(migrationsFolder, directory, "migration.sql"), "utf8"));
    }
    sqlite.prepare("INSERT INTO project_meta (name) VALUES (?)").run("Old project");
    sqlite.prepare("INSERT INTO graphs (id, name) VALUES (?, ?)").run("old", "Old graph");
    const defaults = JSON.stringify({ value: "existing", nested: { _type: "deleted", keep: 42 } });
    sqlite
      .prepare(
        "INSERT INTO nodes (id, name, properties, input_defaults, schema_package, schema_schema, position_x, position_y, graph_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("node", "Old node", "{}", defaults, "List", "Create", 0, 0, "old");
    sqlite.exec(
      readFileSync(join(migrationsFolder, "20260831063306_spicy_jazinda", "migration.sql"), "utf8"),
    );
    assert.equal(sqlite.prepare("SELECT types FROM project_meta").get()!.types, "{}");
    assert.equal(
      sqlite.prepare("SELECT input_defaults FROM nodes").get()!.input_defaults,
      defaults,
    );
    const loaded = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* Persistence.Service).loadProject();
      }).pipe(
        Effect.provide(
          SqlitePersistence.layer.pipe(
            Layer.provide(
              Layer.succeed(DrizzleDriver.Service)({ driver: drizzle({ client: sqlite }) }),
            ),
          ),
        ),
      ),
    );
    assert.deepEqual(loaded.types, {});
    assert.deepEqual(loaded.graphs.old!.nodes.node!.inputDefaults, JSON.parse(defaults));
  } finally {
    sqlite.close();
  }
});

test("all generated migrations apply through the production Drizzle migrator", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder });
    assert.ok(
      sqlite
        .prepare("PRAGMA table_info(project_meta)")
        .all()
        .some((column) => column.name === "types" && column.notnull === 1),
    );
  } finally {
    sqlite.close();
  }
});
