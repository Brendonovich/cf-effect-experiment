import { assert, describe, it } from "@effect/vitest";
import { Pack } from "@macrograph/module-build/Pack";
import { Integrity } from "@macrograph/module-registry/Integrity";
import { Protocol } from "@macrograph/module-registry/Protocol";
import { Publish } from "@macrograph/module-registry/Publish";
import { Signing } from "@macrograph/module-registry/Signing";
import { ApiKey } from "@macrograph/project-api";
import { Effect, Exit, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";

import * as Registry from "../src/registry/Registry.ts";
import * as RegistryConfig from "../src/registry/RegistryConfig.ts";
import * as RegistryRoutes from "../src/registry/RegistryRoutes.ts";
import * as RegistrySigner from "../src/registry/RegistrySigner.ts";
import * as RegistryStore from "../src/registry/RegistryStore.ts";
import * as Tarball from "../src/registry/Tarball.ts";
import * as TarballStore from "../src/registry/TarballStore.ts";

const origin = "https://registry.example.com";
const tokens = {
  maintainer: "mg_maintainer",
  alice: "mg_alice",
  bob: "mg_bob",
  admin: "mg_admin",
} as const;
type Who = keyof typeof tokens;

const manifest = (overrides: Record<string, unknown> = {}) => ({
  manifest: 1,
  publisher: "macrograph",
  name: "lights",
  version: "1.0.0",
  api: 1,
  displayName: "Lights",
  description: "Controls the lights",
  server: "server.cjs",
  ...overrides,
});

const tarball = (
  overrides: Record<string, unknown> = {},
  extra: ReadonlyArray<{ readonly path: string; readonly content: string }> = [],
) =>
  Tarball.write([
    { path: "macrograph.json", content: JSON.stringify(manifest(overrides)) },
    { path: "server.cjs", content: "module.exports.default = {};" },
    ...extra,
  ]);

const makeHandler = Effect.gen(function* () {
  const keys = yield* Signing.generateKeyPair;
  const accounts = yield* Effect.forEach(
    [
      { id: "maintainer", email: "maintainer@example.com", token: tokens.maintainer },
      { id: "alice", email: "alice@example.com", token: tokens.alice },
      { id: "bob", email: "bob@example.com", token: tokens.bob },
      { id: "admin", email: "admin@example.com", token: tokens.admin },
    ],
    ({ token, ...account }) =>
      Effect.map(ApiKey.hash(token), (hash) => ({ ...account, apiKeyHashes: [hash] })),
  );
  const app = RegistryRoutes.layer.pipe(
    Layer.provide(Registry.layer),
    Layer.provide([
      RegistryConfig.layer({
        admins: ["Admin@Example.com"],
        seedPublishers: RegistryConfig.parseSeedPublishers(
          "macrograph=maintainer@example.com,brendonovich=maintainer",
        ),
      }),
      RegistrySigner.layer({
        keyId: "test-1",
        publicKey: keys.publicKey,
        privateKey: Redacted.make(keys.privateKey),
      }),
      RegistryStore.layerMemory({ accounts }),
      TarballStore.layerMemory,
    ]),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(app, { disableLogger: true });
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  return handler;
});

const setup = Effect.gen(function* () {
  const handler = yield* makeHandler;
  const request = (path: string, init: RequestInit & { readonly as?: Who } = {}) =>
    Effect.promise(async () => {
      const { as, ...rest } = init;
      const headers = new Headers(rest.headers);
      headers.set("x-forwarded-host", new URL(origin).host);
      if (as !== undefined) headers.set("authorization", `Bearer ${tokens[as]}`);
      const response = await handler(new Request(`${origin}${path}`, { ...rest, headers }));
      const body = response.headers.get("content-type")?.includes("json")
        ? await response.json()
        : new Uint8Array(await response.arrayBuffer());
      return { status: response.status, body, headers: response.headers };
    });
  const publish = (as: Who, bytes: Uint8Array<ArrayBuffer>) =>
    request(Publish.PublishPath, {
      method: "POST",
      as,
      headers: { "content-type": Publish.TarballContentType },
      body: bytes,
    });
  const patch = (path: string, as: Who, body: unknown) =>
    request(path, {
      method: "PATCH",
      as,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const metadata = Effect.flatMap(request(Protocol.WellKnownPath), ({ body }) =>
    Protocol.decodeMetadata(body),
  );
  const pkg = (publisher: string, name: string) =>
    Effect.flatMap(request(Protocol.packagePath(publisher, name)), ({ body }) =>
      Protocol.decodePackage(body),
    );
  /** Decodes a package document and verifies every release signature against the metadata keys. */
  const verifiedPackage = (publisher: string, name: string) =>
    Effect.gen(function* () {
      const { namespace, keys } = yield* metadata;
      const document = yield* pkg(publisher, name);
      for (const release of document.releases)
        yield* Signing.verifyRelease(
          keys,
          Protocol.signedRecord(namespace, document, release),
          release.signature,
        );
      return document;
    });
  return { handler, request, publish, patch, metadata, pkg, verifiedPackage };
});

const release = (document: Protocol.Package, version: string) => {
  const found = document.releases.find((candidate) => candidate.version === version);
  assert.isDefined(found);
  return found!;
};

describe("official registry", () => {
  it.effect("publishes from an approved seed publisher and serves the static protocol", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      const bytes = yield* tarball();
      const published = yield* registry.publish("maintainer", bytes);
      assert.strictEqual(published.status, 201);

      const metadata = yield* registry.metadata;
      assert.strictEqual(metadata.namespace, "macrograph.app");
      assert.strictEqual(metadata.protocol, Protocol.ProtocolVersion);
      assert.deepStrictEqual(
        metadata.keys.map((key) => key.id),
        ["test-1"],
      );

      const document = yield* registry.verifiedPackage("macrograph", "lights");
      const lights = release(document, "1.0.0");
      assert.strictEqual(lights.trust, "trusted");
      assert.strictEqual(lights.status, "active");
      assert.strictEqual(lights.integrity, yield* Integrity.compute(bytes));
      assert.strictEqual(lights.tarball, `${origin}/v1/tarballs/macrograph/lights/1.0.0.tgz`);
      const created = yield* Schema.decodeUnknownEffect(Protocol.Release)(published.body);
      assert.deepStrictEqual(created, lights);

      const download = yield* registry.request(new URL(lights.tarball).pathname);
      assert.strictEqual(download.status, 200);
      assert.instanceOf(download.body, Uint8Array);
      if (download.body instanceof Uint8Array)
        yield* Integrity.verify(new Uint8Array(download.body), lights.integrity);

      const index = yield* Effect.flatMap(registry.request(Protocol.IndexPath), ({ body }) =>
        Protocol.decodeIndex(body),
      );
      assert.deepStrictEqual(index.packages, [
        {
          publisher: "macrograph",
          name: "lights",
          displayName: "Lights",
          description: "Controls the lights",
          latestVersion: "1.0.0",
        },
      ]);
      const hits = yield* Effect.flatMap(
        registry.request(`${Protocol.SearchPath}?q=light`),
        ({ body }) => Protocol.decodeIndex(body),
      );
      assert.strictEqual(hits.packages.length, 1);
      const misses = yield* Effect.flatMap(
        registry.request(`${Protocol.SearchPath}?q=speaker`),
        ({ body }) => Protocol.decodeIndex(body),
      );
      assert.strictEqual(misses.packages.length, 0);
    }),
  );

  it.effect("publishes through the module-registry publish client", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      const result = yield* Publish.publish({
        registry: origin,
        token: tokens.maintainer,
        tarball: yield* tarball({ publisher: "brendonovich", name: "speaker" }),
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, (input, init) =>
          registry.handler(new Request(input, init)),
        ),
      );
      assert.strictEqual(result.version, "1.0.0");
      assert.strictEqual(result.trust, "trusted");

      const error = yield* Publish.publish({
        registry: origin,
        token: tokens.maintainer,
        tarball: yield* tarball({ publisher: "brendonovich", name: "speaker" }),
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, (input, init) =>
          registry.handler(new Request(input, init)),
        ),
        Effect.flip,
      );
      assert.instanceOf(error, Publish.PublishError);
      if (error instanceof Publish.PublishError) {
        assert.strictEqual(error.status, 409);
        assert.strictEqual(error.reason, "VersionExists");
      }
    }),
  );

  it.effect("rejects unauthenticated, unowned, pending and suspended publishers", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      const bytes = yield* tarball();

      const anonymous = yield* registry.request(Publish.PublishPath, {
        method: "POST",
        body: bytes,
      });
      assert.strictEqual(anonymous.status, 401);

      const unowned = yield* registry.publish("alice", bytes);
      assert.strictEqual(unowned.status, 403);
      assert.strictEqual(unowned.body._tag, "PublisherNotOwned");

      const unknown = yield* registry.publish("alice", yield* tarball({ publisher: "nobody" }));
      assert.strictEqual(unknown.body._tag, "PublisherNotOwned");

      const applied = yield* registry.request(RegistryRoutes.ApplyPath, {
        method: "POST",
        as: "bob",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "bob" }),
      });
      assert.strictEqual(applied.status, 200);
      assert.strictEqual(applied.body.status, "pending");
      const pending = yield* registry.publish("bob", yield* tarball({ publisher: "bob" }));
      assert.strictEqual(pending.status, 403);
      assert.strictEqual(pending.body._tag, "PublisherNotApproved");

      const reserved = yield* registry.request(RegistryRoutes.ApplyPath, {
        method: "POST",
        as: "bob",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "macrograph" }),
      });
      assert.strictEqual(reserved.status, 409);

      const created = yield* registry.patch(
        `${RegistryRoutes.AdminPublishersPath}/alice`,
        "admin",
        {
          account: "alice@example.com",
        },
      );
      assert.strictEqual(created.status, 200);
      assert.strictEqual(created.body.status, "approved");
      assert.strictEqual(
        (yield* registry.publish("alice", yield* tarball({ publisher: "alice" }))).status,
        201,
      );
      yield* registry.patch(`${RegistryRoutes.AdminPublishersPath}/alice`, "admin", {
        status: "suspended",
      });
      const suspended = yield* registry.publish(
        "alice",
        yield* tarball({ publisher: "alice", version: "1.0.1" }),
      );
      assert.strictEqual(suspended.status, 403);
      assert.strictEqual(suspended.body._tag, "PublisherNotApproved");

      const notAdmin = yield* registry.patch(`${RegistryRoutes.AdminPublishersPath}/bob`, "bob", {
        status: "approved",
      });
      assert.strictEqual(notAdmin.status, 403);
      assert.strictEqual(notAdmin.body._tag, "NotAdmin");
    }),
  );

  it.effect("keeps published versions immutable", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      assert.strictEqual((yield* registry.publish("maintainer", yield* tarball())).status, 201);
      const before = yield* registry.pkg("macrograph", "lights");
      const again = yield* registry.publish(
        "maintainer",
        yield* tarball({ description: "Changed" }),
      );
      assert.strictEqual(again.status, 409);
      assert.strictEqual(again.body._tag, "VersionExists");
      const after = yield* registry.pkg("macrograph", "lights");
      assert.deepStrictEqual(after, before);
    }),
  );

  it.effect("rejects packages that fail publish checks", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      const expectInvalid = (bytes: Uint8Array<ArrayBuffer>, fragment: string) =>
        Effect.gen(function* () {
          const response = yield* registry.publish("maintainer", bytes);
          assert.strictEqual(response.status, 422);
          assert.strictEqual(response.body._tag, "InvalidPackage");
          assert.isTrue(
            response.body.problems.some((problem: string) => problem.includes(fragment)),
            `${JSON.stringify(response.body.problems)} should mention ${fragment}`,
          );
        });

      yield* expectInvalid(yield* tarball({ api: 99 }), "not supported");
      yield* expectInvalid(yield* tarball({ version: "one" }), "macrograph.json is invalid");
      yield* expectInvalid(
        yield* tarball({}, [{ path: "node_modules/effect/index.js", content: "" }]),
        "not part of the module package layout",
      );
      yield* expectInvalid(
        yield* tarball({ ui: { entry: "ui/index.js", styles: [] } }),
        "ui/index.js is referenced by the manifest but missing",
      );
      yield* expectInvalid(
        yield* Tarball.write([{ path: "server.cjs", content: "" }]),
        "macrograph.json is missing",
      );
      yield* expectInvalid(
        yield* tarball({}, [{ path: "../escape.js", content: "" }]),
        "not a relative path",
      );
      yield* expectInvalid(new Uint8Array([1, 2, 3]), "");
    }),
  );

  it.effect("rejects packages that fail the module-build bundle checks", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      const withServer = (server: string) =>
        Tarball.write([
          { path: "macrograph.json", content: JSON.stringify(manifest()) },
          { path: "server.cjs", content: server },
        ]);
      const expectProblem = (bytes: Uint8Array<ArrayBuffer>, fragment: string) =>
        Effect.gen(function* () {
          const response = yield* registry.publish("maintainer", bytes);
          assert.strictEqual(response.status, 422);
          assert.strictEqual(response.body._tag, "InvalidPackage");
          assert.isTrue(
            response.body.problems.some(
              (problem: string) => problem.startsWith("bundle: ") && problem.includes(fragment),
            ),
            `${JSON.stringify(response.body.problems)} should mention ${fragment}`,
          );
        });

      yield* expectProblem(
        yield* withServer(
          [
            "//#region ../../node_modules/effect/dist/Effect.js",
            'const TypeId = "~effect/Effect";',
            "//#endregion",
            "module.exports.default = { TypeId };",
          ].join("\n"),
        ),
        "shared library effect",
      );
      yield* expectProblem(
        yield* withServer("await Promise.resolve();\nmodule.exports.default = {};"),
        "top-level await",
      );
      yield* expectProblem(
        yield* withServer('module.exports.default = require("@julusian/midi");'),
        "may only require shared libraries",
      );
      yield* expectProblem(
        yield* withServer('module.exports.default = require("node:fs");'),
        "node list does not declare fs",
      );
      // Shared libraries and declared node built-ins are fine.
      const ok = yield* registry.publish(
        "maintainer",
        yield* Tarball.write([
          { path: "macrograph.json", content: JSON.stringify(manifest({ node: ["fs"] })) },
          {
            path: "server.cjs",
            content: 'require("node:fs");\nmodule.exports.default = require("effect");',
          },
        ]),
      );
      assert.strictEqual(ok.status, 201);
    }),
  );

  it.effect("accepts tarballs packed by macrograph-module", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      const bytes = yield* Pack.tarball([
        { path: "server.cjs", contents: "module.exports.default = {};" },
        { path: "macrograph.json", contents: JSON.stringify(manifest({ name: "packed" })) },
        { path: "assets/icon.svg", contents: "<svg/>" },
      ]);
      const entries = yield* Tarball.read(bytes, { maxUnpackedBytes: 1024 * 1024, maxFiles: 10 });
      assert.deepStrictEqual(
        entries.map((entry) => entry.path),
        ["assets/icon.svg", "macrograph.json", "server.cjs"],
      );
      const published = yield* registry.publish("maintainer", bytes);
      assert.strictEqual(published.status, 201);
      assert.strictEqual(published.body.integrity, yield* Integrity.compute(bytes));
    }),
  );

  it.effect("accepts declared native addons and rejects undeclared or invalid ones", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);
      const machO = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]);
      const server = {
        path: "server.cjs",
        contents: 'module.exports.default = require("macrograph:native/midi");',
      };
      const nativeManifest = (name: string) => JSON.stringify(manifest({ name, native: ["midi"] }));

      const published = yield* registry.publish(
        "maintainer",
        yield* Pack.tarball([
          server,
          { path: "macrograph.json", contents: nativeManifest("native-ok") },
          { path: "native/midi/linux-x64.node", contents: elf },
          { path: "native/midi/darwin-arm64.node", contents: machO },
        ]),
      );
      assert.strictEqual(published.status, 201);
      const document = yield* registry.pkg("macrograph", "native-ok");
      assert.deepStrictEqual(release(document, "1.0.0").manifest.native, ["midi"]);

      const problems = (bytes: Uint8Array<ArrayBuffer>) =>
        Effect.gen(function* () {
          const response = yield* registry.publish("maintainer", bytes);
          assert.strictEqual(response.status, 422);
          return JSON.stringify(response.body.problems);
        });
      assert.include(
        yield* problems(
          yield* Pack.tarball([
            server,
            { path: "macrograph.json", contents: JSON.stringify(manifest({ name: "undeclared" })) },
          ]),
        ),
        "native list does not declare midi",
      );
      const invalid = yield* problems(
        yield* Pack.tarball([
          server,
          { path: "macrograph.json", contents: nativeManifest("invalid-native") },
          { path: "native/midi/linux-x64.node", contents: "#!/bin/sh" },
          { path: "native/midi/linux-riscv64.node", contents: elf },
          { path: "native/midi/extra/linux-x64.node", contents: elf },
        ]),
      );
      assert.include(invalid, "not a Mach-O, ELF or PE binary");
      assert.include(invalid, "linux-riscv64 is not a known native target");
      assert.include(
        invalid,
        "native/midi/extra/linux-x64.node is not part of the module package layout",
      );
    }),
  );

  it.effect("runs extra bundle checks from the hook", () =>
    Effect.gen(function* () {
      const keys = yield* Signing.generateKeyPair;
      const registry = yield* Registry.Service.pipe(
        Effect.provide(
          Registry.layer.pipe(
            Layer.provide([
              RegistryConfig.layer({}),
              RegistrySigner.layer({
                keyId: "k",
                publicKey: keys.publicKey,
                privateKey: Redacted.make(keys.privateKey),
              }),
              RegistryStore.layerMemory(),
              TarballStore.layerMemory,
              Layer.succeed(Registry.Checks, [
                {
                  name: "no-tla",
                  run: ({ files }) =>
                    Effect.succeed(
                      new TextDecoder().decode(files.get("server.cjs")).includes("await")
                        ? ["top-level await"]
                        : [],
                    ),
                },
              ]),
            ]),
          ),
        ),
      );
      const error = yield* registry
        .publish(
          { userId: "anyone", email: null },
          yield* Tarball.write([
            { path: "macrograph.json", content: JSON.stringify(manifest()) },
            { path: "server.cjs", content: "await 1" },
          ]),
          origin,
        )
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "InvalidPackage");
      if (error._tag === "InvalidPackage")
        assert.deepStrictEqual(error.problems, ["no-tla: top-level await"]);
    }),
  );

  it.effect("inherits publisher trust, applies overrides and re-signs records", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      yield* registry.patch(`${RegistryRoutes.AdminPublishersPath}/alice`, "admin", {
        account: "alice",
      });
      yield* registry.publish("alice", yield* tarball({ publisher: "alice" }));
      assert.strictEqual(
        release(yield* registry.verifiedPackage("alice", "lights"), "1.0.0").trust,
        "untrusted",
      );

      yield* registry.patch(`${RegistryRoutes.AdminPublishersPath}/alice`, "admin", {
        trusted: true,
      });
      assert.strictEqual(
        release(yield* registry.verifiedPackage("alice", "lights"), "1.0.0").trust,
        "trusted",
      );

      const overridden = yield* registry.patch(
        `${RegistryRoutes.AdminReleasesPath}/alice/lights/1.0.0`,
        "admin",
        { trust: "untrusted" },
      );
      assert.strictEqual(overridden.status, 200);
      yield* registry.publish("alice", yield* tarball({ publisher: "alice", version: "1.1.0" }));
      let document = yield* registry.verifiedPackage("alice", "lights");
      assert.strictEqual(release(document, "1.0.0").trust, "untrusted");
      assert.strictEqual(release(document, "1.1.0").trust, "trusted");

      // Publisher trust changes don't touch releases with an override.
      yield* registry.patch(`${RegistryRoutes.AdminPublishersPath}/alice`, "admin", {
        trusted: false,
      });
      yield* registry.patch(`${RegistryRoutes.AdminReleasesPath}/alice/lights/1.0.0`, "admin", {
        trust: "trusted",
      });
      document = yield* registry.verifiedPackage("alice", "lights");
      assert.strictEqual(release(document, "1.0.0").trust, "trusted");
      assert.strictEqual(release(document, "1.1.0").trust, "untrusted");

      yield* registry.patch(`${RegistryRoutes.AdminReleasesPath}/alice/lights/1.0.0`, "admin", {
        trust: null,
      });
      document = yield* registry.verifiedPackage("alice", "lights");
      assert.strictEqual(release(document, "1.0.0").trust, "untrusted");
    }),
  );

  it.effect("yanks and revokes releases with a reason and re-signs their status", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      yield* registry.publish("maintainer", yield* tarball());
      yield* registry.publish("maintainer", yield* tarball({ version: "1.1.0" }));
      const before = release(yield* registry.verifiedPackage("macrograph", "lights"), "1.1.0");

      const missingReason = yield* registry.patch(
        `${RegistryRoutes.AdminReleasesPath}/macrograph/lights/1.1.0`,
        "admin",
        { status: "revoked" },
      );
      assert.strictEqual(missingReason.status, 400);

      const revoked = yield* registry.patch(
        `${RegistryRoutes.AdminReleasesPath}/macrograph/lights/1.1.0`,
        "admin",
        { status: "revoked", reason: "Leaks tokens" },
      );
      assert.strictEqual(revoked.status, 200);
      yield* registry.patch(
        `${RegistryRoutes.AdminReleasesPath}/macrograph/lights/1.0.0`,
        "admin",
        {
          status: "yanked",
          reason: "Broken",
        },
      );

      const { namespace, keys } = yield* registry.metadata;
      const document = yield* registry.verifiedPackage("macrograph", "lights");
      const after = release(document, "1.1.0");
      assert.strictEqual(after.status, "revoked");
      assert.strictEqual(after.reason, "Leaks tokens");
      assert.strictEqual(release(document, "1.0.0").status, "yanked");
      assert.strictEqual(release(document, "1.0.0").reason, "Broken");

      // The old signature no longer matches the record.
      const stale = yield* Signing.verifyRelease(
        keys,
        Protocol.signedRecord(namespace, document, after),
        before.signature,
      ).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(stale));

      const unknown = yield* registry.patch(
        `${RegistryRoutes.AdminReleasesPath}/macrograph/lights/9.9.9`,
        "admin",
        { status: "yanked", reason: "x" },
      );
      assert.strictEqual(unknown.status, 404);

      const notAdmin = yield* registry.patch(
        `${RegistryRoutes.AdminReleasesPath}/macrograph/lights/1.0.0`,
        "maintainer",
        { status: "active" },
      );
      assert.strictEqual(notAdmin.status, 403);

      // With no active release left, the index falls back to the highest version.
      const index = yield* Effect.flatMap(registry.request(Protocol.IndexPath), ({ body }) =>
        Protocol.decodeIndex(body),
      );
      assert.strictEqual(index.packages[0]?.latestVersion, "1.1.0");
      yield* registry.patch(
        `${RegistryRoutes.AdminReleasesPath}/macrograph/lights/1.0.0`,
        "admin",
        {
          status: "active",
        },
      );
      const reactivated = release(yield* registry.verifiedPackage("macrograph", "lights"), "1.0.0");
      assert.strictEqual(reactivated.status, "active");
      assert.isUndefined(reactivated.reason);
      const latest = yield* Effect.flatMap(registry.request(Protocol.IndexPath), ({ body }) =>
        Protocol.decodeIndex(body),
      );
      assert.strictEqual(latest.packages[0]?.latestVersion, "1.0.0");
    }),
  );

  it.effect("lists seed publishers for admins", () =>
    Effect.gen(function* () {
      const registry = yield* setup;
      const response = yield* registry.request(RegistryRoutes.AdminPublishersPath, { as: "admin" });
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(
        response.body.publishers.map(
          (publisher: { name: string; status: string; trusted: boolean }) => [
            publisher.name,
            publisher.status,
            publisher.trusted,
          ],
        ),
        [
          ["brendonovich", "approved", true],
          ["macrograph", "approved", true],
        ],
      );
    }),
  );
});

describe("registry signer", () => {
  it.effect("fails requests that need a key when the key pair does not match", () =>
    Effect.gen(function* () {
      const [one, two] = yield* Effect.all([Signing.generateKeyPair, Signing.generateKeyPair]);
      const signer = yield* RegistrySigner.Service.pipe(
        Effect.provide(
          RegistrySigner.layer({
            keyId: "k",
            publicKey: one.publicKey,
            privateKey: Redacted.make(two.privateKey),
          }),
        ),
      );
      const error = yield* signer.key.pipe(Effect.flip);
      assert.strictEqual(error._tag, "RegistryUnavailable");
    }),
  );
});
