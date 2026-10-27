import { assert, describe, it } from "@effect/vitest";
import { Signing } from "@macrograph/module-registry/Signing";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Effect, Exit, Layer, Option, Stream } from "effect";
import { HttpClient } from "effect/http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AdminHandlers, InstallRecords, Installer, ModuleStatus } from "../src/index.ts";
import {
  directory,
  file,
  httpClient,
  makeRegistry,
  manifest,
  tarball,
  type FixtureRegistry,
} from "./fixture.ts";

const officialUrl = "https://registry.macrograph.test";
const thirdPartyUrl = "https://modules.example.com/registry";
const thirdPartyNamespace = "modules.example.com";

const officialId = ModuleId.make({
  namespace: ModuleId.OfficialNamespace,
  publisher: "bob",
  name: "lights",
});
const thirdPartyId = ModuleId.make({
  namespace: thirdPartyNamespace,
  publisher: "bob",
  name: "lights",
});

interface Setup {
  readonly official: FixtureRegistry;
  readonly thirdParty: FixtureRegistry;
  readonly installer: Installer.Interface;
  readonly dataDir: string;
}

const tempDir = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "mg-installer-"))),
  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
);

const setup = (options: { readonly officialKeys?: ReadonlyArray<Signing.KeyPair> } = {}) =>
  Effect.gen(function* () {
    const dataDir = yield* tempDir;
    const official = yield* makeRegistry(officialUrl, ModuleId.OfficialNamespace);
    const thirdParty = yield* makeRegistry(thirdPartyUrl, thirdPartyNamespace);
    const keys = (options.officialKeys ?? [official.keys]).map((pair) => ({
      id: official.keyId,
      algorithm: "Ed25519" as const,
      publicKey: pair.publicKey,
    }));
    const layer = Installer.layer({ dataDir, official: { url: officialUrl, keys } }).pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient([official, thirdParty]))),
    );
    const installer = yield* Effect.provide(
      Effect.gen(function* () {
        return yield* Installer.Service;
      }),
      layer,
    );
    return { official, thirdParty, installer, dataDir } satisfies Setup;
  });

const request = (
  id: ModuleId.Id,
  extra: Partial<Installer.InstallRequest> = {},
): Installer.InstallRequest => ({
  id,
  acknowledgeUntrusted: false,
  actor: "admin-1",
  ...extra,
});

const failureTag = <A, E extends { readonly _tag: string }>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error._tag] : []))[0]
    : undefined;

const failure = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? exit.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []))[0]
    : undefined;

