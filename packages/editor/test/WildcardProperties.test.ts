import { describe, expect, it } from "@effect/vitest";
import { Connection, IoId, OutputRef, Wildcards } from "@macrograph/core";
import { t } from "@macrograph/module";
import { Result } from "effect";
import { FastCheck as fc } from "effect/testing";

// Property tests for `Wildcards.Cache`. Graphs are generated from a small palette of node
// shapes. Chains are built around a chosen concrete type so the expected resolution of
// every wildcard is known in advance; random graphs use invariants that need no oracle.
// Behaviour with a small, fixed input space is covered by exhaustive table tests instead.

const fastCheck = {
  numRuns: Number(process.env.FC_NUM_RUNS ?? 200),
  seed: process.env.FC_SEED === undefined ? 0x77c4 : Number(process.env.FC_SEED),
};

const T = t.Wildcard("T");
const U = t.Wildcard("U");

const io = (
  inputs: ReadonlyArray<readonly [string, t.Type]>,
  outputs: ReadonlyArray<readonly [string, t.Type]>,
): Wildcards.IO => ({
  dataInputs: inputs.map(([id, type]) => ({ id, type })),
  dataOutputs: outputs.map(([id, type]) => ({ id, type })),
  executionInputs: [],
  executionOutputs: [],
});

type Hop = "pass" | "wrapList" | "unwrapList" | "wrapOption" | "unwrapOption" | "pair";

// Every hop has an `in` and an `out` port and declares the wildcard `T`.
const hopIO = (hop: Hop): Wildcards.IO => {
  switch (hop) {
    case "pass":
      return io([["in", T]], [["out", T]]);
    case "wrapList":
      return io([["in", T]], [["out", t.List(T)]]);
    case "unwrapList":
      return io([["in", t.List(T)]], [["out", T]]);
    case "wrapOption":
      return io([["in", T]], [["out", t.Option(T)]]);
    case "unwrapOption":
      return io([["in", t.Option(T)]], [["out", T]]);
    case "pair":
      // A second, independent wildcard on the same node must never be constrained by `T`.
      return io(
        [
          ["in", T],
          ["side", U],
        ],
        [
          ["out", T],
          ["sideOut", U],
        ],
      );
  }
};

const sourceIO = (type: t.Type) => io([], [["out", type]]);
const sinkIO = (type: t.Type) => io([["in", type]], []);

const wire = (
  from: string,
  to: string,
  outPort = "out",
  inPort = "in",
  suffix = "",
): Connection.Model => ({
  id: Connection.ConnectionId.make(`${from}:${outPort}->${to}:${inPort}${suffix}`),
  outNodeId: from,
  outIo: OutputRef.port(outPort),
  inNodeId: to,
  inIoId: IoId.make(inPort),
});

const leafTypes = [t.String, t.Int, t.Float, t.Bool, t.DateTime] as const;
const concreteType: fc.Arbitrary<t.Type> = fc.letrec<{ type: t.Type }>((tie) => ({
  type: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constantFrom<t.Type>(...leafTypes),
    fc.constantFrom<t.Type>(t.Struct("a"), t.Struct("b"), t.Enum("a")),
    tie("type").map((item) => t.List(item)),
    tie("type").map((inner) => t.Option(inner)),
  ),
})).type;

/** Type flowing out of a hop, given the type flowing into it, or undefined if impossible. */
const step = (
  hop: Hop,
  input: t.Type,
): { readonly T: t.Type; readonly out: t.Type } | undefined => {
  switch (hop) {
    case "pass":
    case "pair":
      return { T: input, out: input };
    case "wrapList":
      return { T: input, out: t.List(input) };
    case "wrapOption":
      return { T: input, out: t.Option(input) };
    case "unwrapList":
      return input._tag === "List" ? { T: input.item, out: input.item } : undefined;
    case "unwrapOption":
      return input._tag === "Option" ? { T: input.inner, out: input.inner } : undefined;
  }
};

interface Chain {
  readonly hops: ReadonlyArray<Hop>;
  /** Concrete type entering the first hop. */
  readonly entry: t.Type;
  /** Expected resolution of each hop's `T`, and the type on each hop's output. */
  readonly expected: ReadonlyArray<{ readonly T: t.Type; readonly out: t.Type }>;
}

const hopArb = fc.constantFrom<Hop>(
  "pass",
  "wrapList",
  "unwrapList",
  "wrapOption",
  "unwrapOption",
  "pair",
);

