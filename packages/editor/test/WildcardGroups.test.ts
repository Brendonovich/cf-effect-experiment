import { describe, expect, it } from "@effect/vitest";
import { Connection, IoId, OutputRef, Wildcards } from "@macrograph/core";
import { DataType as t } from "@macrograph/module/DataType";
import { Result, Schema } from "effect";

const w = t.Wildcard("T");
const io = (type: t.Any): Wildcards.IO => ({
  dataInputs: [{ id: "in", type }],
  dataOutputs: [{ id: "out", type }],
  executionInputs: [],
  executionOutputs: [],
});
const wire = (id: string, from: string, to: string): Connection.Model => ({
  id: Connection.ConnectionId.make(id),
  outNodeId: from,
  inNodeId: to,
  outIo: OutputRef.port("out"),
  inIoId: IoId.make("in"),
});

describe("non-reactive wildcard connection groups", () => {
  it("incremental updates agree with a fresh crawl across mixed topology and IO edits", () => {
    const cache = new Wildcards.Cache();
    const declarations = new Map<string, Wildcards.IO>();
    const wires = new Map<string, Connection.Model>();
    const types = [w, t.List(w), t.String, t.List(t.String), t.Int];
    let seed = 19283;
    const random = (size: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % size;
    };
    for (let step = 0; step < 120; step++) {
      const node = String(random(12));
      if (random(5) === 0) declarations.delete(node);
      else declarations.set(node, io(types[random(types.length)]!));
      const id = String(random(20));
      if (random(3) === 0) wires.delete(id);
      else wires.set(id, wire(id, String(random(12)), String(random(12))));
      const connections = [...wires.values()];
      const previous = [...cache.groups];
      const result = cache.update(declarations, connections);
      const fresh = new Wildcards.Cache();
      const rebuilt = fresh.update(declarations, connections);
      expect(result._tag).toBe(rebuilt._tag);
      if (Result.isFailure(result) && Result.isFailure(rebuilt)) {
        expect(result.failure.map((error) => error.connectionId).sort()).toEqual(
          rebuilt.failure.map((error) => error.connectionId).sort(),
        );
        expect([...cache.groups]).toEqual(previous);
        for (const group of previous) expect(cache.group([...group.nodes][0]!)).toBe(group);
        continue;
      }
      for (let id = 0; id < 12; id++) {
        expect(cache.resolve(String(id), w)).toEqual(fresh.resolve(String(id), w));
        expect(cache.group(String(id))?.connections).toEqual(fresh.group(String(id))?.connections);
      }
    }
  });
  it("serializes declarations, not values, and refuses unresolved runtime values", () => {
    expect(Schema.decodeUnknownSync(t.Descriptor)(w)).toEqual(w);
    expect(t.isValue(w, "anything")).toBe(false);
    expect(t.isValue(t.List(w), [])).toBe(false);
    expect(t.equals(w, t.Wildcard("Other"))).toBe(false);
    expect(t.compatible(t.List(w), t.List(t.String))).toBe(true);
    expect(t.compatible(t.List(w), t.Option(t.String))).toBe(false);
  });

  it("propagates in either direction and clears an entire cycle after the last anchor is removed", () => {
    const cache = new Wildcards.Cache();
    const declarations = new Map([
      ["a", io(w)],
      ["b", io(w)],
      ["anchor", io(t.String)],
    ]);
    const cycle = [wire("ab", "a", "b"), wire("ba", "b", "a")];
    const anchor = wire("anchor", "b", "anchor");
    cache.update(declarations, [...cycle, anchor]);
    expect(cache.resolve("a", w)).toEqual(t.String);
    expect(cache.resolve("b", w)).toEqual(t.String);
    cache.update(declarations, cycle);
    expect(cache.resolve("a", w)._tag).toBe("Wildcard");
    expect(cache.resolve("b", w)._tag).toBe("Wildcard");
  });

  it("merges and splits groups without touching an unrelated cached component", () => {
    const cache = new Wildcards.Cache();
    const declarations = new Map([
      ["a", io(w)],
      ["b", io(w)],
      ["s", io(t.String)],
      ["other", io(w)],
    ]);
    const anchor = wire("anchor", "s", "a"),
      bridge = wire("bridge", "a", "b");
    cache.update(declarations, [anchor]);
    const other = cache.group("other");
    cache.update(declarations, [anchor, bridge]);
    expect(cache.group("a")).toBe(cache.group("b"));
    expect(cache.group("a")?.connections).toEqual([anchor, bridge]);
    expect(cache.resolve("b", w)).toEqual(t.String);
    expect(cache.group("other")).toBe(other);
    cache.update(declarations, [anchor]);
    expect(cache.resolve("a", w)).toEqual(t.String);
    expect(cache.resolve("b", w)).toEqual(w);
    expect(cache.group("a")?.connections).toEqual([anchor]);
    expect(cache.group("b")?.connections).toEqual([]);
    expect(cache.group("other")).toBe(other);
    const a = cache.group("a");
    cache.update(new Map(declarations), [structuredClone(anchor)]);
    expect(cache.group("a")).toBe(a);
  });

  it("keeps independent IDs on a node and the same ID on disconnected nodes separate", () => {
    const cache = new Wildcards.Cache();
    const a = { ...io(w), dataOutputs: [{ id: "out", type: t.Wildcard("U") }] };
    cache.update(
      new Map([
        ["a", a],
        ["b", io(w)],
        ["s", io(t.String)],
      ]),
      [wire("anchor", "s", "a")],
    );
    expect(cache.resolve("a", w)).toEqual(t.String);
    expect(cache.resolve("a", t.Wildcard("U"))).toEqual(t.Wildcard("U"));
    expect(cache.resolve("b", w)).toEqual(w);
  });

  it.each([false, true])(
    "unifies nested containers through a whole-type wildcard (reverse=%s)",
    (reverse) => {
      const cache = new Wildcards.Cache();
      const nested = (item: t.Any) => t.Option(t.List(item));
      const declarations = new Map([
        ["a", io(w)],
        ["b", io(nested(w))],
        ["s", io(nested(t.String))],
      ]);
      const wires = [wire("ab", "a", "b"), wire("sa", "s", "a")];
      cache.update(declarations, reverse ? wires.toReversed() : wires);
      expect(cache.resolve("a", w)).toEqual(nested(t.String));
      expect(cache.resolve("b", w)).toEqual(t.String);
      cache.update(declarations, [wires[0]!]);
      expect(cache.resolve("a", w)).toEqual(nested(w));
      expect(cache.resolve("b", w)).toEqual(w);
      cache.update(declarations, []);
      expect(cache.resolve("a", w)).toEqual(w);
    },
  );

  it("retains duplicate concrete anchors until the last is gone", () => {
    const cache = new Wildcards.Cache();
    const declarations = new Map([
      ["a", io(w)],
      ["s1", io(t.String)],
      ["s2", io(t.String)],
    ]);
    const first = wire("first", "a", "s1"),
      second = wire("second", "a", "s2");
    cache.update(declarations, [first, second]);
    cache.update(declarations, [second]);
    expect(cache.resolve("a", w)).toEqual(t.String);
    declarations.delete("s2");
    cache.update(declarations, []);
    expect(cache.resolve("a", w)).toEqual(w);
    expect(cache.group("s2")).toBeUndefined();
  });

  it("re-solves dynamic IO and rejects conflicting or infinitely recursive bindings", () => {
    const cache = new Wildcards.Cache();
    const declarations = new Map([
      ["a", io(w)],
      ["s", io(t.String)],
      ["i", io(t.Int)],
    ]);
    const first = wire("first", "a", "s"),
      second = wire("second", "a", "i");
    const rejected = cache.update(declarations, [first, second]);
    expect(Result.isFailure(rejected)).toBe(true);
    if (Result.isFailure(rejected)) expect(rejected.failure).toHaveLength(1);
    expect(cache.groups.size).toBe(0);
    declarations.set("i", io(t.String));
    expect(Result.isSuccess(cache.update(declarations, [first, second]))).toBe(true);
    expect(cache.resolve("a", w)).toEqual(t.String);
    const recursive = { ...io(w), dataOutputs: [{ id: "out", type: t.List(w) }] };
    const completed = cache.group("a");
    expect(
      Result.isFailure(cache.update(new Map([["a", recursive]]), [wire("self", "a", "a")])),
    ).toBe(true);
    expect(cache.group("a")).toBe(completed);
    expect(cache.resolve("a", w)).toEqual(t.String);
    expect(completed).not.toHaveProperty("conflicts");
  });

  it("rejects a group merge atomically, retaining connections and indexes for the next attempt", () => {
    const cache = new Wildcards.Cache();
    const declarations = new Map([
      ["a", io(w)],
      ["s", io(t.String)],
      ["b", io(w)],
      ["i", io(t.Int)],
      ["other", io(w)],
    ]);
    const first = wire("first", "a", "s"),
      second = wire("second", "b", "i");
    cache.update(declarations, [first, second]);
    const a = cache.group("a"),
      b = cache.group("b"),
      other = cache.group("other");
    const merge = wire("merge", "a", "b");
    expect(Result.isFailure(cache.update(declarations, [first, second, merge]))).toBe(true);
    expect(cache.group("a")).toBe(a);
    expect(cache.group("b")).toBe(b);
    expect(cache.group("other")).toBe(other);
    expect(a?.connections).toEqual([first]);
    expect(b?.connections).toEqual([second]);
    expect(cache.resolve("b", w)).toEqual(t.Int);

    // Reusing the rejected wire ID/endpoints after removing its incompatible anchor works.
    expect(Result.isSuccess(cache.update(declarations, [first, merge]))).toBe(true);
    expect(cache.group("a")).toBe(cache.group("b"));
    expect(cache.group("a")?.connections).toEqual([first, merge]);
    expect(cache.resolve("b", w)).toEqual(t.String);
    expect(cache.group("other")).toBe(other);
    expect(Result.isSuccess(cache.update(declarations, [merge]))).toBe(true);
    expect(cache.resolve("b", w)._tag).toBe("Wildcard");
  });

  it("reindexes replaced wires and IO kind changes without retaining old direct connections", () => {
    const cache = new Wildcards.Cache();
    const declarations = new Map([
      ["a", io(w)],
      ["b", io(w)],
      ["s", io(t.String)],
    ]);
    const first = wire("same-id", "s", "a"),
      replacement = wire("same-id", "s", "b");
    cache.update(declarations, [first]);
    cache.update(declarations, [replacement]);
    expect(cache.group("a")?.connections).toEqual([]);
    expect(cache.group("b")?.connections).toEqual([replacement]);
    expect(cache.resolve("a", w)).toEqual(w);
    declarations.set("s", { ...io(t.String), dataOutputs: [], executionOutputs: [{ id: "out" }] });
    cache.update(declarations, [replacement]);
    expect(cache.group("b")?.connections).toEqual([]);
    expect(cache.resolve("b", w)).toEqual(w);
    declarations.set("s", io(t.String));
    cache.update(declarations, [replacement]);
    expect(cache.group("b")?.connections).toEqual([replacement]);
    expect(cache.resolve("b", w)).toEqual(t.String);
  });

  it("supports nominal custom types, scope fields, and inferred Break Scope outputs", () => {
    const cache = new Wildcards.Cache();
    const custom = t.Custom(t.DefinitionId.make("record"));
    const source = {
      ...io(custom),
      executionOutputs: [{ id: "scope", scope: [{ id: "value", type: w }] }],
    };
    const unpack = {
      ...io(w),
      dataOutputs: [{ id: "value", type: w }],
      executionInputs: [{ id: "scope", scope: null }],
    };
    cache.update(
      new Map<string, Wildcards.IO>([
        ["source", source],
        ["break", unpack],
        ["sink", io(custom)],
      ]),
      [
        {
          ...wire("scope", "source", "break"),
          outIo: OutputRef.port("scope"),
          inIoId: IoId.make("scope"),
        },
        { ...wire("data", "break", "sink"), outIo: OutputRef.port("value") },
      ],
    );
    expect(cache.resolve("source", w)).toEqual(custom);
    expect(cache.resolve("break", w)).toEqual(custom);
  });
});
