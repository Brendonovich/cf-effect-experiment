import { NodeId, Project } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { persistenceContract } from "@macrograph/persistence/test-contract";
import { Effect, Layer, Schema } from "effect";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { DrizzleDriver, SqlitePersistence } from "../src/index.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const TestLayer = SqlitePersistence.layer.pipe(
  Layer.provide(DrizzleDriver.layerNodeSqlite(":memory:", migrationsFolder)),
);

persistenceContract("SqlitePersistence contract", TestLayer);

persistenceContract(
  "Persistence.withMemoryBuffer(SqlitePersistence) contract",
  Persistence.withMemoryBuffer(TestLayer),
);

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

test("SQLite keeps scope projections and their wires across reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "macrograph-scopes-"));
  const path = join(directory, "project.sqlite");
  const projection = (id: string, x: number) => ({ id: NodeId.make(id), position: { x, y: 5 } });
  const project = Schema.decodeUnknownSync(Project.Model)({
    ...Project.empty(),
    graphs: {
      graph: {
        canvas: {
          id: "graph",
          name: "Graph",
          nodes: {
            loop: {
              id: "loop",
              name: "Loop",
              schema: { package: "List", schema: "ForEach" },
              position: { x: 0, y: 0 },
              properties: {},
              inputDefaults: {},
              foldPins: false,
            },
          },
          scopeProjections: { first: projection("first", 10), second: projection("second", 20) },
          connections: ["first", "second"].map((id) => ({
            id: `${id}-scope`,
            outNodeId: "loop",
            outIo: { _tag: "Port", id: "body" },
            inNodeId: id,
            inIoId: "scope",
          })),
        },
      },
    },
  });
  const load = Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    return {
      project: yield* persistence.loadProject(),
      graph: yield* persistence.loadGraph("graph"),
    };
  });
  try {
    await run(
      path,
      Effect.gen(function* () {
        yield* (yield* Persistence.Service).saveProject(project);
      }),
    );
    const saved = await run(path, load);
    assert.deepEqual(saved.project, project);
    assert.deepEqual(saved.graph, project.graphs.graph!.canvas);

    // Moving one projection and deleting the other goes through saveGraph, as in the editor.
    const canvas = project.graphs.graph!.canvas;
    const edited = {
      ...canvas,
      scopeProjections: { first: projection("first", 99) },
      connections: canvas.connections.filter((wire) => wire.inNodeId !== "second"),
    };
    await run(
      path,
      Effect.gen(function* () {
        yield* (yield* Persistence.Service).saveGraph(edited);
      }),
    );
    assert.deepEqual((await run(path, load)).graph, edited);

    const remaining = await run(
      path,
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        yield* persistence.deleteGraph("graph");
        yield* persistence.saveGraph({ ...edited, scopeProjections: {}, connections: [] });
        return yield* persistence.loadGraph("graph");
      }),
    );
    assert.equal(Object.hasOwn(remaining, "scopeProjections"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
