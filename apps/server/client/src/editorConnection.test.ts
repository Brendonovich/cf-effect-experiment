import { ModuleCatalogSource } from "@macrograph/editor-ui/modules";
import { describe, expect, it } from "vitest";

import { editorModules } from "./editorConnection";

const bundled = ModuleCatalogSource.packageEntry({
  id: "macrograph.app/macrograph/twitch",
  name: "Twitch",
});
const hosted = {
  ...bundled,
  ui: {
    entryUrl: "/module/macrograph.app/macrograph/twitch/ui/0123456789abcdef/index.js",
    styleUrls: [],
  },
};

describe("server editor modules", () => {
  it("imports settings UIs from the catalog's module URLs", () => {
    const modules = editorModules();
    expect(modules.loader.key(bundled)).toBeUndefined();
    expect(modules.loader.key(hosted)).toMatch(
      /^url:.*\/module\/macrograph\.app\/macrograph\/twitch\/ui\/0123456789abcdef\/index\.js$/,
    );
  });
});
