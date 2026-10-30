import { Effect, Option, Schema } from "effect";

import * as t from "./DataType.ts";

/** Types a conversion can be registered between. Containers are lifted automatically. */
export type Endpoint = t.Scalar | t.Struct | t.Enum;

/** A directional conversion without its implementation; safe to send to the browser. */
export interface Pair {
  readonly from: t.Type;
  readonly to: t.Type;
}

export const Pair = Schema.Struct({ from: t.Descriptor, to: t.Descriptor });

/**
 * A directional conversion. Values reaching `convert` were already validated against `from`
 * by their producer; the executor validates the converted value against the connected input.
 */
export interface Conversion extends Pair {
  // Method syntax keeps typed implementations assignable without casts.
  convert(value: unknown): Effect.Effect<unknown, unknown>;
}

export interface Definition<From extends Endpoint, To extends Endpoint> {
  readonly from: From;
  readonly to: To;
  readonly convert: (value: t.Value<From>) => Effect.Effect<t.Value<To>, unknown>;
}

export const make = <From extends Endpoint, To extends Endpoint>(
  definition: Definition<From, To>,
): Conversion => ({
  from: definition.from,
  to: definition.to,
  convert: definition.convert,
});

/** Core conversions. They always apply; modules cannot register scalar-to-scalar conversions. */
export const defaults: ReadonlyArray<Conversion> = [
  make({ from: t.Int, to: t.Float, convert: (value) => Effect.succeed(value) }),
  make({ from: t.Int, to: t.String, convert: (value) => Effect.succeed(String(value)) }),
  make({ from: t.Float, to: t.String, convert: (value) => Effect.succeed(String(value)) }),
  make({ from: t.Bool, to: t.String, convert: (value) => Effect.succeed(String(value)) }),
];

const isEndpoint = (type: t.Type): type is Endpoint =>
  type._tag === "String" ||
  type._tag === "Int" ||
  type._tag === "Float" ||
  type._tag === "Bool" ||
  type._tag === "Struct" ||
  type._tag === "Enum";

const endpointKey = (type: t.Type) =>
  type._tag === "Struct" || type._tag === "Enum" ? `${type._tag}:${type.id}` : type._tag;

const pairKey = (from: t.Type, to: t.Type) => `${endpointKey(from)}->${endpointKey(to)}`;

const describe = (type: t.Type) =>
  type._tag === "Struct" || type._tag === "Enum" ? type.id : type._tag;

export const describePair = (pair: Pair) => `${describe(pair.from)} -> ${describe(pair.to)}`;

/** Connection rules: equal types, registered pairs, and List/Option lifting of either. */
export interface Rules {
  readonly pairs: ReadonlyArray<Pair>;
  readonly has: (from: t.Type, to: t.Type) => boolean;
}

/** Rules plus implementations, for execution. */
export interface Registry extends Rules {
  readonly find: (from: t.Type, to: t.Type) => Conversion | undefined;
}

const lift = <A>(
  from: t.Type,
  to: t.Type,
  scalar: (from: t.Type, to: t.Type) => A | undefined,
  equal: (type: t.Type) => A,
  list: (item: A) => A,
  option: (inner: A) => A,
): A | undefined => {
  const go = (from: t.Type, to: t.Type): A | undefined => {
    if (t.equals(from, to)) return equal(from);
    if (from._tag === "List" && to._tag === "List") {
      const item = go(from.item, to.item);
      return item === undefined ? undefined : list(item);
    }
    if (from._tag === "Option" && to._tag === "Option") {
      const inner = go(from.inner, to.inner);
      return inner === undefined ? undefined : option(inner);
    }
    return scalar(from, to);
  };
  return go(from, to);
};

/** Assumes `pairs` has no duplicates; use `duplicate` to check contributions first. */
export const rules = (pairs: ReadonlyArray<Pair>): Rules => {
  const keys = new Set(pairs.map((pair) => pairKey(pair.from, pair.to)));
  return {
    pairs,
    has: (from, to) =>
      lift(
        from,
        to,
        (from, to) => (keys.has(pairKey(from, to)) ? true : undefined),
        () => true,
        () => true,
        () => true,
      ) ?? false,
  };
};

/** Assumes `conversions` has no duplicates; use `duplicate` to check contributions first. */
export const registry = (conversions: ReadonlyArray<Conversion>): Registry => {
  const byKey = new Map(conversions.map((rule) => [pairKey(rule.from, rule.to), rule]));
  const find = (from: t.Type, to: t.Type) =>
    lift<Conversion>(
      from,
      to,
      (from, to) => byKey.get(pairKey(from, to)),
      (type) => ({ from: type, to: type, convert: (value) => Effect.succeed(value) }),
      (item) => ({
        from,
        to,
        convert: (value) =>
          Array.isArray(value)
            ? Effect.forEach(value, (entry: unknown) => item.convert(entry))
            : Effect.fail(new TypeError("Expected a list")),
      }),
      (inner) => ({
        from,
        to,
        convert: (value) =>
          Option.isOption(value) && Option.isSome(value)
            ? Effect.map(inner.convert(value.value), Option.some)
            : Effect.succeed(Option.none()),
      }),
    );
  return { ...rules(conversions), find };
};

export const defaultRules = rules(defaults);

/** Same-type matching is unchanged; registered directional conversions are the only addition. */
export const connectable = (from: t.Type, to: t.Type, conversions: Rules): boolean =>
  t.compatible(from, to) || conversions.has(from, to);

/** The namespace a module's declared type IDs must use. */
export const namespace = (moduleId: string) => `${moduleId}/`;

/**
 * Checks a module's declarations: type IDs must be namespaced by the module, and every
 * conversion must have at least one endpoint that is a type the module declares.
 */
export const validateModule = (
  moduleId: string,
  types: t.Definitions,
  conversions: ReadonlyArray<Pair>,
): string | undefined => {
  for (const id of Object.keys(types))
    if (!id.startsWith(namespace(moduleId)) || id.length === namespace(moduleId).length)
      return `Module ${moduleId} declares type ${id} outside its namespace ${namespace(moduleId)}`;
  const owns = (type: t.Type) =>
    (type._tag === "Struct" || type._tag === "Enum") &&
    Object.hasOwn(types, type.id) &&
    types[type.id]!._tag === type._tag;
  for (const pair of conversions) {
    if (!isEndpoint(pair.from) || !isEndpoint(pair.to))
      return `Module ${moduleId} registers conversion ${describePair(pair)} with an unsupported type`;
    if (!owns(pair.from) && !owns(pair.to))
      return `Module ${moduleId} registers conversion ${describePair(pair)} without declaring either type`;
  }
  return undefined;
};

export interface Contribution {
  readonly owner: string;
  readonly pairs: ReadonlyArray<Pair>;
}

/** The first pair registered more than once across all contributions, described for errors. */
export const duplicate = (contributions: ReadonlyArray<Contribution>): string | undefined => {
  const owners = new Map<string, string>();
  for (const { owner, pairs } of contributions)
    for (const pair of pairs) {
      const key = pairKey(pair.from, pair.to);
      const existing = owners.get(key);
      if (existing !== undefined)
        return `Conversion ${describePair(pair)} is registered by both ${existing} and ${owner}`;
      owners.set(key, owner);
    }
  return undefined;
};
