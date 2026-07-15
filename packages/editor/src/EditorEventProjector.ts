import { Node } from "@macrograph/core";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { Context, Effect, Layer } from "effect";

import { EditorEvent } from "./EditorEvent.ts";

export type ApplyError = PersistenceError;

export class Service extends Context.Service<
  Service,
  {
    readonly apply: <Event extends EditorEvent.EditorEvent>(
      event: Event,
    ) => Effect.Effect<void, ApplyError>;
  }
>()("macrograph/EditorEventProjector") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;

    const apply = <Event extends EditorEvent.EditorEvent>(
      event: Event,
    ): Effect.Effect<void, ApplyError> => {
      switch (event._tag) {
        case "GraphCreated":
          return persistence.saveGraph(event.graph);

        case "GraphDeleted":
          return persistence.deleteGraph(event.graphId);

        case "NodeCreated":
          return persistence.saveNode(event.graphId, event.node);

        case "NodeNameChanged":
          return Effect.gen(function* () {
            const node = yield* persistence.loadNode(event.graphId, event.nodeId);
            const updated: Node.Model = { ...node, name: event.name };
            return yield* persistence.saveNode(event.graphId, updated);
          }).pipe(PersistenceError.refail);

        case "NodePositionChanged":
          return Effect.gen(function* () {
            const node = yield* persistence.loadNode(event.graphId, event.nodeId);
            const updated: Node.Model = {
              ...node,
              position: { x: event.x, y: event.y },
            };
            return yield* persistence.saveNode(event.graphId, updated);
          }).pipe(PersistenceError.refail);

        case "NodeDeleted":
          return persistence.deleteNode(event.graphId, event.nodeId);

        case "ConnectionCreated":
          return persistence.saveConnection(event.graphId, event.connection);

        case "ConnectionDeleted":
          return persistence.deleteConnection(event.graphId, event.connectionId);
      }
    };

    return Service.of({ apply });
  }),
);

export * as EditorEventProjector from "./EditorEventProjector.ts";
