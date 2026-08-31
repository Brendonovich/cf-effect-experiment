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
});
