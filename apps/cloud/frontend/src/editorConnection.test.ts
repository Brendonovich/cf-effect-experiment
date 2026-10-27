import { ModuleRpcProtocol } from "@macrograph/editor-ui/modules";
import { Module } from "@macrograph/module";
import { describe, expect, it } from "vitest";

import { moduleRpcBaseUrl } from "./editorConnection";
import { moduleUIs } from "./moduleUIs";

describe("cloud editor connection", () => {
  it("sends module RPCs to the project-scoped worker route", () => {
    expect(
      ModuleRpcProtocol.httpUrl(
        moduleRpcBaseUrl("https://cloud.macrograph.app", "project 1"),
        Module.builtinId("openai"),
      ),
    ).toBe(
      "https://cloud.macrograph.app/rpc/projects/project%201/module/macrograph.app/macrograph/openai/rpc",
    );
  });

  it("bundles the UI entries of modules with settings", async () => {
    const twitch = moduleUIs.get(Module.builtinId("twitch"));
    expect(typeof twitch).toBe("function");
    const loaded = typeof twitch === "function" ? await twitch() : twitch;
    const descriptor = loaded !== undefined && "default" in loaded ? loaded.default : loaded;
    expect(descriptor?.settings).toBeDefined();
  });
});
