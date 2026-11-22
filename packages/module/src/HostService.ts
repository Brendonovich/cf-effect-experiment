import { Schema } from "effect";

export const ids = ["http-client", "file-system", "socket", "crypto", "credentials"] as const;

export const Id = Schema.Literals(ids);
export type Id = typeof Id.Type;

export const is = Schema.is(Id);

/** Required services the host does not offer. */
export const missing = (
  required: ReadonlyArray<Id>,
  available: ReadonlyArray<Id> | ReadonlySet<Id>,
): ReadonlyArray<Id> => {
  const offered = new Set(available);
  return required.filter((id) => !offered.has(id));
};

export * as HostService from "./HostService.ts";
