import type { Manifest } from "@macrograph/module/Manifest";
import type { ModuleId } from "@macrograph/module/ModuleId";

import { assert, describe, it } from "@effect/vitest";
import { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import { Effect, Exit, Fiber, Layer, Option, Stream } from "effect";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ModuleRegistry } from "../src/ModuleRegistry.ts";
import { ModuleTrust } from "../src/ModuleTrust.ts";
import {
  copyFixture,
  local,
  makeTestMounter,
  official,
  registryLayer,
  tempDir,
  versionedDir,
  writeModule,
} from "./helpers.ts";

const getEntry = (id: ModuleId.Id) =>
  Effect.gen(function* () {
    const registry = yield* ModuleRegistry.Service;
    const entry = yield* registry.get(id);
    assert.isTrue(Option.isSome(entry), `expected an entry for ${id}`);
    return Option.getOrThrow(entry);
  });

const deploymentField = (entry: ModuleRegistry.Entry, field: string) =>
  Option.match(entry.loaded, {
    onNone: () => undefined,
    onSome: (loaded) =>
      typeof loaded.deployment === "object" && loaded.deployment !== null
        ? Reflect.get(loaded.deployment, field)
        : undefined,
  });

const errorOf = (entry: ModuleRegistry.Entry) => Option.getOrElse(entry.error, () => "");

