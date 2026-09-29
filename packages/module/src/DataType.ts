import type * as EffectDateTime from "effect/DateTime";
import type * as EffectOption from "effect/Option";

import { Schema } from "effect";

declare const TypeId: unique symbol;

export interface DataType<Value> {
  readonly [TypeId]?: Value;
}

export interface String extends DataType<string> {
  readonly _tag: "String";
}

export interface Int extends DataType<number> {
  readonly _tag: "Int";
}

export interface Float extends DataType<number> {
  readonly _tag: "Float";
}

export interface Bool extends DataType<boolean> {
  readonly _tag: "Bool";
}

export interface DateTime extends DataType<EffectDateTime.DateTime> {
  readonly _tag: "DateTime";
}

export interface List<Item extends Type = Type> extends DataType<ReadonlyArray<Value<Item>>> {
  readonly _tag: "List";
  readonly item: Item;
}

export interface Option<Inner extends Type = Type> extends DataType<
  EffectOption.Option<Value<Inner>>
> {
  readonly _tag: "Option";
  readonly inner: Inner;
}

export const DefinitionId = Schema.String.pipe(Schema.brand("TypeDefinitionId"));
export type DefinitionId = typeof DefinitionId.Type;

export interface Struct extends DataType<Readonly<Record<string, unknown>>> {
  readonly _tag: "Struct";
  readonly id: string;
  readonly definition?: StructDefinition;
}

export interface Enum extends DataType<Readonly<Record<string, unknown>>> {
  readonly _tag: "Enum";
  readonly id: string;
  readonly definition?: EnumDefinition;
}

/** IDs are local to a node, not a module or graph. Values are inferred from wires. */
export interface Wildcard extends DataType<unknown> {
  readonly _tag: "Wildcard";
  readonly id: string;
  readonly value?: Type;
}

export type Type =
  | String
  | Int
  | Float
  | Bool
  | DateTime
  | List
  | Option
  | Struct
  | Enum
  | Wildcard;
export type Scalar = String | Int | Float | Bool;

export type Value<Data extends DataType<unknown>> =
  Data extends List<infer Item>
    ? Type extends Item
      ? ReadonlyArray<unknown>
      : ReadonlyArray<Value<Item>>
    : Data extends Option<infer Inner>
      ? Type extends Inner
        ? EffectOption.Option<unknown>
        : EffectOption.Option<Value<Inner>>
      : Data extends DataType<infer Value>
        ? Value
        : never;

export const String: String = { _tag: "String" };
export const Int: Int = { _tag: "Int" };
export const Float: Float = { _tag: "Float" };
export const Bool: Bool = { _tag: "Bool" };
export const DateTime: DateTime = { _tag: "DateTime" };
const nominal = <Tag extends "Struct" | "Enum", Def extends Definition>(
  tag: Tag,
  id: string,
  definition?: Def,
): { readonly _tag: Tag; readonly id: string; readonly definition?: Def } => {
  const type = { _tag: tag, id } as {
    readonly _tag: Tag;
    readonly id: string;
    readonly definition?: Def;
  };
  if (definition !== undefined)
    Object.defineProperty(type, "definition", { value: definition, enumerable: false });
  return type;
};
const struct = (id: string, definition?: StructDefinition): Struct =>
  nominal("Struct", id, definition);
const enumeration = (id: string, definition?: EnumDefinition): Enum =>
  nominal("Enum", id, definition);
export const Wildcard = (id: string, value?: Type): Wildcard => {
  const wildcard: Wildcard = { _tag: "Wildcard", id };
  if (value !== undefined) Object.defineProperty(wildcard, "value", { value, enumerable: false });
  return wildcard;
};
export const List = <Item extends Type>(item: Item): List<Item> => ({ _tag: "List", item });
export const Option = <Inner extends Type>(inner: Inner): Option<Inner> => ({
  _tag: "Option",
  inner,
});

