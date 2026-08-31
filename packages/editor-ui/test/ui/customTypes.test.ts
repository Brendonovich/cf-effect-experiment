import { DataType } from "@macrograph/plugin/DataType";
import { describe, expect, it } from "vitest";

import { defaultValueError, initialDefaultValue } from "../../src/ui/defaultValues";
import {
  filterTypeChoices,
  parseListType,
  replaceTypeSegment,
  typeLabel,
} from "../../src/ui/typeSelection";

const id = DataType.DefinitionId.make("person");
const recursiveId = DataType.DefinitionId.make("tree");
const definitions: DataType.Definitions = {
  person: {
    _tag: "Struct",
    id,
    name: "Person",
    fields: [
      { name: "name", type: DataType.String },
      { name: "dates", type: DataType.List(DataType.Option(DataType.DateTime)) },
    ],
  },
  tree: {
    _tag: "Enum",
    id: recursiveId,
    name: "Tree",
    variants: [
      { name: "Branch", fields: [{ name: "child", type: DataType.Custom(recursiveId) }] },
      { name: "Leaf", fields: [] },
    ],
  },
};

describe("custom type UI helpers", () => {
  it("searches names and stable identities and preserves nested container children", () => {
    expect(filterTypeChoices("person", definitions)).toEqual([DataType.Custom(id)]);
    expect(
      replaceTypeSegment(DataType.List(DataType.Option(DataType.String)), 2, DataType.Custom(id)),
    ).toEqual(DataType.List(DataType.Option(DataType.Custom(id))));
    expect(typeLabel(DataType.List(DataType.Custom(id)), definitions)).toBe("List<Person>");
    expect(typeLabel(DataType.Custom(id))).toBe("Missing type (person)");
  });
  it("round trips descriptors and accepts shipped primitive selectors", () => {
    const nested = DataType.Option(DataType.List(DataType.Custom(id)));
    expect(parseListType(JSON.stringify(nested))).toEqual(nested);
    expect(parseListType("String")).toEqual(DataType.String);
    expect(parseListType("Custom")).toBeUndefined();
    expect(parseListType("broken json")).toBeUndefined();
  });
  it("initializes finite recursive tagged values and JSON codec containers", () => {
    expect(initialDefaultValue(DataType.Custom(recursiveId), definitions)).toEqual({
      _type: "tree",
      _tag: "Leaf",
    });
    const value = initialDefaultValue(DataType.Custom(id), definitions);
    expect(value).toEqual({ _type: "person", name: "", dates: [] });
    expect(defaultValueError(DataType.Custom(id), value, definitions)).toBeUndefined();
    expect(
      defaultValueError(
        DataType.List(DataType.Option(DataType.DateTime)),
        [{ _tag: "Some", value: "2026-08-31T00:00:00.000Z" }],
        definitions,
      ),
    ).toBeUndefined();
  });
  it("does not loop on a missing or nonterminating definition", () => {
    expect(initialDefaultValue(DataType.Custom(id), {})).toBeUndefined();
    expect(
      initialDefaultValue(DataType.Custom(id), {
        person: {
          _tag: "Struct",
          id,
          name: "Person",
          fields: [{ name: "self", type: DataType.Custom(id) }],
        },
      }),
    ).toBeUndefined();
  });
  it("diagnoses obsolete fields and nominal mismatches without changing saved values", () => {
    const saved = Object.freeze({ _type: "person", name: "Ada", dates: [], obsolete: true });
    expect(defaultValueError(DataType.Custom(id), saved, definitions)).toBeDefined();
    expect(saved.obsolete).toBe(true);
    expect(
      defaultValueError(
        DataType.Custom(id),
        { _type: "other", name: "Ada", dates: [] },
        definitions,
      ),
    ).toBeDefined();
  });
});
