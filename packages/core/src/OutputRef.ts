import type { DataType } from "@macrograph/module/DataType";
import type { ScopeField } from "@macrograph/module/Registration";

import { Schema } from "effect";

import { IoId } from "./IO.ts";

export const Model = Schema.Union([
  Schema.TaggedStruct("Port", { id: IoId }),
  Schema.TaggedStruct("ScopeExec", { scope: IoId }),
  Schema.TaggedStruct("ScopeField", { scope: IoId, field: IoId }),
]);
export type Model = typeof Model.Type;

export const port = (id: string): Model => ({ _tag: "Port", id: IoId.make(id) });
export const scopeExec = (scope: string): Model => ({ _tag: "ScopeExec", scope: IoId.make(scope) });
export const scopeField = (scope: string, field: string): Model => ({
  _tag: "ScopeField",
  scope: IoId.make(scope),
  field: IoId.make(field),
});
export const parentId = (ref: Model) => (ref._tag === "Port" ? ref.id : ref.scope);
/** A collision-free UI/cache key, not a persisted port ID. */
export const key = (ref: Model): string =>
  ref._tag === "Port"
    ? JSON.stringify([ref._tag, ref.id])
    : JSON.stringify(
        ref._tag === "ScopeExec" ? [ref._tag, ref.scope] : [ref._tag, ref.scope, ref.field],
      );
export const equals = (a: Model, b: Model) => key(a) === key(b);

interface ExecutionPort {
  readonly id: string;
  readonly name?: string | undefined;
  readonly scope?: ReadonlyArray<ScopeField> | null | undefined;
}
interface DataPort {
  readonly id: string;
  readonly name?: string | undefined;
  readonly type: DataType.Any;
}
export interface IO {
  readonly dataOutputs: ReadonlyArray<DataPort>;
  readonly executionOutputs: ReadonlyArray<ExecutionPort>;
}
export type Resolved =
  | { readonly kind: "data"; readonly port: DataPort }
  | { readonly kind: "execution"; readonly port: ExecutionPort };

/** Resolve against the declaration, independently of the node's display mode. */
export const resolve = (io: IO, ref: Model): Resolved | undefined => {
  const id = parentId(ref);
  const exec = io.executionOutputs.filter((port) => port.id === id);
  const data = io.dataOutputs.filter((port) => port.id === id);
  if (exec.length + data.length !== 1) return;
  if (ref._tag === "Port")
    return data[0] ? { kind: "data", port: data[0] } : { kind: "execution", port: exec[0]! };
  const scope = exec[0];
  if (scope?.scope == null) return;
  if (ref._tag === "ScopeExec")
    return {
      kind: "execution",
      port: { id, ...(scope.name === undefined ? {} : { name: scope.name }) },
    };
  const fields = scope.scope.filter((field) => field.id === ref.field);
  if (fields.length === 1) return { kind: "data", port: fields[0]! };
};
