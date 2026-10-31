// @vitest-environment jsdom
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModuleCatalogEntry } from "../../../src/editor/modules/ModuleCatalogSource";

import { ModuleCatalogSource } from "../../../src/editor/modules/ModuleCatalogSource";
import {
  createModuleUILoader,
  createStylesheets,
  ModuleUILoadError,
} from "../../../src/editor/modules/ModuleUILoader";

const settings = {
  initial: null,
  connect: () => Effect.die("unused"),
  connectInProcess: Effect.die("unused"),
};

const entry = (ui?: ModuleCatalogEntry["ui"]): ModuleCatalogEntry => ({
  ...ModuleCatalogSource.packageEntry({ id: "macrograph.app/macrograph/example", name: "Example" }),
  ...(ui === undefined ? {} : { ui }),
});

const styleLinks = () =>
  [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(
    (link) => link.href,
  );

afterEach(() => document.head.replaceChildren());

describe("module UI loader", () => {
  it("imports a module UI entry from its catalog URL", async () => {
    const source = `export default { settings: { initial: 1, connect: () => null, connectInProcess: {} } };`;
    const url = `data:text/javascript,${encodeURIComponent(source)}`;
    const loader = createModuleUILoader({ url: true });
    const handle = loader.acquire(entry({ entryUrl: url, styleUrls: [] }))!;
    expect((await handle.descriptor).settings?.initial).toBe(1);
  });

  it("injects stylesheets while held, counting references per URL", async () => {
    const loader = createModuleUILoader({
      url: async () => ({ default: { settings } }),
      baseUrl: "https://editor.test/app/",
      stylesheets: createStylesheets(document),
    });
    const ui = {
      entryUrl: "module/a/ui/index.js?v=1",
      styleUrls: ["module/a/ui/index.css?v=1", "/shared.css"],
    };
    const first = loader.acquire(entry(ui))!;
    const second = loader.acquire(entry(ui))!;
    expect(styleLinks()).toEqual([
      "https://editor.test/app/module/a/ui/index.css?v=1",
      "https://editor.test/shared.css",
    ]);
    await first.descriptor;
    first.release();
    first.release();
    expect(styleLinks()).toHaveLength(2);
    second.release();
    expect(styleLinks()).toEqual([]);
  });

  it("imports once per URL and again when the content-hashed URL changes", async () => {
    const importUrl = vi.fn(async (url: string) => ({
      default: { settings: { ...settings, url } },
    }));
    const loader = createModuleUILoader({ url: importUrl, baseUrl: "https://editor.test/" });
    const v1 = entry({ entryUrl: "/module/x/ui/index.js?v=1", styleUrls: [] });
    const v2 = entry({ entryUrl: "/module/x/ui/index.js?v=2", styleUrls: [] });
    expect(loader.key(v1)).not.toBe(loader.key(v2));
    const a = loader.acquire(v1)!;
    const b = loader.acquire(v1)!;
    expect(await a.descriptor).toBe(await b.descriptor);
    await loader.acquire(v2)!.descriptor;
    expect(importUrl.mock.calls.map(([url]) => url)).toEqual([
      "https://editor.test/module/x/ui/index.js?v=1",
      "https://editor.test/module/x/ui/index.js?v=2",
    ]);
  });

  it("prefers catalog URLs, falls back to bundled loaders, and reports modules without UI", async () => {
    const lazy = vi.fn(async () => ({ default: { settings } }));
    const loader = createModuleUILoader({ static: new Map([[entry().id, lazy]]) });
    expect(loader.key(entry())).toBe(`static:${entry().id}`);
    expect((await loader.acquire(entry())!.descriptor).settings).toBe(settings);
    expect(lazy).toHaveBeenCalledOnce();
    const other = { ...entry(), id: "macrograph.app/macrograph/other" };
    expect(loader.key(other)).toBeUndefined();
    expect(loader.acquire(other)).toBeUndefined();
    // Without URL loading, a catalog UI URL alone does not make a module loadable.
    expect(loader.key({ ...other, ui: { entryUrl: "/x.js", styleUrls: [] } })).toBeUndefined();
  });

  it("surfaces import failures and invalid exports, and retries after a failure", async () => {
    const importUrl = vi
      .fn<(url: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockResolvedValueOnce({ default: { settings: "nope" } })
      .mockResolvedValueOnce({ default: { settings } });
    const loader = createModuleUILoader({ url: importUrl, baseUrl: "https://editor.test/" });
    const target = entry({ entryUrl: "/ui.js", styleUrls: [] });

    const failed = loader.acquire(target)!.descriptor;
    await expect(failed).rejects.toBeInstanceOf(ModuleUILoadError);
    await expect(failed).rejects.toMatchObject({
      message: "Failed to load the UI of Example",
      moduleId: target.id,
      cause: expect.objectContaining({ message: "Failed to fetch dynamically imported module" }),
    });
    await expect(loader.acquire(target)!.descriptor).rejects.toMatchObject({
      message: "The UI of Example does not export a module UI descriptor",
    });
    expect((await loader.acquire(target)!.descriptor).settings).toBe(settings);
  });
});
