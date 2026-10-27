import { PackageId } from "@macrograph/core";
import { Context, Effect } from "effect";
import { createRoot, flush, resolve, untrack } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModuleUIDescriptor } from "../../../src/editor/modules/ModuleUILoader";

import { createModuleCatalog } from "../../../src/editor/modules/createModuleCatalog";
import { createModuleData } from "../../../src/editor/modules/createModuleData";
import { ModuleCatalogSource } from "../../../src/editor/modules/ModuleCatalogSource";
import { ModuleRpcProtocol } from "../../../src/editor/modules/ModuleRpcProtocol";
import {
  createModuleUILoader,
  createStylesheets,
} from "../../../src/editor/modules/ModuleUILoader";

// Exercise the client async runtime rather than Solid's server-side primitives.
vi.mock(
  "solid-js",
  () => import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href),
);

const packages = [
  {
    id: PackageId.make("twitch"),
    name: "Twitch",
    resources: [{ id: "TwitchAccount", name: "Twitch Account" }],
  },
  { id: PackageId.make("obs"), name: "OBS", resources: [] },
];

const settingsFor = (connects: Array<string>): NonNullable<ModuleUIDescriptor["settings"]> => {
  const connected = {
    load: (state: Effect.Effect<unknown, unknown>) => state,
    render: () => undefined,
  };
  return {
    initial: { accounts: [] },
    connect: () => Effect.succeed(connected),
    connectInProcess: Effect.sync(() => {
      connects.push("in-process");
      return connected;
    }),
  };
};

const makeConnection = (name: string, gate = Promise.resolve()) => ({
  client: {
    GetIngressEndpoints: vi.fn(() =>
      Effect.promise(async () => {
        await gate;
        return [
          {
            id: name,
            url: `https://${name}.example.com`,
            schema: { id: name, displayName: name },
            instanceKey: name,
            metadata: {},
          },
        ];
      }),
    ),
    GetModuleSettingsCapabilities: vi.fn(() =>
      Effect.succeed([{ moduleId: "twitch" }, { moduleId: "obs" }]),
    ),
    GetModuleClientState: vi.fn(({ moduleId }: { moduleId: string }) =>
      Effect.promise(async () => {
        await gate;
        return { accounts: [name], moduleId };
      }),
    ),
    ReloadResource: vi.fn(() => Effect.void),
    GetResourceValues: vi.fn(() =>
      Effect.promise(async () => {
        await gate;
        return [{ id: name, display: name }];
      }),
    ),
  },
});

const rpcProtocol = ModuleRpcProtocol.inProcess(
  new Map(packages.map((pkg) => [pkg.id, Context.empty()] as const)),
);

let dispose: () => void;
const setup = (statics: ReadonlyArray<string> = ["twitch", "obs"]) => {
  const result = createRoot((cleanup) => {
    dispose = cleanup;
    const applyEvent = vi.fn();
    const connects: Array<string> = [];
    const catalog = createModuleCatalog();
    const loader = createModuleUILoader({
      static: new Map(statics.map((id) => [id, { settings: settingsFor(connects) }] as const)),
      stylesheets: createStylesheets(document),
    });
    const data = createModuleData({ catalog, loader }, applyEvent);
    const connect = (connection: ReturnType<typeof makeConnection>) =>
      data.connect(connection, packages, rpcProtocol);
    return { data, applyEvent, catalog, connect, connects };
  });
  Effect.runSync(result.catalog.load(ModuleCatalogSource.fromPackages, packages));
  flush();
  return result;
};

const state = async (data: ReturnType<typeof setup>["data"], id: string) =>
  resolve(untrack(() => data.settings(id))!.state);

afterEach(() => dispose?.());