// Unwraps that cannot apply to the current type are replaced by the matching wrap, so every
// generated chain is satisfiable and its expected types are known.
const chainArb: fc.Arbitrary<Chain> = fc
  .record({ entry: concreteType, hops: fc.array(hopArb, { minLength: 1, maxLength: 6 }) })
  .map(({ entry, hops }) => {
    const fixed: Hop[] = [];
    const expected: Array<{ T: t.Type; out: t.Type }> = [];
    let current = entry;
    for (const requested of hops) {
      const hop =
        step(requested, current) !== undefined
          ? requested
          : requested === "unwrapList"
            ? "wrapList"
            : "wrapOption";
      const next = step(hop, current)!;
      fixed.push(hop);
      expected.push(next);
      current = next.out;
    }
    return { hops: fixed, entry, expected };
  });

const hopId = (index: number) => `hop${index}`;

const chainGraph = (chain: Chain) => {
  const declarations = new Map<string, Wildcards.IO>(
    chain.hops.map((hop, index) => [hopId(index), hopIO(hop)]),
  );
  const wires = chain.hops.slice(1).map((_, index) => wire(hopId(index), hopId(index + 1)));
  return { declarations, wires };
};

type Anchor = "source" | "sink" | "tap";

/** Concrete anchors placed at the chain start, end, or tapped off a middle hop. */
const anchorChain = (chain: Chain, anchors: ReadonlyArray<{ kind: Anchor; at: number }>) => {
  const { declarations, wires } = chainGraph(chain);
  const last = chain.hops.length - 1;
  for (const [index, anchor] of anchors.entries()) {
    const id = `anchor${index}`;
    if (anchor.kind === "source") {
      declarations.set(id, sourceIO(chain.entry));
      wires.push(wire(id, hopId(0)));
    } else {
      const at = anchor.kind === "sink" ? last : anchor.at % chain.hops.length;
      declarations.set(id, sinkIO(chain.expected[at]!.out));
      wires.push(wire(hopId(at), id));
    }
  }
  return { declarations, wires };
};

const anchorArb = fc.record({
  kind: fc.constantFrom<Anchor>("source", "sink", "tap"),
  at: fc.nat(),
});

const solve = (declarations: ReadonlyMap<string, Wildcards.IO>, wires: Connection.Model[]) => {
  const cache = new Wildcards.Cache();
  return { cache, result: cache.update(declarations, wires) };
};

/** Every declared wildcard in the graph, as (node, declared type) pairs. */
const wildcardTerms = (declarations: ReadonlyMap<string, Wildcards.IO>) =>
  [...declarations].flatMap(([node, ports]) =>
    [...ports.dataInputs, ...ports.dataOutputs]
      .filter((port) => t.hasWildcard(port.type))
      .map((port) => ({ node, type: port.type })),
  );

/**
 * Compare the resolution of all wildcard terms between two caches. Concrete resolutions
 * must be equal. Unresolved wildcards are compared by which terms share a type, because the
 * representative wildcard ID of an unresolved group is an implementation detail.
 */
const expectSameResolution = (
  declarations: ReadonlyMap<string, Wildcards.IO>,
  a: Wildcards.Cache,
  b: Wildcards.Cache,
) => {
  const terms = wildcardTerms(declarations);
  const left = terms.map(({ node, type }) => a.resolve(node, type));
  const right = terms.map(({ node, type }) => b.resolve(node, type));
  for (const [index, type] of left.entries()) {
    expect(t.hasWildcard(type)).toBe(t.hasWildcard(right[index]!));
    if (!t.hasWildcard(type)) expect(type).toEqual(right[index]);
  }
  for (let i = 0; i < terms.length; i++)
    for (let j = i + 1; j < terms.length; j++)
      expect(t.equals(left[i]!, left[j]!)).toBe(t.equals(right[i]!, right[j]!));
};

