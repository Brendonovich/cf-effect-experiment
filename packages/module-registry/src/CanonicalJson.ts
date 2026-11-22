export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json | undefined };

const isArray = (value: Json): value is ReadonlyArray<Json> => Array.isArray(value);

const compareKeys = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Serializes JSON with object keys sorted by UTF-16 code units and no whitespace, so equal
 * values always produce identical bytes. Object properties set to `undefined` are omitted.
 */
export const stringify = (value: Json): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON numbers must be finite");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (isArray(value)) return `[${value.map(stringify).join(",")}]`;
  const object = value;
  const members = Object.keys(object)
    .sort(compareKeys)
    .flatMap((key) => {
      const member = object[key];
      return member === undefined ? [] : [`${JSON.stringify(key)}:${stringify(member)}`];
    });
  return `{${members.join(",")}}`;
};

const encoder = new TextEncoder();

export const encode = (value: Json): Uint8Array<ArrayBuffer> => encoder.encode(stringify(value));

export * as CanonicalJson from "./CanonicalJson.ts";
