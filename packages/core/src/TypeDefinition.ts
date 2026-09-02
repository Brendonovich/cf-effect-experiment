import { DataType } from "@macrograph/plugin/DataType";
import { Schema } from "effect";

import type { NodeIO } from "./IO.ts";
import type { Node } from "./Node.ts";

import { CustomTypes } from "./CustomTypes.ts";

export const Collection = DataType.Definitions;

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
      Schema.TaggedStruct("Upsert", { definition: DataType.Definition }),
      Schema.TaggedStruct("Delete", { id: DataType.DefinitionId }),
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
    id: DataType.DefinitionId,
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

export const references = (type: DataType.Any): readonly string[] =>
  type._tag === "Custom"
    ? [type.id]
    : type._tag === "List"
      ? references(type.item)
      : type._tag === "Option"
        ? references(type.inner)
        : [];

export const definitionReferences = (definition: DataType.Definition): readonly string[] =>
  (definition._tag === "Struct"
    ? definition.fields
    : definition.variants.flatMap((v) => v.fields)
  ).flatMap((field) => references(field.type));

/** Include both old and new dependency edges when a definition is replaced. */
export const affectedTypes = (
  id: string,
  ...registries: readonly DataType.Definitions[]
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
      if ("_tag" in item && item._tag === "Custom" && "id" in item && typeof item.id === "string")
        result.push(item.id);
      for (const child of Object.values(item)) pending.push(child);
    }
  }
  return result;
};

export const nodeDiagnostics = (
  node: Node.Model,
  io: NodeIO,
  definitions: DataType.Definitions,
): readonly string[] => {
  const reasons = new Set<string>();
  if (
    node.schema.package === CustomTypes.packageId &&
    CustomTypes.nodeIO(node.schema, node.properties, definitions) === undefined
  )
    reasons.add(`Missing generated schema ${node.schema.schema}`);
  const visited = new Set<string>();
  const check = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const definition = Object.hasOwn(definitions, id) ? definitions[id] : undefined;
    if (definition === undefined || definition.id !== id) reasons.add(`Missing type ${id}`);
    else for (const ref of definitionReferences(definition)) check(ref);
  };
  for (const port of [...io.dataInputs, ...io.dataOutputs])
    for (const id of references(port.type)) check(id);
  for (const id of valueReferences(node.properties)) check(id);
  for (const id of valueReferences(node.inputDefaults)) check(id);
  const relevant = Object.fromEntries(
    [...visited].flatMap((id) =>
      Object.hasOwn(definitions, id) && definitions[id] !== undefined
        ? [[id, definitions[id]!]]
        : [],
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
      Schema.decodeUnknownSync(DataType.JsonValueSchema(ports[0]!.type, definitions), {
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

/** Deletion intentionally leaves dependents dangling; unrelated repair must remain possible. */
export const validateChange = (
  before: DataType.Definitions,
  change: Change,
): readonly InvalidError[] => {
  if (change._tag === "Delete") return [];
  if (!Schema.is(finiteAuthoring)(change))
    return [new InvalidError({ id: "", reason: "Type authoring requires finite descriptors" })];
  const definition = change.definition;
  const after = { ...before, [definition.id]: definition };
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
