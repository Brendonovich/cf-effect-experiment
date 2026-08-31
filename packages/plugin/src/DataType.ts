import type * as EffectDateTime from "effect/DateTime";
import type * as EffectOption from "effect/Option";

import { Schema } from "effect";

declare const TypeId: unique symbol;

export interface Type<Value> {
  readonly [TypeId]?: Value;
}

export interface String extends Type<string> {
  readonly _tag: "String";
}

export interface Int extends Type<number> {
  readonly _tag: "Int";
}

export interface Float extends Type<number> {
  readonly _tag: "Float";
}

export interface Bool extends Type<boolean> {
  readonly _tag: "Bool";
}

export interface DateTime extends Type<EffectDateTime.DateTime> {
  readonly _tag: "DateTime";
}

export interface List<Item extends Any = Any> extends Type<ReadonlyArray<Value<Item>>> {
  readonly _tag: "List";
  readonly item: Item;
}

export interface Option<Inner extends Any = Any> extends Type<EffectOption.Option<Value<Inner>>> {
  readonly _tag: "Option";
  readonly inner: Inner;
}

export const DefinitionId = Schema.String.pipe(Schema.brand("TypeDefinitionId"));
export type DefinitionId = typeof DefinitionId.Type;

export interface Custom extends Type<Readonly<Record<string, unknown>>> {
  readonly _tag: "Custom";
  readonly id: string;
}

export type Any = String | Int | Float | Bool | DateTime | List | Option | Custom;
export type Scalar = String | Int | Float | Bool;

export type Value<DataType extends Type<unknown>> =
  DataType extends Type<infer Value> ? Value : never;

export const String: String = { _tag: "String" };
export const Int: Int = { _tag: "Int" };
export const Float: Float = { _tag: "Float" };
export const Bool: Bool = { _tag: "Bool" };
export const DateTime: DateTime = { _tag: "DateTime" };
export const Custom = (id: DefinitionId): Custom => ({ _tag: "Custom", id });
export const List = <Item extends Any>(item: Item): List<Item> => ({ _tag: "List", item });
export const Option = <Inner extends Any>(inner: Inner): Option<Inner> => ({
  _tag: "Option",
  inner,
});

export const Descriptor: Schema.Codec<Any> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("String") }),
  Schema.Struct({ _tag: Schema.Literal("Int") }),
  Schema.Struct({ _tag: Schema.Literal("Float") }),
  Schema.Struct({ _tag: Schema.Literal("Bool") }),
  Schema.Struct({ _tag: Schema.Literal("DateTime") }),
  Schema.Struct({ _tag: Schema.Literal("Custom"), id: Schema.String }),
  Schema.Struct({
    _tag: Schema.Literal("List"),
    item: Schema.suspend((): Schema.Codec<Any> => Descriptor),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Option"),
    inner: Schema.suspend((): Schema.Codec<Any> => Descriptor),
  }),
]);

export const Field = Schema.Struct({ name: Schema.String, type: Descriptor });
export const Variant = Schema.Struct({ name: Schema.String, fields: Schema.Array(Field) });
export const Definition = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Struct"),
    id: DefinitionId,
    name: Schema.String,
    fields: Schema.Array(Field),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Enum"),
    id: DefinitionId,
    name: Schema.String,
    variants: Schema.Array(Variant),
  }),
]);
export type Definition = typeof Definition.Type;
export const Definitions = Schema.Record(Schema.String, Definition);
export type Definitions = typeof Definitions.Type;

export const ValueSchema = (type: Any, definitions: Definitions = {}): Schema.Codec<unknown> => {
  switch (type._tag) {
    case "String":
      return Schema.String;
    case "Int":
      return Schema.Int;
    case "Float":
      return Schema.Finite;
    case "Bool":
      return Schema.Boolean;
    case "DateTime":
      return Schema.Union([Schema.DateTimeUtc, Schema.DateTimeZoned]);
    case "List":
      return Schema.Array(ValueSchema(type.item, definitions));
    case "Option":
      return Schema.Option(ValueSchema(type.inner, definitions));
    case "Custom":
      return Schema.suspend((): Schema.Codec<unknown> => {
        const definition = definitions[type.id];
        if (definition === undefined || definition.id !== type.id) return Schema.Never;
        const fields = (items: ReadonlyArray<typeof Field.Type>) =>
          Object.fromEntries(
            items.map((field) => [field.name, ValueSchema(field.type, definitions)]),
          );
        return definition._tag === "Struct"
          ? Schema.Struct({ ...fields(definition.fields), _type: Schema.Literal(definition.id) })
          : Schema.Union(
              definition.variants.map((variant) =>
                Schema.Struct({
                  ...fields(variant.fields),
                  _type: Schema.Literal(definition.id),
                  _tag: Schema.Literal(variant.name),
                }),
              ),
            );
      });
  }
};

export const JsonValueSchema = (
  type: Any,
  definitions: Definitions = {},
): Schema.Codec<unknown, Schema.Json> => Schema.toCodecJson(ValueSchema(type, definitions));

export const equals = (left: Any, right: Any): boolean => {
  if (left._tag !== right._tag) return false;
  if (left._tag === "Custom" && right._tag === "Custom") return left.id === right.id;
  if (left._tag === "List" && right._tag === "List") return equals(left.item, right.item);
  if (left._tag === "Option" && right._tag === "Option") return equals(left.inner, right.inner);
  return true;
};

export const isValue = (type: Any, value: unknown, definitions: Definitions = {}): boolean =>
  Schema.is(ValueSchema(type, definitions))(value);

export * as DataType from "./DataType.ts";
