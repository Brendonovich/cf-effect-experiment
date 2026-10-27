import { PackageId, Project } from "@macrograph/core";
import { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Effect, PubSub, Queue, Stream } from "effect";
import { createRoot, flush, untrack } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorRpcClient } from "../../../src/editor/Editor";

import { createModuleCatalog } from "../../../src/editor/modules/createModuleCatalog";
import { ModuleCatalogSource } from "../../../src/editor/modules/ModuleCatalogSource";
import { ModuleRpcProtocol } from "../../../src/editor/modules/ModuleRpcProtocol";
import { createModuleUILoader } from "../../../src/editor/modules/ModuleUILoader";
import { createEditorConnection } from "../../../src/editor/session/createEditorConnection";
import { createEditorStore } from "../../../src/editor/store";

vi.mock(
  "solid-js",
  () => import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href),
);

let dispose = () => {};
afterEach(() => dispose());

const packages = [
  { id: PackageId.make("twitch"), name: "Twitch", resources: [], schemas: [] },
  { id: PackageId.make("obs"), name: "OBS", resources: [], schemas: [] },
];

const entry = (name: string, version = "1.0.0"): ModuleCatalog.Entry => ({
  id: ModuleId.make({ namespace: "macrograph.app", publisher: "macrograph", name }),
  version,
  displayName: name,
  source: "shipped",
  status: "loaded",
  flags: ModuleCatalog.noFlags,
  ui: {
    entryUrl: `/module/macrograph.app/macrograph/${name}/ui/index.js?v=${version}`,
    styleUrls: [],
  },
});

describe("module catalog", () => {
  it("builds a static catalog from the bundled packages", async () => {
    const catalog = createRoot((cleanup) => {
      dispose = cleanup;
      return createModuleCatalog();
    });
    await Effect.runPromise(catalog.load(ModuleCatalogSource.fromPackages, packages));
    flush();
    expect(untrack(catalog.entries).map((value) => value.id)).toEqual(["twitch", "obs"]);
    expect(untrack(() => catalog.get("obs"))).toMatchObject({
      displayName: "OBS",
      status: "loaded",
      source: "shipped",
    });
    catalog.clear(true);
    expect(catalog.current().size).toBe(2);
    catalog.clear();
    flush();
    expect(untrack(catalog.entries)).toEqual([]);
  });

  it("keeps the newest load and the previous catalog when a fetch fails", async () => {
    const catalog = createRoot((cleanup) => {
      dispose = cleanup;
      return createModuleCatalog();
    });
    const changes = vi.fn();
    catalog.onChange(changes);
    const gate = Promise.withResolvers<ReadonlyArray<ModuleCatalog.Entry>>();
    const slow = catalog.load({ fetch: () => Effect.promise(() => gate.promise) }, []);
    const pending = Effect.runPromise(slow);
    await Effect.runPromise(catalog.load(ModuleCatalogSource.fromEntries([entry("b")]), []));
    gate.resolve([entry("a")]);
    await pending;
    await Effect.runPromise(catalog.load({ fetch: () => Effect.fail("offline") }, []));
    expect([...catalog.current().keys()]).toEqual([entry("b").id]);
    expect(changes).toHaveBeenCalledOnce();
  });

  it("fetches the catalog over GetModules on connect and again on every ModulesChanged", async () => {
    const changed = Effect.runSync(PubSub.unbounded<{ readonly _tag: "ModulesChanged" }>());
    const projectEvents = Effect.runSync(Queue.unbounded<{ readonly _tag: string }>());
    let version = 0;
    const GetModules = vi.fn(() => Effect.sync(() => [entry("twitch", `1.0.${version++}`)]));
    const GetPackages = vi.fn(() => Effect.succeed(packages));
    const client = {
      GetPackages,
      GetIngressEndpoints: () => Effect.succeed([]),
      GetModuleSettingsCapabilities: () => Effect.succeed([]),
      QueueStateStream: () => Stream.never,
      PresenceStream: () => Stream.never,
      ProjectEventsStream: () =>
        Stream.succeed({
          _tag: "ProjectSnapshot",
          snapshot: { project: { ...Project.empty(), graphs: {} }, nodeIO: {} },
        }).pipe(Stream.concat(Stream.fromQueue(projectEvents))),
    };
    const connection = createRoot((cleanup) => {
      dispose = cleanup;
      return createEditorConnection(
        {
          loader: createModuleUILoader({ url: async () => ({ default: {} }) }),
          connection: Effect.succeed({
            connection: { client: client as unknown as EditorRpcClient },
            modules: {
              catalog: ModuleCatalogSource.fromRpc({
                client: { GetModules },
                changes: Stream.fromPubSub(changed),
              }),
              rpcProtocol: ModuleRpcProtocol.unavailable,
            },
          }),
        },
        createEditorStore(),
        () => {},
        () => {},
      );
    });
    await vi.waitFor(() => expect(untrack(connection.editorReady)).toBe(true));
    expect(GetModules).toHaveBeenCalledOnce();
    expect(connection.moduleCatalog.current().get(entry("twitch").id)?.version).toBe("1.0.0");

    await Effect.runPromise(PubSub.publish(changed, { _tag: "ModulesChanged" } as const));
    await vi.waitFor(() => expect(GetModules).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(connection.moduleCatalog.current().get(entry("twitch").id)?.version).toBe("1.0.1"),
    );
    expect(GetPackages).toHaveBeenCalledTimes(2);

    // The editor event stream carries `ModulesChanged` once the server sends it there.
    await Effect.runPromise(Queue.offer(projectEvents, { _tag: "ModulesChanged" }));
    await vi.waitFor(() =>
      expect(connection.moduleCatalog.current().get(entry("twitch").id)?.version).toBe("1.0.2"),
    );
  });
});
