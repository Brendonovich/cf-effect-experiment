import { Schema } from "effect";

const forbidden = /^(?:__proto__|constructor|prototype)$/;

/** A string that is safe to use with computed property assignment on ordinary objects. */
export const SafeObjectKey = Schema.String.check(
  Schema.makeFilter((value) => !forbidden.test(value), {
    expected: "a key other than __proto__, constructor, or prototype",
  }),
);
export type SafeObjectKey = typeof SafeObjectKey.Type;