export const isType = (value: unknown): value is Type => {
  if (typeof value !== "object" || value === null || !("_tag" in value)) return false;
  const tag = value._tag;
  return (
    tag === "String" ||
    tag === "Int" ||
    tag === "Float" ||
    tag === "Bool" ||
    tag === "DateTime" ||
    tag === "List" ||
    tag === "Option" ||
    tag === "Struct" ||
    tag === "Enum" ||
    tag === "Wildcard"
  );
};

export const Descriptor: Schema.Codec<Type> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("String") }),
  Schema.Struct({ _tag: Schema.Literal("Int") }),
  Schema.Struct({ _tag: Schema.Literal("Float") }),
  Schema.Struct({ _tag: Schema.Literal("Bool") }),
  Schema.Struct({ _tag: Schema.Literal("DateTime") }),
  Schema.Struct({ _tag: Schema.Literal("Struct"), id: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Enum"), id: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Wildcard"), id: Schema.String }),
  Schema.Struct({
    _tag: Schema.Literal("List"),
    item: Schema.suspend((): Schema.Codec<Type> => Descriptor),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Option"),
    inner: Schema.suspend((): Schema.Codec<Type> => Descriptor),
  }),
]);

export const Field = Schema.Struct({ name: Schema.String, type: Descriptor });
export type Field = typeof Field.Type;
export const Variant = Schema.Struct({ name: Schema.String, fields: Schema.Array(Field) });
export type Variant = typeof Variant.Type;
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
export type StructDefinition = Extract<Definition, { readonly _tag: "Struct" }>;
export type EnumDefinition = Extract<Definition, { readonly _tag: "Enum" }>;
export type Fields = Readonly<Record<string, Type>>;
export type Variants = Readonly<Record<string, Fields>>;

const isVariantList = (
  variants: ReadonlyArray<string> | Variants,
): variants is ReadonlyArray<string> => Array.isArray(variants);

export const defineStruct = (id: string, name: string, fields: Fields): StructDefinition => ({
  _tag: "Struct",
  id: DefinitionId.make(id),
  name,
  fields: Object.entries(fields).map(([name, type]) => ({ name, type })),
});

export const defineEnum = (
  id: string,
  name: string,
  variants: ReadonlyArray<string> | Variants,
): EnumDefinition => ({
  _tag: "Enum",
  id: DefinitionId.make(id),
  name,
  variants: isVariantList(variants)
    ? variants.map((name) => ({ name, fields: [] }))
    : Object.entries(variants).map(([name, fields]) => ({
        name,
        fields: Object.entries(fields).map(([name, type]) => ({ name, type })),
      })),
});

export function Struct(definition: StructDefinition): Struct;
export function Struct(id: string): Struct;
export function Struct(definition: StructDefinition | string): Struct {
  return typeof definition === "string" ? struct(definition) : struct(definition.id, definition);
}
export function Enum(definition: EnumDefinition): Enum;
export function Enum(id: string): Enum;
export function Enum(definition: EnumDefinition | string): Enum {
  return typeof definition === "string"
    ? enumeration(definition)
    : enumeration(definition.id, definition);
}
export const fromDefinition = (definition: Definition): Struct | Enum =>
  definition._tag === "Struct" ? Struct(definition) : Enum(definition);

export const Definitions = Schema.Record(Schema.String, Definition);
export type Definitions = typeof Definitions.Type;

