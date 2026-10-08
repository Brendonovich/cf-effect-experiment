import { Context, Effect, Layer, Option } from "effect";

import * as t from "./DataType.ts";

/**
 * A consumer-provided, directional conversion between two scalar types. Values reaching
 * `convert` were already validated against `from` by their producer; the executor validates
 * the converted value against the connected input type.
 */
export interface Conversion {
  readonly from: t.Type;
  readonly to: t.Type;
  // Method syntax keeps typed consumer functions assignable without casts.
  convert(value: unknown): Effect.Effect<unknown, unknown>;
}

export interface Definition<From extends t.Scalar, To extends t.Scalar> {
  readonly from: From;
  readonly to: To;
  readonly convert: (value: t.Value<From>) => Effect.Effect<t.Value<To>, unknown>;
}

/** Scalar-only authoring API. The rule is used as-is; container lifting is derived by `Registry`. */
export const make = <From extends t.Scalar, To extends t.Scalar>(
  definition: Definition<From, To>,
): Conversion => ({
  from: definition.from,
  to: definition.to,
  convert: definition.convert,
});

export interface Registry {
  readonly rules: ReadonlyArray<Conversion>;
  /**
   * The conversion from `from` to `to`, or undefined when none is registered. Equal types
   * have an identity conversion; `List` and `Option` lift their item's rule element-wise.
   */
  readonly find: (from: t.Type, to: t.Type) => Conversion | undefined;
}

const identity = (type: t.Type): Conversion => ({
  from: type,
  to: type,
  convert: (value) => Effect.succeed(value),
});

/** Throws on a duplicate scalar (from, to) pair. Rules have no precedence. */
export const registry = (rules: ReadonlyArray<Conversion>): Registry => {
  const scalar = new Map<string, Conversion>();
  for (const rule of rules) {
    const key = `${rule.from._tag}->${rule.to._tag}`;
    if (scalar.has(key)) throw new Error(`Duplicate conversion ${key}`);
    scalar.set(key, rule);
  }
  const find = (from: t.Type, to: t.Type): Conversion | undefined => {
    if (t.equals(from, to)) return identity(from);
    if (from._tag === "List" && to._tag === "List") {
      const item = find(from.item, to.item);
      return item === undefined
        ? undefined
        : {
            from,
            to,
            convert: (value) =>
              Array.isArray(value)
                ? Effect.forEach(value, (entry: unknown) => item.convert(entry))
                : Effect.fail(new TypeError("Expected a list")),
          };
    }
    if (from._tag === "Option" && to._tag === "Option") {
      const inner = find(from.inner, to.inner);
      return inner === undefined
        ? undefined
        : {
            from,
            to,
            convert: (value) =>
              Option.isOption(value) && Option.isSome(value)
                ? Effect.map(inner.convert(value.value), Option.some)
                : Effect.succeed(Option.none()),
          };
    }
    return scalar.get(`${from._tag}->${to._tag}`);
  };
  return { rules, find };
};

export const empty = registry([]);

/** Same-type matching is unchanged; a registered directional conversion is the only addition. */
export const connectable = (from: t.Type, to: t.Type, conversions: Registry): boolean =>
  t.compatible(from, to) || conversions.find(from, to) !== undefined;

export class Service extends Context.Service<Service, Registry>()(
  "@macrograph/module/Conversion",
) {}

export const layer = (conversions: Registry) => Layer.succeed(Service)(conversions);
