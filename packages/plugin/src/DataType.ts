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

export type Any = String | Int | Float | Bool | DateTime | List | Option;
export type Scalar = String | Int | Float | Bool;

export type Value<DataType extends Type<unknown>> =
  DataType extends Type<infer Value> ? Value : never;

export const String: String = { _tag: "String" };
export const Int: Int = { _tag: "Int" };
export const Float: Float = { _tag: "Float" };
export const Bool: Bool = { _tag: "Bool" };
export const DateTime: DateTime = { _tag: "DateTime" };
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
  Schema.Struct({
    _tag: Schema.Literal("List"),
    item: Schema.suspend((): Schema.Codec<Any> => Descriptor),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Option"),
    inner: Schema.suspend((): Schema.Codec<Any> => Descriptor),
  }),
]);

export const ValueSchema = (type: Any): Schema.Codec<unknown> => {
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
      return Schema.Array(ValueSchema(type.item));
    case "Option":
      return Schema.Option(ValueSchema(type.inner));
  }
};

export const JsonValueSchema = (type: Any): Schema.Codec<unknown, Schema.Json> =>
  Schema.toCodecJson(ValueSchema(type));

export const equals = (left: Any, right: Any): boolean => {
  if (left._tag !== right._tag) return false;
  if (left._tag === "List" && right._tag === "List") return equals(left.item, right.item);
  if (left._tag === "Option" && right._tag === "Option") return equals(left.inner, right.inner);
  return true;
};

export const isValue = (type: Any, value: unknown): boolean => Schema.is(ValueSchema(type))(value);

export * as DataType from "./DataType.ts";