describe("module data", () => {
  it("creates settings from the catalog and loads state only once settings are opened", async () => {
    const { data, applyEvent, connect, connects } = setup(["twitch"]);
    const connection = makeConnection("streamer");
    await connect(connection);

    expect(untrack(() => data.settings("obs"))).toBeUndefined();
    expect(untrack(() => data.settings("missing"))).toBeUndefined();
    expect(connection.client.GetModuleClientState).not.toHaveBeenCalled();
    expect(connects).toEqual([]);

    const close = untrack(() => data.settings("twitch"))!.open();
    await vi.waitFor(() =>
      expect(connection.client.GetModuleClientState).toHaveBeenCalledExactlyOnceWith({
        moduleId: "twitch",
      }),
    );
    expect(connects).toEqual(["in-process"]);
    expect(await resolve(untrack(() => data.settings("twitch"))!.settings)).toMatchObject({
      _tag: "Ready",
    });
    await vi.waitFor(async () =>
      expect(await state(data, "twitch")).toEqual({ accounts: ["streamer"], moduleId: "twitch" }),
    );
    expect((await resolve(data.metadata)).capabilities).toEqual(new Set(["twitch", "obs"]));
    expect(applyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "ResourceValuesUpdated",
        package: "twitch",
        resource: "TwitchAccount",
        values: [{ id: "streamer", display: "streamer" }],
      }),
    );

    connection.client.GetModuleClientState.mockClear();
    await data.refresh("twitch");
    expect(connection.client.GetModuleClientState).toHaveBeenCalledExactlyOnceWith({
      moduleId: "twitch",
    });
    close();
    expect(data.open()).toEqual([]);
  });

  it("reports modules without settings and settings that fail to connect", async () => {
    const { data, connect } = setup(["twitch", "obs"]);
    await connect(makeConnection("streamer"));
    const failing = ModuleRpcProtocol.inProcess(new Map());
    await data.connect(makeConnection("streamer"), packages, failing);
    untrack(() => data.settings("obs"))!.open();
    await vi.waitFor(async () =>
      expect(await resolve(untrack(() => data.settings("obs"))!.settings)).toEqual({
        _tag: "Failed",
        message: "The RPCs of obs are unavailable: the module is not running in this editor",
      }),
    );
  });

  it("ignores late results after replacing the connection", async () => {
    const { data, applyEvent, connect } = setup();
    untrack(() => data.settings("twitch"));
    const gate = Promise.withResolvers<void>();
    const old = connect(makeConnection("old", gate.promise));
    await connect(makeConnection("new"));
    untrack(() => data.settings("twitch"))!.open();
    gate.resolve();
    await old;

    await vi.waitFor(async () =>
      expect(await state(data, "twitch")).toEqual({ accounts: ["new"], moduleId: "twitch" }),
    );
    expect((await resolve(data.metadata)).endpoints[0]?.id).toBe("new");
    expect(applyEvent).toHaveBeenCalledTimes(1);
    expect(applyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ values: [{ id: "new", display: "new" }] }),
    );
  });

  it("keeps the newest refresh when requests finish out of order", async () => {
    const { data, connect } = setup();
    const connection = makeConnection("initial");
    await connect(connection);
    untrack(() => data.settings("twitch"))!.open();
    await vi.waitFor(() => expect(connection.client.GetModuleClientState).toHaveBeenCalledOnce());
    const gate = Promise.withResolvers<{ accounts: string[]; moduleId: string }>();
    connection.client.GetModuleClientState.mockImplementationOnce(() =>
      Effect.promise(() => gate.promise),
    );
    const old = data.refresh("twitch");
    connection.client.GetModuleClientState.mockImplementationOnce(() =>
      Effect.succeed({ accounts: ["new"], moduleId: "twitch" }),
    );
    await data.refresh("twitch");
    gate.resolve({ accounts: ["old"], moduleId: "twitch" });
    await old;
    expect(await state(data, "twitch")).toEqual({ accounts: ["new"], moduleId: "twitch" });
  });

  it("retains settled data while reconnecting, reconnects open settings and clears on disconnect", async () => {
    const { data, connect, connects } = setup();
    const connection = makeConnection("streamer");
    await connect(connection);
    untrack(() => data.settings("twitch"))!.open();
    await vi.waitFor(async () =>
      expect(await state(data, "twitch")).toEqual({ accounts: ["streamer"], moduleId: "twitch" }),
    );
    data.disconnect(true);
    expect(await state(data, "twitch")).toEqual({ accounts: ["streamer"], moduleId: "twitch" });
    expect((await resolve(data.metadata)).endpoints[0]?.id).toBe("streamer");

    await data.connect(makeConnection("again"), packages, rpcProtocol);
    await vi.waitFor(async () =>
      expect(await state(data, "twitch")).toEqual({ accounts: ["again"], moduleId: "twitch" }),
    );
    expect(connects).toEqual(["in-process", "in-process"]);

    data.disconnect();
    await expect.poll(() => state(data, "twitch")).toBeUndefined();
    expect((await resolve(data.metadata)).endpoints).toEqual([]);
    connection.client.GetModuleClientState.mockClear();
    await data.refresh();
    expect(connection.client.GetModuleClientState).not.toHaveBeenCalled();
  });

  it("reconnects open settings when the catalog's UI for the module changes", async () => {
    const { data, catalog, connect } = setup([]);
    await connect(makeConnection("streamer"));
    expect(untrack(() => data.settings("twitch"))).toBeUndefined();

    const imports: Array<string> = [];
    const loader = createModuleUILoader({
      url: async (url) => {
        imports.push(url);
        return { default: { settings: settingsFor([]) } };
      },
      baseUrl: "https://editor.test/",
      stylesheets: createStylesheets(document),
    });
    const urlData = createRoot(() => createModuleData({ catalog, loader }, vi.fn()));
    const entry = (hash: string) => ({
      ...ModuleCatalogSource.packageEntry(packages[0]!),
      ui: { entryUrl: `/module/twitch/ui/index.js?v=${hash}`, styleUrls: [] },
    });
    await Effect.runPromise(catalog.load(ModuleCatalogSource.fromEntries([entry("a")]), []));
    flush();
    const connection = makeConnection("streamer");
    await urlData.connect(connection, packages, rpcProtocol);
    untrack(() => urlData.settings("twitch"))!.open();
    await vi.waitFor(() => expect(connection.client.GetModuleClientState).toHaveBeenCalledOnce());

    await Effect.runPromise(catalog.load(ModuleCatalogSource.fromEntries([entry("b")]), []));
    await vi.waitFor(() => expect(connection.client.GetModuleClientState).toHaveBeenCalledTimes(2));
    expect(imports).toEqual([
      "https://editor.test/module/twitch/ui/index.js?v=a",
      "https://editor.test/module/twitch/ui/index.js?v=b",
    ]);
  });

  it("does not restore in-flight state or resources after disconnecting", async () => {
    const { data, applyEvent, connect } = setup();
    const gate = Promise.withResolvers<void>();
    const pending = connect(makeConnection("old", gate.promise));
    data.disconnect();
    gate.resolve();
    await pending;
    data.disconnect();
    expect((await resolve(data.metadata)).endpoints).toEqual([]);
    expect(applyEvent).not.toHaveBeenCalled();
  });
});
