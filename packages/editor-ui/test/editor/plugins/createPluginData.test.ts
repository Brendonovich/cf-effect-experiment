import { PackageId } from "@macrograph/core";
import { Effect } from "effect";
import { createRoot, resolve } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPluginData } from "../../../src/editor/plugins/createPluginData";

// Exercise the client async runtime rather than Solid's server-side primitives.
vi.mock(
  "solid-js",
  () => import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href),
);

const packages = [
  { id: PackageId.make("twitch"), resources: [{ id: "TwitchAccount", name: "Twitch Account" }] },
  { id: PackageId.make("obs"), resources: [] },
];
const descriptors = packages.map((pkg) => ({ id: pkg.id, initial: { accounts: [] } }));
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
    GetPluginSettingsCapabilities: vi.fn(() =>
      Effect.succeed([{ pluginId: "twitch" }, { pluginId: "obs" }]),
    ),
    GetPluginClientState: vi.fn(({ pluginId }: { pluginId: string }) =>
      Effect.promise(async () => {
        await gate;
        return { accounts: [name], pluginId };
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
  pluginSettings: new Map(
    packages.map((pkg) => [
      pkg.id,
      {
        load: (getState: (pluginId: string) => Effect.Effect<unknown, unknown>) => getState(pkg.id),
        render: () => undefined,
      },
    ]),
  ),
});

let dispose: () => void;
const setup = () =>
  createRoot((cleanup) => {
    dispose = cleanup;
    const applyEvent = vi.fn();
    return { data: createPluginData(descriptors, applyEvent), applyEvent };
  });

afterEach(() => dispose?.());

describe("plugin data", () => {
  it("loads from an explicit connection and package list without committing UI state", async () => {
    const { data, applyEvent } = setup();
    const connection = makeConnection("streamer");
    await data.connect(connection, packages);

    expect(await resolve(data.states.get("twitch")!)).toEqual({
      accounts: ["streamer"],
      pluginId: "twitch",
    });
    expect((await resolve(data.metadata)).capabilities).toEqual(new Set(["twitch", "obs"]));
    expect(applyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "ResourceValuesUpdated",
        package: "twitch",
        resource: "TwitchAccount",
        values: [{ id: "streamer", display: "streamer" }],
      }),
    );

    connection.client.GetPluginClientState.mockClear();
    await data.refresh("twitch");
    expect(connection.client.GetPluginClientState).toHaveBeenCalledExactlyOnceWith({
      pluginId: "twitch",
    });
  });

  it("ignores late results after replacing the connection", async () => {
    const { data, applyEvent } = setup();
    const gate = Promise.withResolvers<void>();
    const old = data.connect(makeConnection("old", gate.promise), packages);
    await data.connect(makeConnection("new"), packages);
    gate.resolve();
    await old;

    expect(await resolve(data.states.get("twitch")!)).toEqual({
      accounts: ["new"],
      pluginId: "twitch",
    });
    expect((await resolve(data.metadata)).endpoints[0]?.id).toBe("new");
    expect(applyEvent).toHaveBeenCalledTimes(1);
    expect(applyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ values: [{ id: "new", display: "new" }] }),
    );
  });

  it("keeps the newest refresh when requests finish out of order", async () => {
    const { data } = setup();
    const connection = makeConnection("initial");
    await data.connect(connection, packages);
    const gate = Promise.withResolvers<{ accounts: string[]; pluginId: string }>();
    connection.client.GetPluginClientState.mockImplementationOnce(() =>
      Effect.promise(() => gate.promise),
    );
    const old = data.refresh("twitch");
    expect(connection.client.GetPluginClientState).toHaveBeenCalledTimes(3);
    connection.client.GetPluginClientState.mockImplementationOnce(() =>
      Effect.succeed({ accounts: ["new"], pluginId: "twitch" }),
    );
    await data.refresh("twitch");
    gate.resolve({ accounts: ["old"], pluginId: "twitch" });
    await old;
    expect(await resolve(data.states.get("twitch")!)).toEqual({
      accounts: ["new"],
      pluginId: "twitch",
    });
  });

  it("retains settled data while reconnecting and clears it on disconnect", async () => {
    const { data } = setup();
    const connection = makeConnection("streamer");
    await data.connect(connection, packages);
    data.disconnect(true);
    expect(await resolve(data.states.get("twitch")!)).toEqual({
      accounts: ["streamer"],
      pluginId: "twitch",
    });
    expect((await resolve(data.metadata)).endpoints[0]?.id).toBe("streamer");
    data.disconnect();
    await expect.poll(() => resolve(data.states.get("twitch")!)).toEqual({ accounts: [] });
    expect((await resolve(data.metadata)).endpoints).toEqual([]);
    connection.client.GetPluginClientState.mockClear();
    await data.refresh();
    expect(connection.client.GetPluginClientState).not.toHaveBeenCalled();
  });

  it("awaits the actual refresh request and keeps settled data if it fails", async () => {
    const { data } = setup();
    const connection = makeConnection("initial");
    await data.connect(connection, packages);
    const gate = Promise.withResolvers<{ accounts: string[]; pluginId: string }>();
    connection.client.GetPluginClientState.mockImplementationOnce(() =>
      Effect.promise(() => gate.promise),
    );
    let completed = false;
    const pending = data.refresh("twitch").then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    gate.resolve({ accounts: ["refreshed"], pluginId: "twitch" });
    await pending;
    connection.client.GetPluginClientState.mockImplementationOnce(() =>
      Effect.die("Failed refresh"),
    );
    await data.refresh("twitch");
    expect(await resolve(data.states.get("twitch")!)).toEqual({
      accounts: ["refreshed"],
      pluginId: "twitch",
    });
  });

  it("does not restore in-flight state or resources after disconnecting", async () => {
    const { data, applyEvent } = setup();
    const gate = Promise.withResolvers<void>();
    const pending = data.connect(makeConnection("old", gate.promise), packages);
    data.disconnect();
    gate.resolve();
    await pending;
    expect(await resolve(data.states.get("twitch")!)).toEqual({ accounts: [] });
    expect((await resolve(data.metadata)).endpoints).toEqual([]);
    expect(applyEvent).not.toHaveBeenCalled();
  });
});
