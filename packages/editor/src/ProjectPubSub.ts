import type { Scope } from "effect";

import { Context, Effect, Layer, PubSub } from "effect";

import { EditorEvent } from "./EditorEvent.ts";

export class Service extends Context.Service<
  Service,
  {
    readonly publish: (event: EditorEvent.EditorEvent) => Effect.Effect<void>;
    readonly subscribe: Effect.Effect<
      PubSub.Subscription<EditorEvent.EditorEvent>,
      never,
      Scope.Scope
    >;
  }
>()("macrograph/ProjectPubSub") {}

const make = Effect.gen(function* () {
  const pubsub = yield* PubSub.bounded<EditorEvent.EditorEvent>(100);
  yield* Effect.log("creating pubsub");
  return Service.of({
    publish: (event) => PubSub.publish(pubsub, event),
    subscribe: PubSub.subscribe(pubsub),
  });
});

export const defaultLayer = Layer.effect(Service, make);

export * as ProjectPubSub from "./ProjectPubSub.ts";
