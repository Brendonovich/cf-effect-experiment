import { DataType } from "@macrograph/plugin/DataType";
import { Schema } from "effect";

export const Collection = DataType.Definitions;

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "TypeDefinitionNotFoundError",
  {
    id: DataType.DefinitionId,
  },
) {}

export class InvalidError extends Schema.TaggedError<InvalidError>()("InvalidTypeDefinition", {
  id: Schema.String,
  reason: Schema.String,
}) {}

/** Validate the complete registry so mutually recursive references can be authored together. */
export const validate = (definitions: DataType.Definitions): ReadonlyArray<InvalidError> => {
  const errors: InvalidError[] = [];
  const names = new Set<string>();
  const checkReference = (id: string, type: DataType.Any): void => {
    if (type._tag === "Custom" && !Object.hasOwn(definitions, type.id)) {
      errors.push(new InvalidError({ id, reason: `Unknown type ${type.id}` }));
    } else if (type._tag === "List") checkReference(id, type.item);
    else if (type._tag === "Option") checkReference(id, type.inner);
  };
  for (const [id, definition] of Object.entries(definitions)) {
    if (id !== definition.id || id.trim() === "") {
      errors.push(
        new InvalidError({ id, reason: "Definition key must match its non-empty identity" }),
      );
    }
    if (definition.name.trim() === "" || names.has(definition.name)) {
      errors.push(new InvalidError({ id, reason: "Type names must be non-empty and unique" }));
    }
    names.add(definition.name);
    const groups =
      definition._tag === "Struct" ? [definition.fields] : definition.variants.map((v) => v.fields);
    if (definition._tag === "Enum") {
      const variants = new Set<string>();
      if (definition.variants.length === 0)
        errors.push(new InvalidError({ id, reason: "Enums require a variant" }));
      for (const variant of definition.variants) {
        if (variant.name.trim() === "" || variants.has(variant.name)) {
          errors.push(
            new InvalidError({ id, reason: "Variant names must be non-empty and unique" }),
          );
        }
        variants.add(variant.name);
      }
    }
    for (const fields of groups) {
      const fieldNames = new Set<string>();
      for (const field of fields) {
        if (
          field.name.trim() === "" ||
          fieldNames.has(field.name) ||
          ["_type", "_tag", "__proto__", "constructor", "prototype"].includes(field.name)
        ) {
          errors.push(new InvalidError({ id, reason: `Invalid or duplicate field ${field.name}` }));
        }
        fieldNames.add(field.name);
        checkReference(id, field.type);
      }
    }
  }
  // Required recursive cycles without a terminating variant cannot have a finite value.
  const finite = new Set<string>();
  const canTerminate = (type: DataType.Any): boolean =>
    type._tag !== "Custom" || finite.has(type.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, definition] of Object.entries(definitions)) {
      if (finite.has(id)) continue;
      const terminates =
        definition._tag === "Struct"
          ? definition.fields.every((field) => canTerminate(field.type))
          : definition.variants.some((variant) =>
              variant.fields.every((field) => canTerminate(field.type)),
            );
      if (terminates) {
        finite.add(id);
        changed = true;
      }
    }
  }
  for (const id of Object.keys(definitions)) {
    if (!finite.has(id))
      errors.push(
        new InvalidError({
          id,
          reason: "Recursive type has no finite value; use List, Option, or a terminating variant",
        }),
      );
  }
  return errors;
};

export * as TypeDefinition from "./TypeDefinition.ts";
