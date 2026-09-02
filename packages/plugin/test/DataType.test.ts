import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DataType } from "../src/DataType.ts";

const treeId = DataType.DefinitionId.make("tree");
const resultId = DataType.DefinitionId.make("result");
const definitions: DataType.Definitions = {
  tree: {
    _tag: "Struct",
    id: treeId,
    name: "Tree",
    fields: [
      { name: "label", type: DataType.String },
      { name: "children", type: DataType.List(DataType.Custom(treeId)) },
      { name: "parent", type: DataType.Option(DataType.Custom(treeId)) },
    ],
  },
  result: {
    _tag: "Enum",
    id: resultId,
    name: "Result",
    variants: [
      { name: "Empty", fields: [] },
      { name: "Found", fields: [{ name: "tree", type: DataType.Custom(treeId) }] },
    ],
  },
};

describe("custom data types", () => {
  it("reads shipped scalar selectors and nested nominal descriptors", () => {
    expect(DataType.parseSelector("String")).toEqual(DataType.String);
    const nested = DataType.List(DataType.Option(DataType.Custom(treeId)));
    expect(DataType.parseSelector(JSON.stringify(nested))).toEqual(nested);
    expect(DataType.parseSelector("Custom")).toBeUndefined();
    expect(DataType.parseSelector('{"_tag":"List"}')).toBeUndefined();
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
    const codec = DataType.JsonValueSchema(DataType.Custom(resultId), definitions);
    const encoded = Schema.encodeUnknownSync(codec)(value);
    expect(Schema.decodeUnknownSync(codec)(JSON.parse(JSON.stringify(encoded)))).toEqual(value);
    expect(DataType.isValue(DataType.Custom(resultId), value, definitions)).toBe(true);
  });

  it("uses identity for connections and runtime values", () => {
    const otherId = DataType.DefinitionId.make("other");
    expect(DataType.equals(DataType.Custom(treeId), DataType.Custom(otherId))).toBe(false);
    expect(
      DataType.equals(
        DataType.List(DataType.Custom(treeId)),
        DataType.List(DataType.Custom(otherId)),
      ),
    ).toBe(false);
    expect(
      DataType.equals(
        DataType.Option(DataType.Custom(treeId)),
        DataType.Option(DataType.Custom(treeId)),
      ),
    ).toBe(true);
    expect(
      DataType.isValue(
        DataType.Custom(treeId),
        { _type: "other", label: "", children: [], parent: Option.none() },
        definitions,
      ),
    ).toBe(false);
  });

  it("rejects missing definitions, unknown variants and invalid nested fields", () => {
    expect(DataType.isValue(DataType.Custom(treeId), {})).toBe(false);
    expect(DataType.isValue(DataType.List(DataType.Custom(treeId)), [])).toBe(false);
    expect(DataType.isValue(DataType.Option(DataType.Custom(treeId)), Option.none())).toBe(false);
    expect(
      DataType.isValue(
        DataType.Custom(resultId),
        { _type: "result", _tag: "Empty" },
        { result: definitions.result! },
      ),
    ).toBe(false);
    expect(
      DataType.isValue(
        DataType.Custom(resultId),
        { _type: "result", _tag: "Unknown" },
        definitions,
      ),
    ).toBe(false);
    expect(
      DataType.isValue(
        DataType.Custom(treeId),
        { _type: "tree", label: 1, children: [], parent: Option.none() },
        definitions,
      ),
    ).toBe(false);
  });

  it("keeps definition resolution scoped to the supplied project", () => {
    const changed: DataType.Definitions = {
      tree: {
        _tag: "Struct",
        id: treeId,
        name: "Tree",
        fields: [{ name: "count", type: DataType.Int }],
      },
    };
    const value = { _type: "tree", count: 3 };
    expect(DataType.isValue(DataType.Custom(treeId), value, changed)).toBe(true);
    expect(DataType.isValue(DataType.Custom(treeId), value, definitions)).toBe(false);
  });

  it("rejects obsolete fields instead of silently stripping preserved defaults", () => {
    const value = { _type: "result", _tag: "Empty", removedPayload: "keep me" };
    const type = DataType.Custom(resultId);
    expect(DataType.isValue(type, value, definitions)).toBe(false);
    expect(() =>
      Schema.decodeUnknownSync(DataType.JsonValueSchema(type, definitions))(value),
    ).toThrow();
    expect(value.removedPayload).toBe("keep me");
  });

  it("fails safely for inherited identities and malformed persisted registries", () => {
    const inherited = Object.create(definitions) as DataType.Definitions;
    expect(
      DataType.isValue(DataType.Custom(resultId), { _type: "result", _tag: "Empty" }, inherited),
    ).toBe(false);
    const invalid: DataType.Definitions = {
      result: { _tag: "Enum", id: resultId, name: "Result", variants: [] },
      tree: {
        _tag: "Struct",
        id: treeId,
        name: "Tree",
        fields: [{ name: "__proto__", type: DataType.String }],
      },
    };
    expect(DataType.isValue(DataType.Custom(resultId), {}, invalid)).toBe(false);
    expect(DataType.isValue(DataType.Custom(treeId), {}, invalid)).toBe(false);
    expect(DataType.isValue(DataType.Custom(DataType.DefinitionId.make("constructor")), {})).toBe(
      false,
    );
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
    const schema = DataType.ValueSchema(DataType.Custom(treeId), definitions);
    expect(DataType.isValue(DataType.Custom(treeId), cyclic, definitions)).toBe(false);
    const decoded = Schema.decodeUnknownResult(schema)(cyclic);
    expect(decoded._tag).toBe("Failure");
    expect(Schema.decodeUnknownResult(DataType.JsonValueSchema(DataType.Custom(treeId), definitions))(cyclic)._tag)
      .toBe("Failure");
    expect(Schema.encodeUnknownResult(schema)(cyclic)._tag).toBe("Failure");
    expect(
      Schema.encodeUnknownResult(DataType.JsonValueSchema(DataType.Custom(treeId), definitions))(
        cyclic,
      )._tag,
    ).toBe("Failure");
    let deep: unknown = { _type: "tree", label: "leaf", parent: Option.none(), children: [] };
    for (let i = 0; i < 130; i++)
      deep = { _type: "tree", label: "branch", parent: Option.none(), children: [deep] };
    expect(Schema.decodeUnknownResult(schema)(deep)._tag).toBe("Failure");
    expect(Schema.encodeUnknownResult(schema)(deep)._tag).toBe("Failure");
    expect(
      DataType.isValue(
        DataType.List(DataType.Int),
        Array.from({ length: 100_001 }, () => 1),
      ),
    ).toBe(false);
  });
});