const shuffle = <A>(items: ReadonlyArray<A>, keys: ReadonlyArray<number>) =>
  items
    .map((item, index) => ({ item, key: keys[index % Math.max(keys.length, 1)] ?? 0, index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map(({ item }) => item);

describe("wildcard resolution properties", () => {
  it.prop(
    "propagates a concrete anchor through every hop of a chain, wherever the anchor sits",
    [chainArb, fc.array(anchorArb, { minLength: 1, maxLength: 3 })],
    ([chain, anchors]) => {
      const { declarations, wires } = anchorChain(chain, anchors);
      const { cache, result } = solve(declarations, wires);
      expect(Result.isSuccess(result)).toBe(true);
      for (const [index, expected] of chain.expected.entries()) {
        const id = hopId(index);
        expect(cache.resolve(id, T)).toEqual(expected.T);
        const resolved = cache.resolveIO(id, declarations.get(id)!);
        for (const port of [...resolved.dataInputs, ...resolved.dataOutputs])
          if (port.id === "in" || port.id === "out") expect(t.hasWildcard(port.type)).toBe(false);
        // An independent wildcard on a pair node is not constrained by `T`.
        if (chain.hops[index] === "pair") expect(cache.resolve(id, U)).toEqual(U);
      }
    },
    { fastCheck },
  );

  it.prop(
    "accepts a chain without concrete anchors and leaves its wildcards unresolved",
    [chainArb],
    ([chain]) => {
      const { declarations, wires } = chainGraph(chain);
      const { cache, result } = solve(declarations, wires);
      expect(Result.isSuccess(result)).toBe(true);
      for (const index of chain.hops.keys())
        expect(t.hasWildcard(cache.resolve(hopId(index), T))).toBe(true);
    },
    { fastCheck },
  );

  it.prop(
    "rejects a chain whose anchors disagree, in any connection order, without changing the cache",
    [chainArb, fc.nat(), concreteType, fc.array(fc.double({ noNaN: true }))],
    ([chain, at, wrong, keys]) => {
      const tap = at % chain.hops.length;
      fc.pre(!t.equals(wrong, chain.expected[tap]!.out));
      const { declarations, wires } = anchorChain(chain, [{ kind: "source", at: 0 }]);
      declarations.set("conflict", sinkIO(wrong));
      wires.push(wire(hopId(tap), "conflict"));

      const cache = new Wildcards.Cache();
      const valid = anchorChain(chain, [{ kind: "source", at: 0 }]);
      expect(Result.isSuccess(cache.update(valid.declarations, valid.wires))).toBe(true);
      const groups = [...cache.groups];
      const before = chain.hops.map((_, index) => cache.resolve(hopId(index), T));

      expect(Result.isFailure(cache.update(declarations, shuffle(wires, keys)))).toBe(true);
      expect([...cache.groups]).toEqual(groups);
      expect(chain.hops.map((_, index) => cache.resolve(hopId(index), T))).toEqual(before);
    },
    { fastCheck },
  );

  it("rejects nominal mismatches and primitives reaching constrained custom-type wildcards", () => {
    const cases: ReadonlyArray<{
      constraint: string;
      accepted: ReadonlyArray<t.Type>;
      rejected: ReadonlyArray<t.Type>;
    }> = [
      { constraint: "Struct", accepted: [t.Struct("a")], rejected: [t.Enum("a"), t.Int] },
      { constraint: "Enum", accepted: [t.Enum("a")], rejected: [t.Struct("a"), t.String] },
      {
        constraint: "Type",
        accepted: [t.Struct("a"), t.Enum("a")],
        rejected: [t.Bool, t.List(t.Struct("a"))],
      },
    ];
    for (const { constraint, accepted, rejected } of cases)
      for (const length of [0, 1, 3]) {
        // source -> `length` pass hops -> constrained sink
        const hops = Array.from({ length }, (_, index) => hopId(index));
        const declarations = new Map<string, Wildcards.IO>([
          ...hops.map((id) => [id, hopIO("pass")] as const),
          ["constrained", sinkIO(t.Wildcard(constraint))],
        ]);
        const path = ["source", ...hops, "constrained"];
        const wires = path.slice(1).map((to, index) => wire(path[index]!, to));
        for (const type of [...accepted, ...rejected]) {
          const result = solve(new Map(declarations).set("source", sourceIO(type)), wires).result;
          expect(Result.isSuccess(result), `${constraint} via ${length} hops <- ${type._tag}`).toBe(
            accepted.includes(type),
          );
        }
      }
  });

  it("links a Type-constrained wildcard to a narrower Struct or Enum wildcard", () => {
    for (const narrow of ["Struct", "Enum"] as const)
      for (const typeFirst of [true, false])
        for (const viaPass of [true, false]) {
          const declarations = new Map<string, Wildcards.IO>([
            ["type", io([["in", t.Wildcard("Type")]], [["out", t.Wildcard("Type")]])],
            ["narrow", io([["in", t.Wildcard(narrow)]], [["out", t.Wildcard(narrow)]])],
            ["pass", hopIO("pass")],
          ]);
          const [first, second] = typeFirst ? ["type", "narrow"] : ["narrow", "type"];
          const wires = viaPass
            ? [wire(first, "pass"), wire("pass", second)]
            : [wire(first, second)];
          expect(Result.isSuccess(solve(declarations, wires).result)).toBe(true);

          const concrete = narrow === "Struct" ? t.Struct("a") : t.Enum("a");
          const other = narrow === "Struct" ? t.Enum("a") : t.Struct("a");
          for (const [type, ok] of [
            [concrete, true],
            [other, false],
          ] as const) {
            const anchored = new Map(declarations).set("source", sourceIO(type));
            const { cache, result } = solve(anchored, [...wires, wire("source", first)]);
            expect(Result.isSuccess(result)).toBe(ok);
            if (ok) expect(cache.resolve("type", t.Wildcard("Type"))).toEqual(type);
          }
        }
  });

  // Random graphs mixing every node shape, sources and sinks, with arbitrary topology
  // (fan-in, fan-out, diamonds and cycles).
  const graphArb = fc
    .record({
      nodes: fc.array(
        fc.oneof(
          hopArb.map((hop) => hopIO(hop)),
          concreteType.map(sourceIO),
          concreteType.map(sinkIO),
        ),
        { minLength: 2, maxLength: 7 },
      ),
      edges: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), side: fc.boolean() }), {
        minLength: 1,
        maxLength: 10,
      }),
    })
    .map(({ nodes, edges }) => {
      const declarations = new Map(nodes.map((ports, index) => [`n${index}`, ports]));
      const wires = edges.map(({ from, to, side }, index) => {
        const source = `n${from % nodes.length}`,
          target = `n${to % nodes.length}`;
        const pair = (id: string) => declarations.get(id)!.dataInputs.some((p) => p.id === "side");
        return side && pair(source) && pair(target)
          ? wire(source, target, "sideOut", "side", `#${index}`)
          : wire(source, target, "out", "in", `#${index}`);
      });
      return { declarations, wires };
    });

  it.prop(
    "gives the same verdict and resolution regardless of connection order",
    [graphArb, fc.array(fc.double({ noNaN: true }), { minLength: 1 })],
    ([{ declarations, wires }, keys]) => {
      const a = solve(declarations, wires);
      const b = solve(new Map(shuffle([...declarations], keys)), shuffle(wires, keys));
      expect(a.result._tag).toBe(b.result._tag);
      if (Result.isSuccess(a.result)) expectSameResolution(declarations, a.cache, b.cache);
    },
    { fastCheck },
  );

  it.prop(
    "resolves both ends of every accepted data connection to the same type",
    [graphArb],
    ([{ declarations, wires }]) => {
      const { cache, result } = solve(declarations, wires);
      fc.pre(Result.isSuccess(result));
      for (const connection of wires) {
        const output = declarations
          .get(connection.outNodeId)!
          .dataOutputs.find((port) => port.id === OutputRef.parentId(connection.outIo));
        const input = declarations
          .get(connection.inNodeId)!
          .dataInputs.find((port) => port.id === connection.inIoId);
        if (output === undefined || input === undefined) continue;
        if (!t.hasWildcard(output.type) && !t.hasWildcard(input.type)) continue;
        expect(cache.resolve(connection.outNodeId, output.type)).toEqual(
          cache.resolve(connection.inNodeId, input.type),
        );
      }
    },
    { fastCheck },
  );

  it.prop(
    "incremental updates agree with a fresh solve and rejected updates change nothing",
    [fc.array(graphArb, { minLength: 1, maxLength: 6 })],
    ([snapshots]) => {
      const cache = new Wildcards.Cache();
      for (const { declarations, wires } of snapshots) {
        const groups = [...cache.groups];
        const result = cache.update(declarations, wires);
        const fresh = solve(declarations, wires);
        expect(result._tag).toBe(fresh.result._tag);
        if (Result.isFailure(result)) {
          expect([...cache.groups]).toEqual(groups);
          continue;
        }
        expectSameResolution(declarations, cache, fresh.cache);
      }
    },
    { fastCheck },
  );
});
