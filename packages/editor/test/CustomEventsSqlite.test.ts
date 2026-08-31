import { expect, it } from "@effect/vitest";
import { CustomEvent, GraphId, Project } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { DrizzleDriver, SqlitePersistence } from "@macrograph/persistence-sqlite";
import { Effect, Layer } from "effect";

const layer = SqlitePersistence.layer.pipe(
  Layer.provide(
    DrizzleDriver.layerNodeSqlite(
      ":memory:",
      new URL("../../persistence-sqlite/drizzle", import.meta.url).pathname,
    ),
  ),
);
it.effect(
  "generated SQLite migrations persist typed custom events without graph writes erasing metadata",
  () =>
    Effect.gen(function* () {
      const db = yield* Persistence.Service;
      const event: CustomEvent.Model = {
        id: "event-id",
        name: "Renamed",
        fields: [
          {
            id: "field-id",
            name: "Values",
            type: { _tag: "Option", inner: { _tag: "List", item: { _tag: "Int" } } },
          },
        ],
      };
      yield* db.saveProject({ ...Project.empty(), customEvents: { [event.id]: event } });
      yield* db.saveGraph({ id: GraphId.make("graph"), name: "Graph", nodes: {}, connections: [] });
      expect((yield* db.loadProject()).customEvents).toEqual({ [event.id]: event });
      yield* db.saveProject(Project.empty());
      expect((yield* db.loadProject()).customEvents).toEqual({});
    }).pipe(Effect.provide(layer)),
);
