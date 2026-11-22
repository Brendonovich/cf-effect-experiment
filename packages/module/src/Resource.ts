import { Context, Effect, Layer, Schema, Semaphore, Stream, SubscriptionRef } from "effect";

import type * as ModuleId from "./ModuleId.ts";

import * as BoundKey from "./internal/boundKey.ts";

/** Same symbol as `Engine.BindTypeId`; engines bind their resources when they are bound. */
export const BindTypeId: unique symbol = Symbol.for("~macrograph/Module/bind");

export interface Value<Identifier> {
  readonly id: Identifier;
  readonly display: string;
}

export interface HandlerService<Identifier extends string, Shape> {
  readonly tag: Identifier;
  readonly values: Effect.Effect<ReadonlyArray<Value<Shape>>>;
  readonly reload: Effect.Effect<void>;
  readonly changes: Stream.Stream<ReadonlyArray<Value<Shape>>>;
}

export interface Handler<Identifier extends string, Shape> extends Context.ServiceClass.Shape<
  `macrograph/Module/Resource/${Identifier}`,
  HandlerService<Identifier, Shape>
> {}

export interface AnyClass {
  readonly key: string;
  readonly definition: { readonly name: string; readonly description?: string };
}

export type ToHandler<R extends ResourceClass<any, any, any>> =
  R extends ResourceClass<unknown, infer Identifier, infer Shape>
    ? Handler<Identifier, Shape>
    : never;

export const make =
  <Self, Shape extends Schema.Json>() =>
  <const Identifier extends string>(
    id: Identifier,
    opts: { readonly name: string; readonly description?: string },
  ) => {
    const handlerKey = BoundKey.make((scope) => `macrograph/Module/Resource/${scope}/${id}`);
    const HandlerTag = Context.Service<
      Handler<Identifier, Shape>,
      HandlerService<Identifier, Shape>
    >("macrograph/Module/Resource");
    BoundKey.install(HandlerTag, handlerKey.key);

    class Resource {
      static readonly [BindTypeId] = (moduleId: ModuleId.Id) => handlerKey.bind(moduleId);
      static readonly key = id;
      static readonly definition = opts;
      static readonly Handler = HandlerTag;

      static readonly values = Effect.flatMap(HandlerTag, (handler) => handler.values);
      static readonly reload = Effect.flatMap(HandlerTag, (handler) => handler.reload);
      static readonly changes = Stream.unwrap(Effect.map(HandlerTag, (handler) => handler.changes));

      static toLayer(load: Effect.Effect<ReadonlyArray<Value<Shape>>>) {
        return Layer.effect(HandlerTag)(
          Effect.gen(function* () {
            const state = yield* SubscriptionRef.make<ReadonlyArray<Value<Shape>>>([]);
            const lock = yield* Semaphore.make(1);
            const reload = load.pipe(
              Effect.flatMap((values) => SubscriptionRef.set(state, values)),
              lock.withPermit,
            );
            yield* reload;
            return {
              tag: id,
              values: SubscriptionRef.get(state),
              reload,
              changes: SubscriptionRef.changes(state),
            };
          }),
        );
      }
    }

    return Resource as unknown as ResourceClass<Self, Identifier, Shape>;
  };

export interface ResourceClass<_Self, Identifier extends string, Shape> {
  new (_: never): {};
  readonly [BindTypeId]: (moduleId: ModuleId.Id) => void;
  readonly key: Identifier;
  readonly definition: { readonly name: string; readonly description?: string };
  readonly Handler: Context.Service<Handler<Identifier, Shape>, HandlerService<Identifier, Shape>>;
  readonly values: Effect.Effect<ReadonlyArray<Value<Shape>>, never, Handler<Identifier, Shape>>;
  readonly reload: Effect.Effect<void, never, Handler<Identifier, Shape>>;
  readonly changes: Stream.Stream<ReadonlyArray<Value<Shape>>, never, Handler<Identifier, Shape>>;
  readonly toLayer: (
    load: Effect.Effect<ReadonlyArray<Value<Shape>>>,
  ) => Layer.Layer<Handler<Identifier, Shape>>;
}

export type ResourceClassSelf<T extends AnyClass> =
  T extends ResourceClass<unknown, string, infer Shape> ? Shape : never;
