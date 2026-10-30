import { PackageId } from "@macrograph/core";
import { t } from "@macrograph/module";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";

import { createEditorStore } from "../../src/editor/store";

describe("editor conversion rules", () => {
  it("combines core defaults with the conversion pairs packages publish", () => {
    createRoot((dispose) => {
      const editor = createEditorStore();
      const Code = t.defineStruct("chat/Code", "Code", {});
      expect(editor.conversions().has(t.Int, t.Float)).toBe(true);
      expect(editor.conversions().has(t.Struct(Code), t.String)).toBe(false);
      editor.setPackages([
        {
          id: PackageId.make("chat"),
          name: "Chat",
          schemas: [],
          resources: [],
          types: { [Code.id]: Code },
          conversions: [{ from: t.Struct(Code), to: t.String }],
        },
      ]);
      expect(editor.conversions().has(t.Struct(Code), t.String)).toBe(true);
      expect(editor.conversions().has(t.Int, t.Float)).toBe(true);
      dispose();
    });
  });
});
