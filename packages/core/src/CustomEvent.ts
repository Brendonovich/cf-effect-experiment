import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Schema } from "effect";

import { IoId } from "./IO.ts";
import { Package } from "./Package.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

const Id = Schema.String.check(
  Schema.makeFilter(
    (id) => /^[a-zA-Z0-9_-]+$/.test(id) && !["__proto__", "constructor", "prototype"].includes(id),
  ),
);
const Name = Schema.String.check(Schema.makeFilter((name) => name.trim().length > 0));
export const Field = Schema.Struct({ id: Id, name: Name, type: DataType.Descriptor });
export const Model = Schema.Struct({ id: Id, name: Name, fields: Schema.Array(Field) }).check(
  Schema.makeFilter(
    (event) =>
      new Set(event.fields.map((field) => field.id)).size === event.fields.length &&
      new Set(event.fields.map((field) => field.name.trim().toLowerCase())).size ===
        event.fields.length,
  ),
);
export type Model = typeof Model.Type;
export const Collection = Schema.Record(Id, Model)
  .check(
    Schema.makeFilter(
      (events) =>
        Object.entries(events).every(([id, event]) => id === event.id) &&
        new Set(Object.values(events).map((event) => event.name.trim().toLowerCase())).size ===
          Object.keys(events).length,
    ),
  )
  .pipe(Schema.withDecodingDefaultKey(Effect.succeed({})));
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("CustomEventNotFoundError", {
  id: Schema.String,
}) {}
export class InvalidError extends Schema.TaggedError<InvalidError>()("InvalidCustomEvent", {
  reason: Schema.String,
}) {}
export class InUseError extends Schema.TaggedError<InUseError>()("CustomEventInUse", {
  id: Schema.String,
}) {}

export const packageId = PackageId.make("project-events");
export const schemaId = (id: string, kind: "emit" | "on") => SchemaId.make(`${kind}:${id}`);
export const fieldId = (id: string) => IoId.make(`field:${id}`);
export const schemas = (event: Model): ReadonlyArray<Package.SchemaModel> =>
  (["emit", "on"] as const).map((kind) => ({
    id: schemaId(event.id, kind),
    name: `${kind === "emit" ? "Emit" : "On"} ${event.name}`,
    description:
      kind === "emit"
        ? "Launch independent project event handlers without waiting for them."
        : "Receive this project's custom event in a new execution.",
    type: kind === "emit" ? "exec" : "event",
    properties: [],
    dataInputs:
      kind === "emit" ? event.fields.map((field) => ({ ...field, id: fieldId(field.id) })) : [],
    dataOutputs:
      kind === "on" ? event.fields.map((field) => ({ ...field, id: fieldId(field.id) })) : [],
    executionInputs: kind === "emit" ? [{ id: IoId.make("exec") }] : [],
    executionOutputs: [{ id: IoId.make("exec") }],
  }));
export const packageModel = (events: Readonly<Record<string, Model>>): Package.Model => ({
  id: packageId,
  name: "Project Events",
  resources: [],
  schemas: Object.values(events).flatMap(schemas),
});

export * as CustomEvent from "./CustomEvent.ts";
