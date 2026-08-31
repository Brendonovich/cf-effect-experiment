import { FunctionGraph, Graph, Project } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Effect, Layer } from "effect";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DrizzleDriver } from "../src/DrizzleDriver.ts";
import { SqlitePersistence } from "../src/SqlitePersistence.ts";

test("generated migrations default ordinary graphs and round-trip function signatures", async () => {
  const layer = SqlitePersistence.layer.pipe(
    Layer.provide(
      DrizzleDriver.layerNodeSqlite(
        ":memory:",
        fileURLToPath(new URL("../drizzle", import.meta.url)),
      ),
    ),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;
      const ordinary = Graph.empty("ordinary");
      const fn = FunctionGraph.generate(
        {
          ...Graph.empty("function"),
          kind: "function",
          signature: {
            inputs: [{ id: "stable", name: "Argument", type: { _tag: "String" } }],
            outputs: [],
          },
        },
        () => crypto.randomUUID(),
      );
      yield* persistence.saveProject({ ...Project.empty(), graphs: { ordinary, function: fn } });
      const loaded = yield* persistence.loadProject();
      assert.equal(loaded.graphs.ordinary?.kind, "ordinary");
      assert.deepEqual(loaded.graphs.function, fn);
      yield* persistence.saveGraph({ ...fn, name: "Renamed" });
      assert.deepEqual((yield* persistence.loadGraph(fn.id)).signature, fn.signature);
    }).pipe(Effect.provide(layer)),
  );
});
