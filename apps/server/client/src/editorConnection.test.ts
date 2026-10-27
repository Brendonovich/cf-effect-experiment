import type { EditorRpcClient } from "@macrograph/editor-ui";

import { ModuleCatalogSource, ModuleRpcProtocol } from "@macrograph/editor-ui/modules";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { editorModules, moduleLoading } from "./editorConnection";

const settings = {
  initial: null,
  connect: () => Effect.die("unused"),
  connectInProcess: Effect.die("unused"),
};
const twitch = ModuleCatalogSource.packageEntry({ id: "twitch", name: "Twitch" });
const hosted = {
  ...ModuleCatalogSource.packageEntry({ id: "macrograph.app/macrograph/twitch", name: "Twitch" }),
  ui: { entryUrl: "/module/macrograph.app/macrograph/twitch/ui/index.js?v=abc", styleUrls: [] },
};
const connection = {
  client: {} as unknown as EditorRpcClient,
  modules: {
    catalog: ModuleCatalogSource.fromPackages,
    rpcProtocol: ModuleRpcProtocol.unavailable,
  },
};

describe("server editor modules", () => {
  it("uses bundled settings UIs until the server serves module URLs", () => {
    expect(moduleLoading).toBe("bundled");
    const modules = editorModules("bundled", [{ id: "twitch", settings }]);
    expect(modules.loader.key(twitch)).toBe("static:twitch");
    expect(modules.loader.key(hosted)).toBeUndefined();
    expect(modules.catalog(connection)).toBe(connection.modules.catalog);
    expect(modules.rpcProtocol(connection)).toBe(connection.modules.rpcProtocol);
  });

  it("imports settings UIs from the catalog's module URLs in server mode", () => {
    const modules = editorModules("server", [{ id: "twitch", settings }]);
    expect(modules.loader.key(twitch)).toBeUndefined();
    expect(modules.loader.key(hosted)).toMatch(
      /^url:.*\/module\/macrograph\.app\/macrograph\/twitch\/ui\/index\.js\?v=abc$/,
    );
  });
});
