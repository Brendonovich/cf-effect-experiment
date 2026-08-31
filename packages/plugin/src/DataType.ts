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
  DataType extends List<infer Item>
    ? Any extends Item
      ? ReadonlyArray<unknown>
      : ReadonlyArray<Value<Item>>
    : DataType extends Option<infer Inner>
      ? Any extends Inner
        ? EffectOption.Option<unknown>
        : EffectOption.Option<Value<Inner>>
      : DataType extends Type<infer Value>
        ? Value
        : never;

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

/** List properties retain shipped scalar names; nested selectors store a JSON descriptor. */
export const parseSelector = (value: string): Any | undefined => {
  if (["String", "Int", "Float", "Bool", "DateTime"].includes(value)) {
    return Schema.decodeUnknownSync(Descriptor)({ _tag: value });
  }
  try {
    return Schema.decodeUnknownSync(Descriptor)(JSON.parse(value));
  } catch {
    return undefined;
  }
};

const finiteValue = Schema.Unknown.check(
  Schema.makeFilter((value: unknown) => {
    const ancestors = new Set<object>();
    let count = 0;
    const visit = (current: unknown, depth: number): boolean => {
      if (++count > 100_000 || depth > 128) return false;
      if (typeof current !== "object" || current === null) return true;
      if (ancestors.has(current)) return false;
      ancestors.add(current);
      const valid = Object.values(current).every((child) => visit(child, depth + 1));
      ancestors.delete(current);
      return valid;
    };
    try {
      return visit(value, 0) || "Expected a finite value (maximum depth 128 and 100000 entries)";
    } catch {
      return "Value cannot be inspected safely";
    }
  }),
);

const valueSchema = (type: Any, definitions: Definitions): Schema.Codec<unknown> => {
  if (!Schema.is(finiteValue)(type)) return Schema.Never;
  const visited = new Set<string>();
  const referencesExist = (current: Any): boolean => {
    if (current._tag === "List") return referencesExist(current.item);
    if (current._tag === "Option") return referencesExist(current.inner);
    if (current._tag !== "Custom" || visited.has(current.id)) return true;
    const definition = Object.hasOwn(definitions, current.id) ? definitions[current.id] : undefined;
    if (definition === undefined || definition.id !== current.id) return false;
    visited.add(current.id);
    const fields =
      definition._tag === "Struct"
        ? definition.fields
        : definition.variants.flatMap((variant) => variant.fields);
    return fields.every(
      (field) => Schema.is(finiteValue)(field.type) && referencesExist(field.type),
    );
  };
  if (!referencesExist(type)) return Schema.Never;
  const resolve = (type: Any): Schema.Codec<unknown> => {
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
        return Schema.Array(resolve(type.item));
      case "Option":
        return Schema.Option(resolve(type.inner));
      case "Custom":
        return Schema.suspend((): Schema.Codec<unknown> => {
          const definition = Object.hasOwn(definitions, type.id) ? definitions[type.id] : undefined;
          if (
            definition === undefined ||
            definition.id !== type.id ||
            ["__proto__", "constructor", "prototype"].includes(type.id)
          )
            return Schema.Never;
          const groups =
            definition._tag === "Struct"
              ? [definition.fields]
              : definition.variants.map((variant) => variant.fields);
          if (
            groups.some((items) => {
              const names = new Set<string>();
              return items.some((field) => {
                const invalid =
                  field.name.trim() === "" ||
                  names.has(field.name) ||
                  ["_type", "_tag", "__proto__", "constructor", "prototype"].includes(field.name);
                names.add(field.name);
                return invalid;
              });
            })
          )
            return Schema.Never;
          if (
            definition._tag === "Enum" &&
            (definition.variants.length === 0 ||
              new Set(definition.variants.map((variant) => variant.name)).size !==
                definition.variants.length ||
              definition.variants.some(
                (variant) =>
                  variant.name.trim() === "" ||
                  ["__proto__", "constructor", "prototype"].includes(variant.name),
              ))
          )
            return Schema.Never;
          const fields = (items: ReadonlyArray<typeof Field.Type>) =>
            Object.fromEntries(items.map((field) => [field.name, resolve(field.type)]));
          return definition._tag === "Struct"
            ? Schema.Struct({
                ...fields(definition.fields),
                _type: Schema.Literal(definition.id),
              }).annotate({ parseOptions: { onExcessProperty: "error" } })
            : Schema.Union(
                definition.variants.map((variant) =>
                  Schema.Struct({
                    ...fields(variant.fields),
                    _type: Schema.Literal(definition.id),
                    _tag: Schema.Literal(variant.name),
                  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
                ),
              );
        });
    }
  };
  return resolve(type);
};

// Guard both parse directions without hiding the runtime checks behind an Unknown schema.
export const ValueSchema = (type: Any, definitions: Definitions = {}): Schema.Codec<unknown> => {
  const schema = valueSchema(type, definitions);
  return finiteValue.pipe(
    Schema.decodeTo(schema),
    Schema.decodeTo(
      finiteValue.check(
        Schema.makeFilter(
          (value: unknown) => Schema.is(schema)(value) || "Value does not match its data type",
        ),
      ),
    ),
  );
};

export const JsonValueSchema = (
  type: Any,
  definitions: Definitions = {},
): Schema.Codec<unknown, Schema.Json> => {
  const schema = valueSchema(type, definitions);
  // Derive JSON transformations from the unwrapped schema (not Unknown), especially for Option/DateTime.
  return Schema.Json.pipe(
    Schema.decodeTo(finiteValue),
    Schema.decodeTo(Schema.toCodecJson(schema)),
    Schema.decodeTo(
      finiteValue.check(
        Schema.makeFilter(
          (value: unknown) => Schema.is(schema)(value) || "Value does not match its data type",
        ),
      ),
    ),
  );
};

export const equals = (left: Any, right: Any): boolean => {
  if (left._tag !== right._tag) return false;
  if (left._tag === "Custom" && right._tag === "Custom") return left.id === right.id;
  if (left._tag === "List" && right._tag === "List") return equals(left.item, right.item);
  if (left._tag === "Option" && right._tag === "Option") return equals(left.inner, right.inner);
  return true;
};

export const isValue = (type: Any, value: unknown, definitions: Definitions = {}): boolean =>
  Schema.is(finiteValue)(value) && Schema.is(valueSchema(type, definitions))(value);

export * as DataType from "./DataType.ts";
