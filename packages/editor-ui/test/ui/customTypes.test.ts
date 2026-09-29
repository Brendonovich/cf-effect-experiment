import { t } from "@macrograph/module";
import { describe, expect, it } from "vitest";

import { defaultValueError, initialDefaultValue } from "../../src/ui/defaultValues";
import { filterTypeChoices, replaceTypeSegment, typeLabel } from "../../src/ui/typeSelection";

const id = t.DefinitionId.make("person");
const recursiveId = t.DefinitionId.make("tree");
const definitions: t.Definitions = {
  person: {
    _tag: "Struct",
    id,
    name: "Person",
    fields: [
      { name: "name", type: t.String },
      { name: "dates", type: t.List(t.Option(t.DateTime)) },
    ],
  },
  tree: {
    _tag: "Enum",
    id: recursiveId,
    name: "Tree",
    variants: [
      { name: "Branch", fields: [{ name: "child", type: t.Enum(recursiveId) }] },
      { name: "Leaf", fields: [] },
    ],
  },
};

describe("custom type UI helpers", () => {
  it("searches names and stable identities and preserves nested container children", () => {
    expect(filterTypeChoices("person", definitions)).toEqual([t.Struct(id)]);
    expect(replaceTypeSegment(t.List(t.Option(t.String)), 2, t.Struct(id))).toEqual(
      t.List(t.Option(t.Struct(id))),
    );
    expect(typeLabel(t.List(t.Struct(id)), definitions)).toBe("List<Person>");
    expect(typeLabel(t.Struct(id))).toBe("Missing type (person)");
  });
  it("labels inferred and unresolved nested wildcard types", () => {
    expect(typeLabel(t.Option(t.List(t.Wildcard("T"))))).toBe("Option<List<Wildcard>>");
  });
  it("initializes finite recursive tagged values and JSON codec containers", () => {
    expect(initialDefaultValue(t.Enum(recursiveId), definitions)).toEqual({
      _type: "tree",
      _tag: "Leaf",
    });
    const value = initialDefaultValue(t.Struct(id), definitions);
    expect(value).toEqual({ _type: "person", name: "", dates: [] });
    expect(defaultValueError(t.Struct(id), value, definitions)).toBeUndefined();
    expect(
      defaultValueError(
        t.List(t.Option(t.DateTime)),
        [{ _tag: "Some", value: "2026-08-31T00:00:00.000Z" }],
        definitions,
      ),
    ).toBeUndefined();
  });
  it("does not loop on a missing or nonterminating definition", () => {
    expect(initialDefaultValue(t.Struct(id), {})).toBeUndefined();
    expect(
      initialDefaultValue(t.Struct(id), {
        person: {
          _tag: "Struct",
          id,
          name: "Person",
          fields: [{ name: "self", type: t.Struct(id) }],
        },
      }),
    ).toBeUndefined();
  });
  it("diagnoses obsolete fields and nominal mismatches without changing saved values", () => {
    const saved = Object.freeze({ _type: "person", name: "Ada", dates: [], obsolete: true });
    expect(defaultValueError(t.Struct(id), saved, definitions)).toBeDefined();
    expect(saved.obsolete).toBe(true);
    expect(
      defaultValueError(t.Struct(id), { _type: "other", name: "Ada", dates: [] }, definitions),
    ).toBeDefined();
  });
});
