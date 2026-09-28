import { IoId, NodeId, PackageId, SchemaId, TypeDefinition } from "@macrograph/core";
import { t } from "@macrograph/module";
import { describe, expect, it } from "vitest";

const id = t.DefinitionId.make("recursive");
describe("type definition validation", () => {
  it("allows recursive containers and terminating tagged variants", () => {
    expect(
      TypeDefinition.validate({
        recursive: {
          _tag: "Struct",
          id,
          name: "Tree",
          fields: [{ name: "children", type: t.List(t.Custom(id)) }],
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
            { name: "Next", fields: [{ name: "next", type: t.Custom(id) }] },
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
          fields: [{ name: "next", type: t.Custom(id) }],
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
          { name: "_type", type: t.String },
          {
            name: "missing",
            type: t.List(t.Option(t.Custom(t.DefinitionId.make("missing")))),
          },
        ],
      },
    });
    expect(errors.map((error) => error.reason)).toEqual([
      "Invalid or duplicate field _type",
      "Unknown type missing",
    ]);
  });

  it("uses definitions embedded in module-owned custom types", () => {
    const nested = t.defineStruct("module/Nested", "Nested", { value: t.String });
    const payload = t.defineStruct("module/Payload", "Payload", {
      nested: t.Struct(nested),
    });
    const reasons = TypeDefinition.nodeDiagnostics(
      {
        id: NodeId.make("break"),
        name: "Break Struct",
        schema: {
          package: PackageId.make("CustomTypes"),
          schema: SchemaId.make("BreakStruct"),
        },
        properties: {},
        inputDefaults: {},
        foldPins: false,
        position: { x: 0, y: 0 },
      },
      {
        dataInputs: [{ id: IoId.make("value"), type: t.Struct(payload) }],
        dataOutputs: [],
        executionInputs: [],
        executionOutputs: [],
      },
      {},
    );
    expect(reasons).toEqual([]);
  });
});