describe("Installer", () => {
  it.effect("installs a trusted release from the official registry", () =>
    Effect.gen(function* () {
      const { official, installer, dataDir } = yield* setup();
      yield* official.publish({ version: "1.0.0", manifest: { requires: [], node: ["fs"] } });

      const result = yield* installer.install(request(officialId));
      assert.strictEqual(result.record.version, "1.0.0");
      assert.strictEqual(result.record.trust, "trusted");
      assert.isUndefined(result.record.confirmation);
      assert.strictEqual(
        result.path,
        join(dataDir, "modules", "installed", ModuleId.OfficialNamespace, "bob", "lights", "1.0.0"),
      );
      const written = JSON.parse(
        yield* Effect.promise(() => readFile(join(result.path, "macrograph.json"), "utf8")),
      );
      assert.strictEqual(written.version, "1.0.0");
      assert.isTrue(existsSync(join(result.path, "assets", "icon.svg")));

      const stored = JSON.parse(
        yield* Effect.promise(() => readFile(InstallRecords.filePath(dataDir), "utf8")),
      );
      assert.strictEqual(stored.installs[0].id, officialId);
      assert.strictEqual(stored.installs[0].installedBy, "admin-1");

      const statuses = yield* installer.statuses;
      const status = statuses.get(officialId);
      assert.deepStrictEqual(status?.flags, { revoked: false, updateAvailable: false });
      assert.strictEqual(status?.trust.installed, "trusted");

      const again = yield* Effect.exit(installer.install(request(officialId)));
      assert.strictEqual(failureTag(again), "InstallFailed");
    }).pipe(Effect.scoped),
  );

  it.effect("rejects a tampered tarball", () =>
    Effect.gen(function* () {
      const { official, installer, dataDir } = yield* setup();
      const tampered = yield* tarball([
        file("macrograph.json", JSON.stringify(manifest("bob", "lights", "1.0.0"))),
        file("server.cjs", "evil()"),
      ]);
      yield* official.publish({ version: "1.0.0", tamperedArchive: tampered });

      const exit = yield* Effect.exit(installer.install(request(officialId)));
      const error = failure(exit);
      assert.strictEqual(error?._tag, "VerificationFailed");
      assert.strictEqual(
        error?._tag === "VerificationFailed" ? error.check : undefined,
        "integrity",
      );
      assert.isFalse(existsSync(InstallRecords.moduleDirectory(dataDir, officialId)));
      assert.lengthOf(yield* installer.records, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects a bad signature", () =>
    Effect.gen(function* () {
      const { official, installer } = yield* setup();
      yield* official.publish({ version: "1.0.0", corruptSignature: true });
      const exit = yield* Effect.exit(installer.install(request(officialId)));
      const error = failure(exit);
      assert.strictEqual(
        error?._tag === "VerificationFailed" ? error.check : undefined,
        "signature",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("rejects a release signed by a key other than the pinned one", () =>
    Effect.gen(function* () {
      const other = yield* Effect.orDie(Signing.generateKeyPair);
      const { official, installer } = yield* setup({ officialKeys: [other] });
      yield* official.publish({ version: "1.0.0" });
      const exit = yield* Effect.exit(installer.install(request(officialId)));
      const error = failure(exit);
      assert.strictEqual(
        error?._tag === "VerificationFailed" ? error.check : undefined,
        "signature",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the key pinned when a third-party registry was added", () =>
    Effect.gen(function* () {
      const { thirdParty, installer } = yield* setup();
      const added = yield* installer.addRegistry(thirdPartyUrl);
      assert.deepStrictEqual(added.keys, [thirdParty.keys.publicKey]);
      assert.isFalse(added.trusted);

      const rotated = yield* Effect.orDie(Signing.generateKeyPair);
      thirdParty.metadataOverride = {
        keys: [{ id: thirdParty.keyId, algorithm: "Ed25519", publicKey: rotated.publicKey }],
      };
      yield* thirdParty.publish({ version: "1.0.0", signWith: rotated.privateKey });
      const exit = yield* Effect.exit(
        installer.install(request(thirdPartyId, { acknowledgeUntrusted: true })),
      );
      const error = failure(exit);
      assert.strictEqual(
        error?._tag === "VerificationFailed" ? error.check : undefined,
        "signature",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("requires acknowledgement for untrusted releases", () =>
    Effect.gen(function* () {
      const { official, installer } = yield* setup();
      yield* official.publish({
        version: "1.0.0",
        trust: "untrusted",
        manifest: { requires: ["http-client"], node: ["fs", "child_process"] },
      });

      const exit = yield* Effect.exit(installer.install(request(officialId)));
      const error = failure(exit);
      assert.strictEqual(error?._tag, "UntrustedConfirmationRequired");
      if (error?._tag === "UntrustedConfirmationRequired") {
        assert.strictEqual(error.registry, ModuleId.OfficialNamespace);
        assert.deepStrictEqual(error.requires, ["http-client"]);
        assert.deepStrictEqual(error.node, ["fs", "child_process"]);
      }
      assert.lengthOf(yield* installer.records, 0);

      const result = yield* installer.install(request(officialId, { acknowledgeUntrusted: true }));
      assert.strictEqual(result.record.trust, "untrusted");
      assert.strictEqual(result.record.confirmation?.actor, "admin-1");
      assert.isString(result.record.confirmation?.at);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses revoked and yanked releases", () =>
    Effect.gen(function* () {
      const { official, installer } = yield* setup();
      yield* official.publish({ version: "1.0.0", status: "revoked", reason: "malware" });
      yield* official.publish({ version: "1.1.0", status: "yanked", reason: "broken" });

      const revoked = failure(
        yield* Effect.exit(
          installer.install(request(officialId, { version: "1.0.0", acknowledgeUntrusted: true })),
        ),
      );
      assert.strictEqual(revoked?._tag, "ReleaseUnavailable");
      if (revoked?._tag === "ReleaseUnavailable") {
        assert.strictEqual(revoked.status, "revoked");
        assert.strictEqual(revoked.reason, "malware");
      }
      const yanked = failure(
        yield* Effect.exit(installer.install(request(officialId, { version: "1.1.0" }))),
      );
      assert.strictEqual(
        yanked?._tag === "ReleaseUnavailable" ? yanked.status : undefined,
        "yanked",
      );

      // Without a version there is no installable release.
      const latest = failure(yield* Effect.exit(installer.install(request(officialId))));
      assert.strictEqual(latest?._tag, "ReleaseUnavailable");
    }).pipe(Effect.scoped),
  );

  it.effect("refuses releases built for an unsupported api", () =>
    Effect.gen(function* () {
      const { official, installer } = yield* setup();
      yield* official.publish({ version: "2.0.0", api: 2 });
      const error = failure(yield* Effect.exit(installer.install(request(officialId))));
      assert.strictEqual(error?._tag, "IncompatibleModule");
    }).pipe(Effect.scoped),
  );

  it.effect("flags revocations and available updates on check", () =>
    Effect.gen(function* () {
      const { official, installer } = yield* setup();
      yield* official.publish({ version: "1.0.0" });
      yield* installer.install(request(officialId));

      yield* official.setStatus("bob", "lights", "1.0.0", "revoked", "compromised account");
      yield* official.publish({ version: "1.2.0" });
      const results = yield* installer.checkForUpdates;
      assert.lengthOf(results, 1);
      const status = (yield* installer.statuses).get(officialId);
      assert.deepStrictEqual(status?.flags, { revoked: true, updateAvailable: true });
      assert.strictEqual(status?.updateVersion, "1.2.0");
      assert.strictEqual(status?.trust.reason, "compromised account");
      assert.strictEqual(status?.trust.current, "trusted");

      // Revoked modules stay installed; the host only flags them.
      assert.lengthOf(yield* installer.records, 1);

      const entry = ModuleStatus.applyToEntry(
        {
          id: officialId,
          version: "1.0.0",
          displayName: "Lights",
          source: "installed",
          status: "loaded",
          flags: {
            stale: false,
            revoked: false,
            updateAvailable: false,
            incompatibleInstalled: false,
          },
        },
        status,
      );
      assert.isTrue(entry.flags.revoked);
      assert.strictEqual(entry.status, "loaded");
    }).pipe(Effect.scoped),
  );

  it.effect("runs scheduled checks on startup", () =>
    Effect.gen(function* () {
      const { official, installer } = yield* setup();
      yield* official.publish({ version: "1.0.0" });
      yield* installer.install(request(officialId));
      yield* official.setStatus("bob", "lights", "1.0.0", "revoked", "bad");

      yield* installer.scheduleChecks();
      const flagged = yield* installer.statusChanges.pipe(
        Stream.filter((statuses) => statuses.get(officialId)?.flags.revoked === true),
        Stream.runHead,
      );
      assert.isTrue(Option.isSome(flagged));
    }).pipe(Effect.scoped),
  );

  it.effect("asks again when updating to an untrusted release", () =>
    Effect.gen(function* () {
      const { official, installer } = yield* setup();
      yield* official.publish({ version: "1.0.0" });
      const first = yield* installer.install(request(officialId));
      yield* official.publish({ version: "1.1.0", trust: "untrusted" });

      const error = failure(yield* Effect.exit(installer.update(request(officialId))));
      assert.strictEqual(error?._tag, "UntrustedConfirmationRequired");
      assert.strictEqual((yield* installer.records)[0]?.version, "1.0.0");

      const updated = yield* installer.update(request(officialId, { acknowledgeUntrusted: true }));
      assert.isTrue(updated.changed);
      assert.strictEqual(updated.record.version, "1.1.0");
      assert.strictEqual(updated.previous?.version, "1.0.0");
      assert.isTrue(existsSync(first.path));
      yield* installer.prune(officialId);
      assert.isFalse(existsSync(first.path));
      assert.isTrue(existsSync(updated.path));

      const noop = yield* installer.update(request(officialId));
      assert.isFalse(noop.changed);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses two registries declaring the same namespace", () =>
    Effect.gen(function* () {
      const { installer, thirdParty } = yield* setup();
      yield* installer.addRegistry(thirdPartyUrl);
      const duplicate = failure(yield* Effect.exit(installer.addRegistry(thirdPartyUrl)));
      assert.strictEqual(duplicate?._tag, "RegistryConflict");

      thirdParty.metadataOverride = { namespace: ModuleId.OfficialNamespace };
      yield* installer.removeRegistry(thirdPartyNamespace);
      const official = failure(yield* Effect.exit(installer.addRegistry(thirdPartyUrl)));
      assert.strictEqual(official?._tag, "RegistryConflict");

      const removeOfficial = failure(
        yield* Effect.exit(installer.removeRegistry(ModuleId.OfficialNamespace)),
      );
      assert.strictEqual(removeOfficial?._tag, "RegistryError");
    }).pipe(Effect.scoped),
  );

  it.effect("rejects tarballs with path traversal or symlinks", () =>
    Effect.gen(function* () {
      const { official, installer, dataDir } = yield* setup();
      const model = manifest("bob", "lights", "1.0.0");
      const traversal = yield* tarball([
        file("macrograph.json", JSON.stringify(model)),
        file("../../../escape.txt", "pwned"),
      ]);
      yield* official.publish({ version: "1.0.0", archive: traversal });
      const error = failure(
        yield* Effect.exit(installer.install(request(officialId, { version: "1.0.0" }))),
      );
      assert.strictEqual(error?._tag, "InstallFailed");
      assert.include(error?._tag === "InstallFailed" ? error.message : "", "escapes");
      assert.isFalse(existsSync(join(dataDir, "modules", "escape.txt")));
      assert.isFalse(existsSync(join(dataDir, "escape.txt")));

      const model2 = manifest("bob", "lights", "1.0.1");
      const symlink = yield* tarball([
        file("macrograph.json", JSON.stringify(model2)),
        directory("ui/"),
        { header: { name: "ui/index.js", size: 0, type: "symlink", linkname: "/etc/passwd" } },
      ]);
      yield* official.publish({ version: "1.0.1", archive: symlink });
      const symlinkError = failure(
        yield* Effect.exit(installer.install(request(officialId, { version: "1.0.1" }))),
      );
      assert.include(symlinkError?._tag === "InstallFailed" ? symlinkError.message : "", "symlink");

      const absolute = yield* tarball([
        file("macrograph.json", JSON.stringify(manifest("bob", "lights", "1.0.2"))),
        file("/tmp/absolute.txt", "pwned"),
      ]);
      yield* official.publish({ version: "1.0.2", archive: absolute });
      const absoluteError = failure(
        yield* Effect.exit(installer.install(request(officialId, { version: "1.0.2" }))),
      );
      assert.include(
        absoluteError?._tag === "InstallFailed" ? absoluteError.message : "",
        "escapes",
      );
      assert.lengthOf(yield* installer.records, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects packages whose manifest differs from the listed one", () =>
    Effect.gen(function* () {
      const { official, installer } = yield* setup();
      const archive = yield* tarball([
        file(
          "macrograph.json",
          JSON.stringify(manifest("bob", "lights", "1.0.0", { node: ["child_process"] })),
        ),
      ]);
      yield* official.publish({ version: "1.0.0", archive });
      const error = failure(yield* Effect.exit(installer.install(request(officialId))));
      assert.strictEqual(
        error?._tag === "VerificationFailed" ? error.check : undefined,
        "manifest",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("ignores third-party trust flags unless the registry is trusted", () =>
    Effect.gen(function* () {
      const { thirdParty, installer } = yield* setup();
      yield* installer.addRegistry(thirdPartyUrl);
      yield* thirdParty.publish({ version: "1.0.0", trust: "trusted" });

      const pkg = yield* installer.getPackage(thirdPartyId);
      assert.strictEqual(pkg.releases[0]?.trust, "untrusted");
      const error = failure(yield* Effect.exit(installer.install(request(thirdPartyId))));
      assert.strictEqual(error?._tag, "UntrustedConfirmationRequired");

      const trusted = yield* installer.setRegistryTrusted(thirdPartyNamespace, true);
      assert.isTrue(trusted.trusted);
      const result = yield* installer.install(request(thirdPartyId));
      assert.strictEqual(result.record.trust, "trusted");

      yield* thirdParty.publish({ version: "1.1.0", trust: "untrusted" });
      const untrusted = failure(yield* Effect.exit(installer.update(request(thirdPartyId))));
      assert.strictEqual(untrusted?._tag, "UntrustedConfirmationRequired");
    }).pipe(Effect.scoped),
  );

  it.effect("persists registries and searches with an index fallback", () =>
    Effect.gen(function* () {
      const { official, thirdParty, installer } = yield* setup();
      yield* installer.addRegistry(thirdPartyUrl);
      yield* official.publish({ version: "1.0.0" });
      yield* thirdParty.publish({ publisher: "alice", name: "fog", version: "0.1.0" });
      thirdParty.searchEnabled = true;

      const registries = yield* installer.listRegistries;
      assert.deepStrictEqual(
        registries.map((registry) => [registry.namespace, registry.official]),
        [
          [ModuleId.OfficialNamespace, true],
          [thirdPartyNamespace, false],
        ],
      );

      const all = yield* installer.search({ query: "" });
      assert.sameMembers(
        all.map((result) => result.id),
        [
          officialId,
          ModuleId.make({ namespace: thirdPartyNamespace, publisher: "alice", name: "fog" }),
        ],
      );
      yield* installer.install(request(officialId));
      const lights = yield* installer.search({
        namespace: ModuleId.OfficialNamespace,
        query: "lights",
      });
      assert.strictEqual(lights[0]?.installedVersion, "1.0.0");
      const missing = failure(
        yield* Effect.exit(installer.search({ namespace: "nope.example", query: "" })),
      );
      assert.strictEqual(missing?._tag, "RegistryNotFound");
    }).pipe(Effect.scoped),
  );

  it.effect("uninstalls files and the record", () =>
    Effect.gen(function* () {
      const { official, installer, dataDir } = yield* setup();
      yield* official.publish({ version: "1.0.0" });
      const result = yield* installer.install(request(officialId));
      yield* installer.uninstall(officialId);
      assert.isFalse(existsSync(result.path));
      assert.isFalse(existsSync(InstallRecords.moduleDirectory(dataDir, officialId)));
      assert.lengthOf(yield* installer.records, 0);
      assert.strictEqual((yield* installer.statuses).size, 0);
      const missing = failure(yield* Effect.exit(installer.uninstall(officialId)));
      assert.strictEqual(missing?._tag, "ModuleNotFound");
    }).pipe(Effect.scoped),
  );

  it.effect("admin handlers load installs through the host and protect built-ins", () =>
    Effect.gen(function* () {
      const { official, installer } = yield* setup();
      yield* official.publish({ version: "1.0.0" });
      const loaded: Array<string> = [];
      const handlers = AdminHandlers.make(installer, {
        installed: (id, record) =>
          Effect.sync(() => {
            loaded.push(`${id}@${record.version}`);
            return {
              id,
              version: record.version,
              displayName: "Lights",
              source: "installed",
              status: "loaded",
              flags: {
                stale: false,
                revoked: false,
                updateAvailable: false,
                incompatibleInstalled: false,
              },
            };
          }),
        uninstalled: () => Effect.void,
        catalog: Effect.succeed([]),
        isShipped: (id) => Effect.succeed(id === officialId),
      });
      const entry = yield* handlers.InstallModule(
        { id: officialId, acknowledgeUntrusted: false },
        { actor: "admin-1" },
      );
      assert.strictEqual(entry.version, "1.0.0");
      assert.deepStrictEqual(loaded, [`${officialId}@1.0.0`]);
      yield* handlers.UninstallModule({ id: officialId });
      const builtIn = failure(yield* Effect.exit(handlers.UninstallModule({ id: officialId })));
      assert.strictEqual(builtIn?._tag, "NotUninstallable");
      const unknown = failure(yield* Effect.exit(handlers.UninstallModule({ id: thirdPartyId })));
      assert.strictEqual(unknown?._tag, "ModuleNotFound");
    }).pipe(Effect.scoped),
  );
});
