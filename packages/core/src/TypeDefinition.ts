import { t } from "@macrograph/module";
import { Schema } from "effect";

import type { NodeIO } from "./IO.ts";
import type { Node } from "./Node.ts";

import { CustomTypes } from "./CustomTypes.ts";

export const Collection = t.Definitions;

// Run before recursive descriptor decoding, including at the RPC payload boundary.
const finiteAuthoring = Schema.Unknown.check(
  Schema.makeFilter((value: unknown) => {
    const ancestors = new Set<object>();
    let count = 0;
    const visit = (item: unknown, depth: number): boolean => {
      if (++count > 100_000 || depth > 128) return false;
      if (item === null || typeof item !== "object") return true;
      if (ancestors.has(item)) return false;
      ancestors.add(item);
      const valid = Object.values(item).every((child) => visit(child, depth + 1));
      ancestors.delete(item);
      return valid;
    };
    try {
      return (
        visit(value, 0) ||
        "Type authoring requires finite descriptors (maximum depth 128 and 100000 entries)"
      );
    } catch {
      return "Type authoring payload cannot be inspected safely";
    }
  }),
);

export const Change = finiteAuthoring.pipe(
  Schema.decodeTo(
    Schema.Union([
      Schema.TaggedStruct("Upsert", { definition: t.Definition }),
      Schema.TaggedStruct("Delete", { id: t.DefinitionId }),
    ]),
  ),
);
export type Change = typeof Change.Type;

export const Impact = Schema.Struct({
  token: Schema.String,
  change: Change,
  affectedTypes: Schema.Array(Schema.String),
  nodes: Schema.Array(
    Schema.Struct({
      graphId: Schema.String,
      nodeId: Schema.String,
      reasons: Schema.Array(Schema.String),
    }),
  ),
});
export type Impact = typeof Impact.Type;

export class StalePreviewError extends Schema.TaggedError<StalePreviewError>()(
  "StalePreviewError",
  {},
) {}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "TypeDefinitionNotFoundError",
  {
    id: t.DefinitionId,
  },
) {}

export class InvalidError extends Schema.TaggedError<InvalidError>()("InvalidTypeDefinition", {
  id: Schema.String,
  reason: Schema.String,
}) {}

const unsafeNames = new Set(["__proto__", "constructor", "prototype"]);
const safeName = (name: string) =>
  name.trim() !== "" &&
  name === name.trim() &&
  !unsafeNames.has(name) &&
  !/[\u0000-\u001f\u007f]/.test(name);

export const references = (type: t.Type): readonly string[] =>
  type._tag === "Struct" || type._tag === "Enum"
    ? [type.id]
    : type._tag === "List"
      ? references(type.item)
      : type._tag === "Option"
        ? references(type.inner)
        : [];

export const definitionReferences = (definition: t.Definition): readonly string[] =>
  (definition._tag === "Struct"
    ? definition.fields
    : definition.variants.flatMap((v) => v.fields)
  ).flatMap((field) => references(field.type));

const retagReference = (type: t.Type, id: string, tag: t.Definition["_tag"]): t.Type => {
  if ((type._tag === "Struct" || type._tag === "Enum") && type.id === id)
    return tag === "Struct" ? t.Struct(id) : t.Enum(id);
  if (type._tag === "List") return t.List(retagReference(type.item, id, tag));
  if (type._tag === "Option") return t.Option(retagReference(type.inner, id, tag));
  return type;
};

const retagDefinitionReferences = (
  definition: t.Definition,
  id: string,
  tag: t.Definition["_tag"],
): t.Definition =>
  definition._tag === "Struct"
    ? {
        ...definition,
        fields: definition.fields.map((field) => ({
          ...field,
          type: retagReference(field.type, id, tag),
        })),
      }
    : {
        ...definition,
        variants: definition.variants.map((variant) => ({
          ...variant,
          fields: variant.fields.map((field) => ({
            ...field,
            type: retagReference(field.type, id, tag),
          })),
        })),
      };

export const applyChange = (before: t.Definitions, change: Change): t.Definitions => {
  if (change._tag === "Delete") {
    const after = { ...before };
    delete after[change.id];
    return after;
  }
  const definition = change.definition;
  const previous = Object.hasOwn(before, definition.id) ? before[definition.id] : undefined;
  const after =
    previous !== undefined && previous._tag !== definition._tag
      ? Object.fromEntries(
          Object.entries(before).map(([id, item]) => [
            id,
            retagDefinitionReferences(item, definition.id, definition._tag),
          ]),
        )
      : { ...before };
  return { ...after, [definition.id]: definition };
};

/** Include both old and new dependency edges when a definition is replaced. */
export const affectedTypes = (
  id: string,
  ...registries: readonly t.Definitions[]
): readonly string[] => {
  const affected = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const definitions of registries)
      for (const definition of Object.values(definitions)) {
        if (
          !affected.has(definition.id) &&
          definitionReferences(definition).some((ref) => affected.has(ref))
        ) {
          affected.add(definition.id);
          changed = true;
        }
      }
  }
  return [...affected].sort();
};

/** Descriptor properties may be encoded in legacy String selectors. */
export const valueReferences = (value: unknown): readonly string[] => {
  const result: string[] = [];
  const pending: unknown[] = [value];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const item = pending.pop();
    if (typeof item === "string") {
      if (item.trimStart().startsWith("{")) {
        try {
          pending.push(JSON.parse(item));
        } catch {
          /* Ordinary String values are not descriptors. */
        }
      }
    } else if (item !== null && typeof item === "object" && !visited.has(item)) {
      visited.add(item);
      if ("_type" in item && typeof item._type === "string") result.push(item._type);
      if (
        "_tag" in item &&
        (item._tag === "Struct" || item._tag === "Enum") &&
        "id" in item &&
        typeof item.id === "string"
      )
        result.push(item.id);
      for (const child of Object.values(item)) pending.push(child);
    }
  }
  return result;
};

