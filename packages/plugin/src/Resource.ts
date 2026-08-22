import { Context, Effect, Layer } from "effect";

export interface Def<Self> {
  new (_: never): {};

  id: string;
  name: string;

  reload(): Effect.Effect<void, never, Self>;
}

export type Self<T> = T extends Def<infer Self> ? Self : never;

export type ToHandler<R extends ResourceClass<any, any, any>> =
  R extends ResourceClass<any, infer Identifier, any> ? Handler<Identifier> : never;

export interface Handler<Tag extends string> extends Context.ServiceClass.Shape<
  `macrograph/Plugin/Resource/${Tag}`,
  HandlerService<Tag>
> {
  readonly Tag: Tag;
}

export interface HandlerService<Tag extends string> {
  readonly tag: Tag;
  readonly handler: Effect.Effect<any>;
}

export const make = <Self, Shape>() => {
  return <const Identifier extends string>(id: Identifier, _opts: { name: string }) => {
    const handlerTag = Context.Service<Handler<Identifier>, HandlerService<Identifier>>(
      `macrograph/Plugin/Resource/${id}`,
    );
    const cls: any = class {
      static key = id;
      key = id;

      constructor() {
        return {
          key: id,
          Resource: cls as any,
        } as any;
      }

      static reload() {
        return Effect.gen(function* () {});
      }

      static toLayer(effect: Effect.Effect<Array<{ id: Shape; display: string }>>) {
        return Layer.succeed(handlerTag)({
          tag: id,
          handler: effect,
        });
      }
    };

    return cls as ResourceClass<Self, Identifier, Shape>;
  };
};

export interface Resource<_Identifier, _Shape> {
  // reload(): Effect.Effect<void, never, Identifier>
}

export interface ResourceClass<Self, Identifier extends string, Shape> extends Resource<
  Self,
  Shape
> {
  new (_: never): ResourceClassShape<Identifier, Shape>;
  readonly key: Identifier;

  toLayer(
    effect: Effect.Effect<Array<{ id: Shape; display: string }>>,
  ): Layer.Layer<Handler<Identifier>>;
}

export interface ResourceClassShape<Identifier extends string, Resource> {
  readonly key: Identifier;
  readonly Resource: Resource;
}

export type ResourceClassSelf<T extends ResourceClass<any, any, any>> =
  T extends ResourceClass<any, any, infer Self> ? Self : never;
