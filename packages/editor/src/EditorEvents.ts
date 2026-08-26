import { Actor } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { Context, Effect, Layer, PubSub, type Scope } from "effect";

import { EditorEvent } from "./EditorEvent.ts";
import { apply, type ApplyError } from "./projectEventProjection.ts";

type EventTag = EditorEvent.EditorEvent["_tag"];
type EventFor<Tag extends EventTag> = Extract<EditorEvent.EditorEvent, { readonly _tag: Tag }>;
type WithoutActorEvent = EditorEvent.EditorEvent extends infer Event
  ? Event extends EditorEvent.EditorEvent
    ? Omit<Event, "actor">
    : never
  : never;

const CurrentActor = Context.Reference<Actor.Model>("macrograph/CurrentEditorActor", {
  defaultValue: () => Actor.system,
});

/** Attributes, publishes, and persists editor events while supporting ephemeral updates. */
export class Service extends Context.Service<
  Service,
  {
    readonly publish: <Event extends WithoutActorEvent>(
      event: Event,
    ) => Effect.Effect<EventFor<Event["_tag"]>, ApplyError>;
    readonly publishEphemeral: <Event extends WithoutActorEvent>(
      event: Event,
    ) => Effect.Effect<EventFor<Event["_tag"]>>;
    readonly subscribe: Effect.Effect<
      PubSub.Subscription<EditorEvent.EditorEvent>,
      never,
      Scope.Scope
    >;
    readonly withActor: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
      actor: Actor.Model,
    ) => Effect.Effect<A, E, R>;
  }
>()("macrograph/EditorEvents") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    const pubsub = yield* PubSub.unbounded<EditorEvent.EditorEvent>();
    const attribute = <Event extends WithoutActorEvent>(event: Event) =>
      CurrentActor.pipe(
        Effect.map((actor) => ({ ...event, actor }) as unknown as EventFor<Event["_tag"]>),
      );

    return Service.of({
      publish: (event) =>
        attribute(event).pipe(
          Effect.tap((attributed) => apply(persistence, attributed)),
          Effect.tap((attributed) => PubSub.publish(pubsub, attributed)),
        ),
      publishEphemeral: (event) =>
        attribute(event).pipe(Effect.tap((attributed) => PubSub.publish(pubsub, attributed))),
      subscribe: PubSub.subscribe(pubsub),
      withActor: (effect, actor) => Effect.provideService(effect, CurrentActor, actor),
    });
  }),
);

export const defaultLayer = layer;

export * as EditorEvents from "./EditorEvents.ts";
