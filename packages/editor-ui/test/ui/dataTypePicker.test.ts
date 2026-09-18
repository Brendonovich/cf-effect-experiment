import { DataType } from "@macrograph/plugin/DataType";
import { describe, expect, it } from "vitest";

import { filterTypeChoices, replaceTypeSegment, typeSegments } from "../../src/ui/typeSelection";

describe("data type picker", () => {
  it("searches existing types case-insensitively", () => {
    expect(filterTypeChoices("  oP ")).toEqual(["Option"]);
    expect(filterTypeChoices("int")).toEqual(["Int"]);
    expect(filterTypeChoices("Struct")).toEqual([]);
  });
  it("wraps leaves and edits a nested layer without discarding its child", () => {
    const value = DataType.List(DataType.Option(DataType.List(DataType.Int)));
    expect(typeSegments(value).map((type) => type._tag)).toEqual(["List", "Option", "List", "Int"]);
    expect(replaceTypeSegment(value, 1, "List")).toEqual(
      DataType.List(DataType.List(DataType.List(DataType.Int))),
    );
    expect(replaceTypeSegment(value, 3, "Option")).toEqual(
      DataType.List(DataType.Option(DataType.List(DataType.Option(DataType.Int)))),
    );
    expect(replaceTypeSegment(value, 2, "Bool")).toEqual(
      DataType.List(DataType.Option(DataType.Bool)),
    );
    expect(value).toEqual(DataType.List(DataType.Option(DataType.List(DataType.Int))));
  });
});
