import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import * as t from "../src/DataType.ts";

const treeId = t.DefinitionId.make("tree");
const resultId = t.DefinitionId.make("result");
const Tree = t.defineStruct("tree", "Tree", {
  label: t.String,
  children: t.List(t.Struct(treeId)),
  parent: t.Option(t.Struct(treeId)),
});
const Result = t.defineEnum("result", "Result", {
  Empty: {},
  Found: { tree: t.Struct(Tree) },
});
const definitions: t.Definitions = Object.fromEntries(
  [Tree, Result].map((definition) => [definition.id, definition]),
);

describe("custom data types", () => {
  it("builds struct and enum definitions from type arguments", () => {
    const Item = t.defineStruct("item", "Item", { label: t.String, count: t.Int });
    expect(Item).toEqual({
      _tag: "Struct",
      id: "item",
      name: "Item",
      fields: [
        { name: "label", type: t.String },
        { name: "count", type: t.Int },
      ],
    });
    const Result = t.defineEnum("result", "Result", {
      Empty: {},
      Found: { item: t.Struct(Item) },
    });
    expect(Result).toEqual({
      _tag: "Enum",
      id: "result",
      name: "Result",
      variants: [
        { name: "Empty", fields: [] },
        { name: "Found", fields: [{ name: "item", type: t.Struct(Item) }] },
      ],
    });
    expect(t.Struct(Item)).toEqual(t.Struct("item"));
    expect(t.Enum(Result)).toEqual(t.Enum("result"));
  });

  it("encodes empty wildcard container defaults without permitting unresolved runtime values", () => {
    const wildcard = t.Wildcard("T");
    expect(Schema.encodeUnknownSync(t.JsonDefaultSchema(t.List(wildcard)))([])).toEqual([]);
    expect(
      Schema.encodeUnknownSync(t.JsonDefaultSchema(t.Option(wildcard)))(Option.none()),
    ).toEqual({ _tag: "None" });
    expect(() => Schema.encodeUnknownSync(t.JsonDefaultSchema(wildcard))("value")).toThrow();
    expect(() =>
      Schema.encodeUnknownSync(t.JsonDefaultSchema(t.List(wildcard)))(["value"]),
    ).toThrow();
    expect(() =>
      Schema.encodeUnknownSync(t.JsonDefaultSchema(t.Option(wildcard)))(Option.some("value")),
    ).toThrow();
    expect(t.isValue(t.List(wildcard), [])).toBe(false);
  });
  it("decodes nested nominal and wildcard descriptors", () => {
    const decode = Schema.decodeUnknownSync(t.Descriptor);
    const nested = t.List(t.Option(t.Struct(treeId)));
    expect(decode(JSON.parse(JSON.stringify(nested)))).toEqual(nested);
    expect(decode(t.List(t.Wildcard("T")))).toEqual(t.List(t.Wildcard("T")));
    expect(() => decode({ _tag: "List" })).toThrow();
  });

  it("round trips recursive structs and tagged enum payloads through JSON", () => {
    const value = {
      _type: "result",
      _tag: "Found",
      tree: {
        _type: "tree",
        label: "root",
        parent: Option.none(),
        children: [{ _type: "tree", label: "leaf", parent: Option.none(), children: [] }],
      },
    };
    const codec = t.JsonValueSchema(t.Enum(resultId), definitions);
    const encoded = Schema.encodeUnknownSync(codec)(value);
    expect(Schema.decodeUnknownSync(codec)(JSON.parse(JSON.stringify(encoded)))).toEqual(value);
    expect(t.isValue(t.Enum(resultId), value, definitions)).toBe(true);
  });

  it("uses identity for connections and runtime values", () => {
    const otherId = t.DefinitionId.make("other");
    expect(t.equals(t.Struct(treeId), t.Struct(otherId))).toBe(false);
    expect(t.equals(t.List(t.Struct(treeId)), t.List(t.Struct(otherId)))).toBe(false);
    expect(t.equals(t.Option(t.Struct(treeId)), t.Option(t.Struct(treeId)))).toBe(true);
    expect(
      t.isValue(
        t.Struct(treeId),
        { _type: "other", label: "", children: [], parent: Option.none() },
        definitions,
      ),
    ).toBe(false);
  });

  it("rejects missing definitions, unknown variants and invalid nested fields", () => {
    expect(t.isValue(t.Struct(treeId), {})).toBe(false);
    expect(t.isValue(t.List(t.Struct(treeId)), [])).toBe(false);
    expect(t.isValue(t.Option(t.Struct(treeId)), Option.none())).toBe(false);
    expect(
      t.isValue(
        t.Struct(resultId),
        { _type: "result", _tag: "Empty" },
        { result: definitions.result! },
      ),
    ).toBe(false);
    expect(t.isValue(t.Enum(resultId), { _type: "result", _tag: "Unknown" }, definitions)).toBe(
      false,
    );
    expect(
      t.isValue(
        t.Struct(treeId),
        { _type: "tree", label: 1, children: [], parent: Option.none() },
        definitions,
      ),
    ).toBe(false);
  });

  it("keeps definition resolution scoped to the supplied project", () => {
    const changedDefinition = t.defineStruct("tree", "Tree", { count: t.Int });
    const changed: t.Definitions = { tree: changedDefinition };
    const value = { _type: "tree", count: 3 };
    expect(t.isValue(t.Struct(treeId), value, changed)).toBe(true);
    expect(t.isValue(t.Struct(treeId), value, definitions)).toBe(false);
  });

  it("rejects obsolete fields instead of silently stripping preserved defaults", () => {
    const value = { _type: "result", _tag: "Empty", removedPayload: "keep me" };
    const type = t.Enum(resultId);
    expect(t.isValue(type, value, definitions)).toBe(false);
    expect(() => Schema.decodeUnknownSync(t.JsonValueSchema(type, definitions))(value)).toThrow();
    expect(value.removedPayload).toBe("keep me");
  });

  it("fails safely for inherited identities and malformed persisted registries", () => {
    const inherited = Object.create(definitions) as t.Definitions;
    expect(t.isValue(t.Enum(resultId), { _type: "result", _tag: "Empty" }, inherited)).toBe(false);
    const invalid: t.Definitions = {
      result: { _tag: "Enum", id: resultId, name: "Result", variants: [] },
      tree: {
        _tag: "Struct",
        id: treeId,
        name: "Tree",
        fields: [{ name: "__proto__", type: t.String }],
      },
    };
    expect(t.isValue(t.Enum(resultId), {}, invalid)).toBe(false);
    expect(t.isValue(t.Struct(treeId), {}, invalid)).toBe(false);
    expect(t.isValue(t.Struct(t.DefinitionId.make("constructor")), {})).toBe(false);
  });

  it("reports cyclic and excessively deep payloads as schema errors, not recursion defects", () => {
    const cyclic: {
      _type: string;
      label: string;
      parent: Option.Option<unknown>;
      children: unknown[];
    } = {
      _type: "tree",
      label: "cycle",
      parent: Option.none(),
      children: [],
    };
    cyclic.children.push(cyclic);
    const schema = t.ValueSchema(t.Struct(treeId), definitions);
    expect(t.isValue(t.Struct(treeId), cyclic, definitions)).toBe(false);
    const decoded = Schema.decodeUnknownResult(schema)(cyclic);
    expect(decoded._tag).toBe("Failure");
    expect(
      Schema.decodeUnknownResult(t.JsonValueSchema(t.Struct(treeId), definitions))(cyclic)._tag,
    ).toBe("Failure");
    expect(Schema.encodeUnknownResult(schema)(cyclic)._tag).toBe("Failure");
    expect(
      Schema.encodeUnknownResult(t.JsonValueSchema(t.Struct(treeId), definitions))(cyclic)._tag,
    ).toBe("Failure");
    let deep: unknown = { _type: "tree", label: "leaf", parent: Option.none(), children: [] };
    for (let i = 0; i < 130; i++)
      deep = { _type: "tree", label: "branch", parent: Option.none(), children: [deep] };
    expect(Schema.decodeUnknownResult(schema)(deep)._tag).toBe("Failure");
    expect(Schema.encodeUnknownResult(schema)(deep)._tag).toBe("Failure");
    expect(
      t.isValue(
        t.List(t.Int),
        Array.from({ length: 100_001 }, () => 1),
      ),
    ).toBe(false);
  });
});
