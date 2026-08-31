import { TypeDefinition } from "@macrograph/core";
import { DataType } from "@macrograph/plugin/DataType";
import { describe, expect, it } from "vitest";

const id = DataType.DefinitionId.make("recursive");
describe("type definition validation", () => {
  it("allows recursive containers and terminating tagged variants", () => {
    expect(
      TypeDefinition.validate({
        recursive: {
          _tag: "Struct",
          id,
          name: "Tree",
          fields: [{ name: "children", type: DataType.List(DataType.Custom(id)) }],
        },
      }),
    ).toEqual([]);
    expect(
      TypeDefinition.validate({
        recursive: {
          _tag: "Enum",
          id,
          name: "Chain",
          variants: [
            { name: "End", fields: [] },
            { name: "Next", fields: [{ name: "next", type: DataType.Custom(id) }] },
          ],
        },
      }),
    ).toEqual([]);
  });
  it("rejects non-terminating recursion", () => {
    expect(
      TypeDefinition.validate({
        recursive: {
          _tag: "Struct",
          id,
          name: "Loop",
          fields: [{ name: "next", type: DataType.Custom(id) }],
        },
      }).some((error) => error.reason.includes("no finite value")),
    ).toBe(true);
  });
  it("rejects dangling nested references and reserved fields", () => {
    const errors = TypeDefinition.validate({
      recursive: {
        _tag: "Struct",
        id,
        name: "Bad",
        fields: [
          { name: "_type", type: DataType.String },
          {
            name: "missing",
            type: DataType.List(
              DataType.Option(DataType.Custom(DataType.DefinitionId.make("missing"))),
            ),
          },
        ],
      },
    });
    expect(errors.map((error) => error.reason)).toEqual([
      "Invalid or duplicate field _type",
      "Unknown type missing",
    ]);
  });
});
