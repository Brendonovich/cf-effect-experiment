import { DateTime, Option } from "effect";

import type * as ModuleId from "../ModuleId.ts";

import * as t from "../DataType.ts";

/**
 * Translates between the type ids a module uses in its own code (local, e.g. `User`) and the ids
 * the host sees (scoped to the module id, e.g. `macrograph.app/macrograph/github/User`). Only the
 * module's own declared types are rewritten; references to other modules' types already use full ids.
 */
export interface TypeScope {
  readonly definitions: t.Definitions;
  readonly qualifyType: (type: t.Type) => t.Type;
  readonly localizeType: (type: t.Type) => t.Type;
  readonly qualifyValue: (value: unknown) => unknown;
  readonly localizeValue: (value: unknown) => unknown;
  /** Host definitions plus the module's own definitions under their local ids. */
  readonly localDefinitions: (definitions: t.Definitions) => t.Definitions;
}

export const qualifiedId = (moduleId: ModuleId.Id, localId: string) => `${moduleId}/${localId}`;

const identity: TypeScope = {
  definitions: {},
  qualifyType: (type) => type,
  localizeType: (type) => type,
  qualifyValue: (value) => value,
  localizeValue: (value) => value,
  localDefinitions: (definitions) => definitions,
};

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const rewriteType = (type: t.Type, rename: (id: string) => string): t.Type => {
  switch (type._tag) {
    case "Struct":
      return type.definition === undefined
        ? t.Struct(rename(type.id))
        : t.Struct(rewriteDefinition(type.definition, rename));
    case "Enum":
      return type.definition === undefined
        ? t.Enum(rename(type.id))
        : t.Enum(rewriteDefinition(type.definition, rename));
    case "List":
      return t.List(rewriteType(type.item, rename));
    case "Option":
      return t.Option(rewriteType(type.inner, rename));
    case "Wildcard":
      return t.Wildcard(
        type.id,
        type.value === undefined ? undefined : rewriteType(type.value, rename),
      );
    default:
      return type;
  }
};

function rewriteDefinition<D extends t.Definition>(
  definition: D,
  rename: (id: string) => string,
): D;
function rewriteDefinition(definition: t.Definition, rename: (id: string) => string): t.Definition {
  const fields = (items: ReadonlyArray<t.Field>) =>
    items.map((field) => ({ name: field.name, type: rewriteType(field.type, rename) }));
  return definition._tag === "Struct"
    ? {
        ...definition,
        id: t.DefinitionId.make(rename(definition.id)),
        fields: fields(definition.fields),
      }
    : {
        ...definition,
        id: t.DefinitionId.make(rename(definition.id)),
        variants: definition.variants.map((variant) => ({
          name: variant.name,
          fields: fields(variant.fields),
        })),
      };
}

const rewriteValue = (value: unknown, rename: (id: string) => string): unknown => {
  if (Array.isArray(value)) return value.map((item) => rewriteValue(item, rename));
  if (Option.isOption(value))
    return Option.isSome(value) ? Option.some(rewriteValue(value.value, rename)) : value;
  if (DateTime.isDateTime(value) || !isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "_type" && typeof item === "string" ? rename(item) : rewriteValue(item, rename),
    ]),
  );
};

export const make = (moduleId: ModuleId.Id, types: t.Definitions | undefined): TypeScope => {
  const local = new Set(Object.keys(types ?? {}));
  if (local.size === 0) return identity;
  const prefix = `${moduleId}/`;
  const qualify = (id: string) => (local.has(id) ? qualifiedId(moduleId, id) : id);
  const localize = (id: string) =>
    id.startsWith(prefix) && local.has(id.slice(prefix.length)) ? id.slice(prefix.length) : id;
  const ownDefinitions = types ?? {};
  const definitions: t.Definitions = Object.fromEntries(
    Object.values(ownDefinitions).map((definition) => {
      const qualified = rewriteDefinition(definition, qualify);
      return [qualified.id, qualified];
    }),
  );
  return {
    definitions,
    qualifyType: (type) => rewriteType(type, qualify),
    localizeType: (type) => rewriteType(type, localize),
    qualifyValue: (value) => rewriteValue(value, qualify),
    localizeValue: (value) => rewriteValue(value, localize),
    localDefinitions: (hostDefinitions) => ({ ...hostDefinitions, ...ownDefinitions }),
  };
};