describe("ModuleRegistry", () => {
  it.effect("loads every source on startup and isolates failures", () => {
    const shipped = tempDir();
    const dataDir = tempDir();
    copyFixture("effect-check", versionedDir(shipped, official("effect-check"), "1.0.0"));
    copyFixture("throws", versionedDir(shipped, official("throws"), "1.0.0"));
    copyFixture("disallowed", versionedDir(shipped, official("disallowed"), "1.0.0"));
    copyFixture("missing-service", versionedDir(shipped, official("missing-service"), "1.0.0"));
    copyFixture(
      "node-builtin",
      versionedDir(join(dataDir, "modules", "installed"), official("node-builtin"), "1.0.0"),
    );
    copyFixture("effect-check", join(dataDir, "modules", "local", "fixtures", "effect-check"));
    const mounter = makeTestMounter();

    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      const statuses = Object.fromEntries(
        [...(yield* registry.entries).values()].map((entry) => [entry.id, entry.status]),
      );
      assert.deepStrictEqual(statuses, {
        [official("effect-check")]: "loaded",
        [official("throws")]: "failed",
        [official("disallowed")]: "failed",
        [official("missing-service")]: "failed",
        [official("node-builtin")]: "loaded",
        [local("effect-check")]: "loaded",
      });
      assert.deepStrictEqual(
        [...mounter.mounted.keys()].sort(),
        [local("effect-check"), official("effect-check"), official("node-builtin")].sort(),
      );
      assert.include(errorOf(yield* getEntry(official("throws"))), "fixture exploded");
      assert.include(errorOf(yield* getEntry(official("disallowed"))), 'cannot require "lodash"');

      const installed = yield* getEntry(official("node-builtin"));
      assert.deepStrictEqual(installed.source, Option.some("installed"));
      assert.deepStrictEqual((yield* getEntry(local("effect-check"))).source, Option.some("local"));
    }).pipe(
      Effect.provide(
        registryLayer(
          { dataDir, shippedDirs: [shipped], hostServices: ["http-client"] },
          mounter.layer,
        ),
      ),
    );
  });

  it.effect("fails modules that need missing host services before mounting them", () => {
    const shipped = tempDir();
    copyFixture("missing-service", versionedDir(shipped, official("missing-service"), "1.0.0"));
    const mounter = makeTestMounter();
    return Effect.gen(function* () {
      const entry = yield* getEntry(official("missing-service"));
      assert.strictEqual(entry.status, "failed");
      assert.strictEqual(
        errorOf(entry),
        "Requires host services this host doesn't provide: credentials",
      );
      assert.deepStrictEqual(mounter.events, []);
    }).pipe(
      Effect.provide(
        registryLayer({ shippedDirs: [shipped], hostServices: ["http-client"] }, mounter.layer),
      ),
    );
  });

  it.effect("selects versions across shipped and installed copies", () => {
    const shipped = tempDir();
    const dataDir = tempDir();
    const installed = join(dataDir, "modules", "installed");
    const upgraded = official("upgraded");
    const pinned = official("pinned");
    writeModule(versionedDir(shipped, upgraded, "1.0.0"), { name: "upgraded", version: "1.0.0" });
    writeModule(versionedDir(installed, upgraded, "1.2.0"), { name: "upgraded", version: "1.2.0" });
    writeModule(versionedDir(installed, upgraded, "1.1.0"), { name: "upgraded", version: "1.1.0" });
    writeModule(versionedDir(shipped, pinned, "1.0.0"), { name: "pinned", version: "1.0.0" });
    writeModule(versionedDir(installed, pinned, "2.0.0"), {
      name: "pinned",
      version: "2.0.0",
      api: 2,
    });

    return Effect.gen(function* () {
      const upgradedEntry = yield* getEntry(upgraded);
      assert.strictEqual(deploymentField(upgradedEntry, "version"), "1.2.0");
      assert.deepStrictEqual(upgradedEntry.source, Option.some("installed"));
      assert.strictEqual(upgradedEntry.copies.length, 3);

      const pinnedEntry = yield* getEntry(pinned);
      assert.strictEqual(deploymentField(pinnedEntry, "version"), "1.0.0");
      assert.deepStrictEqual(pinnedEntry.source, Option.some("shipped"));
      assert.isTrue(pinnedEntry.flags.incompatibleInstalled);
    }).pipe(Effect.provide(registryLayer({ dataDir, shippedDirs: [shipped] })));
  });

  it.effect("loads the newer api when the host supports it", () => {
    const shipped = tempDir();
    const dataDir = tempDir();
    const id = official("pinned");
    writeModule(versionedDir(shipped, id, "1.0.0"), { name: "pinned", version: "1.0.0" });
    writeModule(versionedDir(join(dataDir, "modules", "installed"), id, "2.0.0"), {
      name: "pinned",
      version: "2.0.0",
      api: 2,
    });
    return Effect.gen(function* () {
      const entry = yield* getEntry(id);
      assert.strictEqual(deploymentField(entry, "version"), "2.0.0");
      assert.isFalse(entry.flags.incompatibleInstalled);
    }).pipe(
      Effect.provide(registryLayer({ dataDir, shippedDirs: [shipped], supportedApis: [1, 2] })),
    );
  });

  it.effect("rejects folders whose manifest disagrees with their location", () => {
    const shipped = tempDir();
    const id = official("liar");
    writeModule(versionedDir(shipped, id, "1.0.0"), { name: "liar", version: "1.0.1" });
    return Effect.gen(function* () {
      const entry = yield* getEntry(id);
      assert.strictEqual(entry.status, "failed");
      assert.include(errorOf(entry), "Manifest declares version 1.0.1, but the folder is 1.0.0");
    }).pipe(Effect.provide(registryLayer({ shippedDirs: [shipped] })));
  });

  it.effect("lets a dev link override shipped copies and persists it", () => {
    const shipped = tempDir();
    const dataDir = tempDir();
    const id = official("linkable");
    writeModule(versionedDir(shipped, id, "1.0.0"), {
      name: "linkable",
      version: "1.0.0",
      tag: "shipped",
    });
    const devFolder = writeModule(join(tempDir(), "dev"), {
      name: "linkable",
      version: "0.0.1",
      tag: "dev",
    });
    const wrongFolder = writeModule(join(tempDir(), "wrong"), { name: "other", version: "1.0.0" });
    const mounter = makeTestMounter();
    const layer = registryLayer({ dataDir, shippedDirs: [shipped] }, mounter.layer);

    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const registry = yield* ModuleRegistry.Service;
        assert.strictEqual(deploymentField(yield* getEntry(id), "tag"), "shipped");

        const linked = yield* registry.link(id, devFolder);
        assert.strictEqual(linked.status, "loaded");
        assert.deepStrictEqual(linked.source, Option.some("linked"));
        assert.strictEqual(deploymentField(linked, "tag"), "dev");

        const invalid = yield* Effect.exit(registry.link(id, wrongFolder));
        assert.isTrue(Exit.isFailure(invalid));
        const localLink = yield* Effect.exit(registry.link(local("linkable"), devFolder));
        assert.isTrue(Exit.isFailure(localLink));
      }).pipe(Effect.provide(layer));

      const state = JSON.parse(readFileSync(join(dataDir, "modules", "state.json"), "utf8"));
      assert.deepStrictEqual(state.links, { [id]: { path: devFolder } });

      // A new registry over the same data directory starts with the link.
      yield* Effect.gen(function* () {
        const registry = yield* ModuleRegistry.Service;
        assert.strictEqual(deploymentField(yield* getEntry(id), "tag"), "dev");
        const after = yield* registry.unlink(id);
        assert.deepStrictEqual(
          Option.map(after, (entry) => deploymentField(entry, "tag")),
          Option.some("shipped"),
        );
        const missing = yield* Effect.exit(registry.unlink(id));
        assert.isTrue(Exit.isFailure(missing));
      }).pipe(Effect.provide(layer));
    });
  });

  it.effect("enables and disables modules and remembers it", () => {
    const shipped = tempDir();
    const dataDir = tempDir();
    const id = official("toggle");
    writeModule(versionedDir(shipped, id, "1.0.0"), { name: "toggle", version: "1.0.0" });
    const mounter = makeTestMounter();
    const layer = registryLayer({ dataDir, shippedDirs: [shipped] }, mounter.layer);

    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const registry = yield* ModuleRegistry.Service;
        const disabled = yield* registry.setEnabled(id, false);
        assert.strictEqual(disabled.status, "disabled");
        assert.isFalse(mounter.mounted.has(id));
        const loadDisabled = yield* registry.load(id);
        assert.strictEqual(loadDisabled.status, "disabled");
      }).pipe(Effect.provide(layer));

      yield* Effect.gen(function* () {
        const registry = yield* ModuleRegistry.Service;
        assert.strictEqual((yield* getEntry(id)).status, "disabled");
        assert.isFalse(mounter.mounted.has(id));
        const enabled = yield* registry.setEnabled(id, true);
        assert.strictEqual(enabled.status, "loaded");
        assert.isTrue(mounter.mounted.has(id));
        const missing = yield* Effect.exit(registry.setEnabled(official("nope"), true));
        assert.deepStrictEqual(
          missing,
          Exit.fail(new ModuleAdminRpc.ModuleNotFound({ id: official("nope") })),
        );
      }).pipe(Effect.provide(layer));
    });
  });

  it.effect("unloads before loading again on reload", () => {
    const shipped = tempDir();
    const id = official("reloadable");
    writeModule(versionedDir(shipped, id, "1.0.0"), { name: "reloadable", version: "1.0.0" });
    const mounter = makeTestMounter();
    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      const before = deploymentField(yield* getEntry(id), "version");
      yield* Effect.all([registry.reload(id), registry.reload(id)], { concurrency: "unbounded" });
      assert.deepStrictEqual(mounter.events, [
        `mount ${id}`,
        `unmount ${id}`,
        `mount ${id}`,
        `unmount ${id}`,
        `mount ${id}`,
      ]);
      assert.strictEqual(deploymentField(yield* getEntry(id), "version"), before);

      const unloaded = yield* registry.unload(id);
      assert.strictEqual(unloaded.status, "discovered");
      assert.strictEqual(mounter.mounted.size, 0);
      const notLoaded = yield* Effect.exit(registry.rpcHandler(id));
      assert.deepStrictEqual(
        notLoaded,
        Exit.fail(new ModuleAdminRpc.ModuleNotLoaded({ id, status: "discovered" })),
      );
      const loaded = yield* registry.load(id);
      assert.strictEqual(loaded.status, "loaded");
    }).pipe(Effect.provide(registryLayer({ shippedDirs: [shipped] }, mounter.layer)));
  });

  it.effect("rescans: loads new modules, removes deleted ones and flags changed ones stale", () => {
    const dataDir = tempDir();
    const localRoot = join(dataDir, "modules", "local", "fixtures");
    const kept = local("kept");
    const removed = local("removed");
    const added = local("added");
    writeModule(join(localRoot, "kept"), { name: "kept", version: "1.0.0" });
    writeModule(join(localRoot, "removed"), { name: "removed", version: "1.0.0" });
    const mounter = makeTestMounter();

    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      assert.strictEqual(mounter.mounted.size, 2);

      writeModule(join(localRoot, "added"), { name: "added", version: "1.0.0" });
      rmSync(join(localRoot, "removed"), { recursive: true });
      appendFileSync(join(localRoot, "kept", "server.cjs"), "// changed\n");
      const entries = yield* registry.rescan;

      assert.isTrue(entries.has(added));
      assert.isFalse(entries.has(removed));
      assert.isFalse(mounter.mounted.has(removed));
      assert.strictEqual(entries.get(added)?.status, "loaded");
      const keptEntry = entries.get(kept);
      assert.strictEqual(keptEntry?.status, "loaded");
      assert.isTrue(keptEntry?.flags.stale);
      // Rescanning never reloads by itself.
      assert.deepStrictEqual(
        mounter.events.filter((event) => event.endsWith(kept)),
        [`mount ${kept}`],
      );

      const reloaded = yield* registry.reload(kept);
      assert.isFalse(reloaded.flags.stale);
      const unknown = yield* Effect.exit(registry.reload(removed));
      assert.isTrue(Exit.isFailure(unknown));
    }).pipe(Effect.provide(registryLayer({ dataDir }, mounter.layer)));
  });

  it.effect("flags local modules whose files changed when checking staleness", () => {
    const dataDir = tempDir();
    const folder = writeModule(join(dataDir, "modules", "local", "fixtures", "edited"), {
      name: "edited",
      version: "1.0.0",
    });
    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      yield* registry.checkStale;
      assert.isFalse((yield* getEntry(local("edited"))).flags.stale);
      appendFileSync(join(folder, "server.cjs"), "// edited\n");
      yield* registry.checkStale;
      const entry = yield* getEntry(local("edited"));
      assert.isTrue(entry.flags.stale);
      assert.strictEqual(entry.status, "loaded");
    }).pipe(Effect.provide(registryLayer({ dataDir })));
  });

  it.effect("projects the catalog with content-hashed URLs and serves files safely", () => {
    const shipped = tempDir();
    const id = official("with-ui");
    copyFixture("with-ui", versionedDir(shipped, id, "1.0.0"));
    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      const [entry] = yield* registry.catalog;
      assert.isDefined(entry);
      if (entry === undefined) return;
      const prefix = `/module/macrograph.app/fixtures/with-ui`;
      const version = /\/ui\/([0-9a-f]{16})\/index\.js$/.exec(entry.ui?.entryUrl ?? "")?.[1];
      assert.isDefined(version);
      assert.deepStrictEqual(entry.ui, {
        entryUrl: `${prefix}/ui/${version}/index.js`,
        styleUrls: [`${prefix}/ui/${version}/styles.css`],
      });
      assert.strictEqual(entry.iconUrl, `${prefix}/assets/${version}/icon.svg`);
      assert.strictEqual(entry.displayName, "With UI");
      assert.strictEqual(entry.source, "shipped");

      const file = yield* registry.staticFile(id, "ui", `${version}/index.js`);
      assert.isTrue(Option.isSome(file));
      assert.isTrue(Option.exists(file, (value) => value.immutable));
      const old = yield* registry.staticFile(id, "assets", "0000000000000000/icon.svg");
      assert.isTrue(Option.exists(old, (value) => !value.immutable));
      assert.isTrue(
        Option.isNone(yield* registry.staticFile(id, "ui", `${version}/../server.cjs`)),
      );
      assert.isTrue(Option.isNone(yield* registry.staticFile(id, "ui", `${version}/missing.js`)));
      assert.isTrue(
        Option.isNone(yield* registry.staticFile(id, "assets", `${version}/../ui/index.js`)),
      );

      const rpc = yield* registry.rpcHandler(id);
      assert.isTrue(Option.isSome(rpc));
      const unknown = yield* Effect.exit(registry.rpcHandler(official("unknown")));
      assert.deepStrictEqual(
        unknown,
        Exit.fail(new ModuleAdminRpc.ModuleNotFound({ id: official("unknown") })),
      );

      const [details] = yield* registry.details;
      assert.strictEqual(details?.enabled, true);
      assert.strictEqual(details?.copies.length, 1);
      assert.strictEqual(details?.contentHash?.slice(0, 16), version);
      assert.strictEqual(details?.manifest?.name, "with-ui");
    }).pipe(Effect.provide(registryLayer({ shippedDirs: [shipped] })));
  });

  it.effect("loads static modules without evaluating anything", () => {
    const manifest = (name: string): Manifest.Model => ({
      manifest: 1,
      publisher: "fixtures",
      name,
      version: "1.0.0",
      api: 1,
      displayName: name,
      server: "server.cjs",
    });
    const deployment = { kind: "static" };
    const mounter = makeTestMounter();
    return Effect.gen(function* () {
      const entry = yield* getEntry(official("static"));
      assert.strictEqual(entry.status, "loaded");
      assert.strictEqual(mounter.mounted.get(official("static"))?.deployment, deployment);
      assert.deepStrictEqual(entry.source, Option.some("shipped"));

      const refused = yield* getEntry(official("refused"));
      assert.strictEqual(refused.status, "failed");
      assert.include(errorOf(refused), "Mounting failed: refused by test");
      assert.isTrue(Option.isNone(refused.loaded));
    }).pipe(
      Effect.provide(
        registryLayer(
          {
            staticModules: [
              { manifest: manifest("static"), deployment },
              { manifest: manifest("refused"), deployment: { failMount: true } },
            ],
          },
          mounter.layer,
        ),
      ),
    );
  });

  it.effect("takes trust and registry flags from the trust provider", () => {
    const shipped = tempDir();
    const id = official("trusted");
    writeModule(versionedDir(shipped, id, "1.0.0"), { name: "trusted", version: "1.0.0" });
    let revoked = false;
    const trust = Layer.succeed(ModuleTrust.Service, {
      lookup: () =>
        Effect.succeed({
          trust: Option.some({ registry: "macrograph.app", installed: "trusted" as const }),
          revoked,
          updateAvailable: true,
        }),
    });
    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      const entry = yield* getEntry(id);
      assert.isTrue(entry.flags.updateAvailable);
      assert.isFalse(entry.flags.revoked);
      assert.deepStrictEqual(
        entry.trust,
        Option.some({ registry: "macrograph.app", installed: "trusted" }),
      );
      revoked = true;
      yield* registry.refreshTrust;
      const after = yield* getEntry(id);
      assert.isTrue(after.flags.revoked);
      assert.strictEqual(after.status, "loaded");
    }).pipe(
      Effect.provide(registryLayer({ shippedDirs: [shipped] }, makeTestMounter().layer, trust)),
    );
  });

  it.effect("publishes every change", () => {
    const shipped = tempDir();
    const id = official("observed");
    writeModule(versionedDir(shipped, id, "1.0.0"), { name: "observed", version: "1.0.0" });
    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      const statuses = yield* registry.changes.pipe(
        Stream.map((entries) => entries.get(id)?.status),
        Stream.take(4),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* registry.reload(id);
      const collected = yield* Fiber.join(statuses);
      assert.deepStrictEqual([...collected], ["loaded", "discovered", "loading", "loaded"]);
    }).pipe(Effect.provide(registryLayer({ shippedDirs: [shipped] })));
  });

  it.live("marks modules stale when the watcher sees changes", () => {
    const dataDir = tempDir();
    const folder = writeModule(join(dataDir, "modules", "local", "fixtures", "watched"), {
      name: "watched",
      version: "1.0.0",
    });
    const id = local("watched");
    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      assert.isFalse((yield* getEntry(id)).flags.stale);
      // Give the native watchers time to start before changing anything.
      yield* Effect.sleep("300 millis");
      appendFileSync(join(folder, "server.cjs"), "// watched change\n");
      const stale = yield* registry.changes.pipe(
        Stream.filter((entries) => entries.get(id)?.flags.stale === true),
        Stream.runHead,
        Effect.timeout("10 seconds"),
      );
      assert.isTrue(Option.isSome(stale));
      assert.strictEqual((yield* getEntry(id)).status, "loaded");
    }).pipe(Effect.provide(registryLayer({ dataDir, watch: { debounce: "50 millis" } })));
  });

  it.live("reloads changed local modules when auto reload is on", () => {
    const dataDir = tempDir();
    const folder = writeModule(join(dataDir, "modules", "local", "fixtures", "reloaded"), {
      name: "reloaded",
      version: "1.0.0",
    });
    const id = local("reloaded");
    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      const before = Option.getOrUndefined((yield* getEntry(id)).contentHash);
      yield* Effect.sleep("300 millis");
      appendFileSync(join(folder, "server.cjs"), "// reloaded change\n");
      const reloaded = yield* registry.changes.pipe(
        Stream.map((entries) => entries.get(id)),
        Stream.filter(
          (entry) =>
            entry?.status === "loaded" && Option.getOrUndefined(entry.contentHash) !== before,
        ),
        Stream.runHead,
        Effect.timeout("10 seconds"),
      );
      assert.isTrue(Option.isSome(reloaded));
      const entry = yield* getEntry(id);
      assert.isFalse(entry.flags.stale);
      assert.strictEqual(entry.status, "loaded");
    }).pipe(
      Effect.provide(
        registryLayer({ dataDir, watch: { debounce: "50 millis", autoReload: true } }),
      ),
    );
  });

  it.live(
    "auto reload waits out a rebuild that empties the folder and writes the manifest last",
    () => {
      const dataDir = tempDir();
      const folder = writeModule(join(dataDir, "modules", "local", "fixtures", "rebuilt"), {
        name: "rebuilt",
        version: "1.0.0",
      });
      const id = local("rebuilt");
      return Effect.gen(function* () {
        const registry = yield* ModuleRegistry.Service;
        yield* Effect.sleep("300 millis");
        const manifest = readFileSync(join(folder, "macrograph.json"), "utf8");
        // Like `macrograph-module dev`: empty the folder, write the bundle, then the manifest.
        rmSync(folder, { recursive: true, force: true });
        yield* Effect.sleep("200 millis");
        assert.isTrue(Option.isSome(yield* registry.get(id)), "kept while the folder is empty");
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "server.cjs"), `exports.default = { tag: "rebuilt" };\n`);
        yield* Effect.sleep("200 millis");
        assert.isTrue(Option.isSome(yield* registry.get(id)), "kept until the manifest is back");
        writeFileSync(join(folder, "macrograph.json"), manifest);
        const reloaded = yield* registry.changes.pipe(
          Stream.map((entries) => entries.get(id)),
          Stream.filter(
            (entry) =>
              entry?.status === "loaded" &&
              !entry.flags.stale &&
              deploymentField(entry, "tag") === "rebuilt",
          ),
          Stream.runHead,
          Effect.timeout("10 seconds"),
        );
        assert.isTrue(Option.isSome(reloaded));
      }).pipe(
        Effect.provide(
          registryLayer({ dataDir, watch: { debounce: "50 millis", autoReload: true } }),
        ),
      );
    },
    15000,
  );

  it.live("watches a local folder created after startup once a rescan loads it", () => {
    const dataDir = tempDir();
    const id = local("late");
    return Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      assert.isTrue(Option.isNone(yield* registry.get(id)));
      yield* Effect.sleep("300 millis");
      const folder = writeModule(join(dataDir, "modules", "local", "fixtures", "late"), {
        name: "late",
        version: "1.0.0",
      });
      yield* registry.rescan;
      assert.strictEqual((yield* getEntry(id)).status, "loaded");
      yield* Effect.sleep("300 millis");
      appendFileSync(join(folder, "server.cjs"), "// late change\n");
      const stale = yield* registry.changes.pipe(
        Stream.filter((entries) => entries.get(id)?.flags.stale === true),
        Stream.runHead,
        Effect.timeout("10 seconds"),
      );
      assert.isTrue(Option.isSome(stale));
    }).pipe(Effect.provide(registryLayer({ dataDir, watch: { debounce: "50 millis" } })));
  });
});
