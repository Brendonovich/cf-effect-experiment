import { Context, Effect, Layer } from "effect";

import { EditorEvent } from "./EditorEvent.ts";
import { EditorEventProjector, type ApplyError } from "./EditorEventProjector.ts";
import { ProjectPubSub } from "./ProjectPubSub.ts";

export class Service extends Context.Service<
  Service,
  {
    readonly publish: <Event extends EditorEvent.EditorEvent>(
      event: Event,
    ) => Effect.Effect<Event, ApplyError>;
    readonly publishEphemeral: <Event extends EditorEvent.EditorEvent>(
      event: Event,
    ) => Effect.Effect<Event>;
  }
>()("macrograph/EditorEvents") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const projector = yield* EditorEventProjector.Service;
    const pubsub = yield* ProjectPubSub.Service;

    return Service.of({
      publish: (event) =>
        projector.apply(event).pipe(
          Effect.andThen(pubsub.publish(event)),
          Effect.as(event),
        ),
      publishEphemeral: (event) =>
        pubsub.publish(event).pipe(Effect.as(event)),
    });
  }),
);

export const defaultLayer = layer.pipe(
  Layer.provide(EditorEventProjector.layer),
  Layer.provide(ProjectPubSub.defaultLayer),
);

export * as EditorEvents from "./EditorEvents.ts";