export const nodeDiagnostics = (
  node: Node.Model,
  io: NodeIO,
  definitions: t.Definitions,
): readonly string[] => {
  const reasons = new Set<string>();
  if (node.schema.package === CustomTypes.packageId) {
    const selection = CustomTypes.selectionError(node.schema.schema, node.properties, definitions);
    if (selection !== undefined) reasons.add(selection);
    else if (!CustomTypes.isOperationSchema(node.schema.schema))
      reasons.add(`Missing generated schema ${node.schema.schema}`);
  }
  const visited = new Set<string>();
  const available = new Map<string, t.Definition>(Object.entries(definitions));
  const check = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const definition = available.get(id);
    if (definition === undefined || definition.id !== id) reasons.add(`Missing type ${id}`);
    else {
      const fields =
        definition._tag === "Struct"
          ? definition.fields
          : definition.variants.flatMap((variant) => variant.fields);
      for (const field of fields) checkType(field.type);
    }
  };
  const checkType = (type: t.Type): void => {
    if (type._tag === "List") return checkType(type.item);
    if (type._tag === "Option") return checkType(type.inner);
    if (type._tag !== "Struct" && type._tag !== "Enum") return;
    if (type.definition !== undefined) available.set(type.id, type.definition);
    check(type.id);
  };
  for (const port of [
    ...io.dataInputs,
    ...io.dataOutputs,
    ...io.executionInputs.flatMap((port) => port.scope ?? []),
    ...io.executionOutputs.flatMap((port) => port.scope ?? []),
  ])
    checkType(port.type);
  for (const id of valueReferences(node.properties)) check(id);
  for (const id of valueReferences(node.inputDefaults)) check(id);
  const relevant = Object.fromEntries(
    [...visited].flatMap((id) =>
      available.get(id) !== undefined ? [[id, available.get(id)!]] : [],
    ),
  );
  for (const error of validate(relevant))
    if (!error.reason.startsWith("Unknown type"))
      reasons.add(`Invalid type ${error.id}: ${error.reason}`);
  for (const [input, value] of Object.entries(node.inputDefaults)) {
    const ports = io.dataInputs.filter((port) => port.id === input);
    if (ports.length !== 1 || io.executionInputs.some((port) => port.id === input)) {
      reasons.add(`Orphan default ${input}: input no longer exists or is ambiguous`);
      continue;
    }
    try {
      Schema.decodeUnknownSync(t.JsonValueSchema(ports[0]!.type, definitions), {
        onExcessProperty: "error",
      })(value);
    } catch {
      reasons.add(
        `Invalid default ${input}: value does not match the current input type (including obsolete fields)`,
      );
    }
  }
  return [...reasons].sort();
};

/** Validate the complete registry so mutually recursive references can be authored together. */
export const validate = (definitions: t.Definitions): ReadonlyArray<InvalidError> => {
  const errors: InvalidError[] = [];
  const names = new Set<string>();
  const checkReference = (id: string, type: t.Type): void => {
    if (type._tag === "Wildcard") {
      errors.push(
        new InvalidError({ id, reason: "Wildcards belong to node IO, not type definitions" }),
      );
    } else if (type._tag === "Struct" || type._tag === "Enum") {
      const definition = Object.hasOwn(definitions, type.id) ? definitions[type.id] : undefined;
      if (definition === undefined)
        errors.push(new InvalidError({ id, reason: `Unknown type ${type.id}` }));
      else if (definition._tag !== type._tag)
        errors.push(
          new InvalidError({
            id,
            reason: `${type.id} is an ${definition._tag}, not a ${type._tag}`,
          }),
        );
    } else if (type._tag === "List") checkReference(id, type.item);
    else if (type._tag === "Option") checkReference(id, type.inner);
  };
  for (const [id, definition] of Object.entries(definitions)) {
    if (id !== definition.id || !safeName(id)) {
      errors.push(
        new InvalidError({ id, reason: "Definition key must match its non-empty identity" }),
      );
    }
    if (!safeName(definition.name) || names.has(definition.name)) {
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
        if (!safeName(variant.name) || variants.has(variant.name)) {
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
          !safeName(field.name) ||
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
  const canTerminate = (type: t.Type): boolean =>
    (type._tag !== "Struct" && type._tag !== "Enum") || finite.has(type.id);
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

/** Deletion intentionally leaves dependents dangling; unrelated repair must remain possible. */
export const validateChange = (before: t.Definitions, change: Change): readonly InvalidError[] => {
  if (change._tag === "Delete") return [];
  if (!Schema.is(finiteAuthoring)(change))
    return [new InvalidError({ id: "", reason: "Type authoring requires finite descriptors" })];
  const definition = change.definition;
  const after = applyChange(before, change);
  const previous = new Set(validate(before).map((error) => `${error.id}\0${error.reason}`));
  const reachable = new Set<string>();
  const visit = (id: string): void => {
    if (reachable.has(id)) return;
    reachable.add(id);
    const item = Object.hasOwn(after, id) ? after[id] : undefined;
    if (item !== undefined) for (const ref of definitionReferences(item)) visit(ref);
  };
  visit(definition.id);
  const errors = validate(after).filter(
    (error) => reachable.has(error.id) || !previous.has(`${error.id}\0${error.reason}`),
  );
  if (
    Object.values(before).some((item) => item.id !== definition.id && item.name === definition.name)
  )
    errors.unshift(
      new InvalidError({ id: definition.id, reason: "Type names must be non-empty and unique" }),
    );
  return errors;
};

export * as TypeDefinition from "./TypeDefinition.ts";