/** Adds project-local definitions to resolved types without changing their serialized descriptor. */
export const hydrate = (type: Type, definitions: Definitions): Type => {
  switch (type._tag) {
    case "Struct": {
      const definition = Object.hasOwn(definitions, type.id) ? definitions[type.id] : undefined;
      return struct(type.id, definition?._tag === "Struct" ? definition : undefined);
    }
    case "Enum": {
      const definition = Object.hasOwn(definitions, type.id) ? definitions[type.id] : undefined;
      return enumeration(type.id, definition?._tag === "Enum" ? definition : undefined);
    }
    case "Wildcard":
      return Wildcard(
        type.id,
        type.value === undefined ? undefined : hydrate(type.value, definitions),
      );
    case "List":
      return List(hydrate(type.item, definitions));
    case "Option":
      return Option(hydrate(type.inner, definitions));
    default:
      return type;
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

const valueSchema = (type: Type, definitions: Definitions): Schema.Codec<unknown> => {
  if (!Schema.is(finiteValue)(type)) return Schema.Never;
  const carriesDefinition = (current: Type): boolean =>
    current._tag === "Struct" || current._tag === "Enum"
      ? current.definition !== undefined
      : current._tag === "List"
        ? carriesDefinition(current.item)
        : current._tag === "Option"
          ? carriesDefinition(current.inner)
          : false;
  const useEmbeddedDefinitions = carriesDefinition(type);
  const visited = new Set<string>();
  const referencesExist = (current: Type): boolean => {
    if (current._tag === "Wildcard") return false;
    if (current._tag === "List") return referencesExist(current.item);
    if (current._tag === "Option") return referencesExist(current.inner);
    if ((current._tag !== "Struct" && current._tag !== "Enum") || visited.has(current.id))
      return true;
    const definition =
      (useEmbeddedDefinitions ? current.definition : undefined) ??
      (Object.hasOwn(definitions, current.id) ? definitions[current.id] : undefined);
    if (
      definition === undefined ||
      definition.id !== current.id ||
      definition._tag !== current._tag
    )
      return false;
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
  const resolve = (type: Type): Schema.Codec<unknown> => {
    switch (type._tag) {
      case "Wildcard":
        return Schema.Never;
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
      case "Struct":
      case "Enum":
        return Schema.suspend((): Schema.Codec<unknown> => {
          const definition =
            (useEmbeddedDefinitions ? type.definition : undefined) ??
            (Object.hasOwn(definitions, type.id) ? definitions[type.id] : undefined);
          if (
            definition === undefined ||
            definition.id !== type.id ||
            definition._tag !== type._tag ||
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
export const ValueSchema = (type: Type, definitions: Definitions = {}): Schema.Codec<unknown> => {
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
  type: Type,
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

export const equals = (left: Type, right: Type): boolean => {
  if (left._tag !== right._tag) return false;
  if (left._tag === "Struct" && right._tag === "Struct") return left.id === right.id;
  if (left._tag === "Enum" && right._tag === "Enum") return left.id === right.id;
  if (left._tag === "Wildcard" && right._tag === "Wildcard") return left.id === right.id;
  if (left._tag === "List" && right._tag === "List") return equals(left.item, right.item);
  if (left._tag === "Option" && right._tag === "Option") return equals(left.inner, right.inner);
  return true;
};

export const hasWildcard = (type: Type): boolean =>
  type._tag === "Wildcard" ||
  (type._tag === "List" && hasWildcard(type.item)) ||
  (type._tag === "Option" && hasWildcard(type.inner));

/** Encode declaration defaults such as List<T>=[] and Option<T>=None before inference.
 * A wildcard itself has no value/default. Runtime validation still requires resolved IO.
 */
export const JsonDefaultSchema = (
  type: Type,
  definitions: Definitions = {},
): Schema.Codec<unknown, Schema.Json> => {
  if (!hasWildcard(type)) return JsonValueSchema(type, definitions);
  const resolve = (type: Type): Schema.Codec<unknown> => {
    if (type._tag === "Wildcard") return Schema.Never;
    if (type._tag === "List") return Schema.Array(resolve(type.item));
    if (type._tag === "Option") return Schema.Option(resolve(type.inner));
    return ValueSchema(type, definitions);
  };
  return Schema.Json.pipe(
    Schema.decodeTo(finiteValue),
    Schema.decodeTo(Schema.toCodecJson(resolve(type))),
  );
};

/** A local authoring check only. Graph-wide unification must also succeed. */
export const compatible = (left: Type, right: Type): boolean => {
  if (left._tag === "Wildcard" || right._tag === "Wildcard") return true;
  if (left._tag === "List" && right._tag === "List") return compatible(left.item, right.item);
  if (left._tag === "Option" && right._tag === "Option") return compatible(left.inner, right.inner);
  return equals(left, right);
};

export const isValue = (type: Type, value: unknown, definitions: Definitions = {}): boolean =>
  Schema.is(finiteValue)(value) && Schema.is(valueSchema(type, definitions))(value);

export * as t from "./DataType.ts";
