import { DataType } from "@macrograph/plugin/DataType";
import { Schema } from "effect";

export const valueRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

export const defaultValueError = (
  type: DataType.Any,
  value: unknown,
  definitions: DataType.Definitions,
): string | undefined => {
  try {
    Schema.decodeUnknownSync(DataType.JsonValueSchema(type, definitions), {
      onExcessProperty: "error",
    })(value);
    return undefined;
  } catch (error) {
    return String(error);
  }
};

// Lists and options terminate eagerly; enums try each variant so recursive first variants cannot loop.
export const initialDefaultValue = (
  type: DataType.Any,
  definitions: DataType.Definitions,
  seen: ReadonlySet<string> = new Set(),
): unknown => {
  switch (type._tag) {
    case "String":
      return "";
    case "Int":
    case "Float":
      return 0;
    case "Bool":
      return false;
    case "DateTime":
      return "1970-01-01T00:00:00.000Z";
    case "List":
      return [];
    case "Option":
      return { _tag: "None" };
    case "Custom": {
      if (seen.has(type.id)) return undefined;
      const definition = definitions[type.id];
      if (!definition) return undefined;
      const nextSeen = new Set([...seen, type.id]);
      const groups =
        definition._tag === "Struct" ? [{ fields: definition.fields }] : definition.variants;
      for (const group of groups) {
        const fields = group.fields.map(
          (field) => [field.name, initialDefaultValue(field.type, definitions, nextSeen)] as const,
        );
        if (fields.some(([, value]) => value === undefined)) continue;
        return {
          ...Object.fromEntries(fields),
          _type: type.id,
          ...("name" in group ? { _tag: group.name } : {}),
        };
      }
      return undefined;
    }
  }
};
