import type { Manifest } from "@macrograph/module/Manifest";

import { Integrity } from "@macrograph/module-registry/Integrity";
import { Protocol } from "@macrograph/module-registry/Protocol";
import { Signing } from "@macrograph/module-registry/Signing";
import { Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { packTar, type TarEntry } from "modern-tar";
import { gzipSync } from "node:zlib";

export const manifest = (
  publisher: string,
  name: string,
  version: string,
  overrides: Partial<Manifest.Model> = {},
): Manifest.Model => ({
  manifest: 1,
  publisher,
  name,
  version,
  api: 1,
  displayName: `${publisher}/${name}`,
  server: "server.cjs",
  ...overrides,
});

export const tarball = (entries: ReadonlyArray<TarEntry>) =>
  Effect.promise(async () => new Uint8Array(gzipSync(await packTar([...entries]))));

export const file = (name: string, body: string): TarEntry => {
  const bytes = new TextEncoder().encode(body);
  return { header: { name, size: bytes.byteLength, type: "file" }, body: bytes };
};

export const directory = (name: string): TarEntry => ({
  header: { name, size: 0, type: "directory" },
});

export const packageTarball = (model: Manifest.Model, extra: ReadonlyArray<TarEntry> = []) =>
  tarball([
    file("macrograph.json", JSON.stringify(model)),
    file("server.cjs", "module.exports = {};"),
    directory("assets/"),
    file("assets/icon.svg", "<svg/>"),
    ...extra,
  ]);

export interface PublishOptions {
  readonly publisher?: string;
  readonly name?: string;
  readonly version: string;
  readonly trust?: Protocol.Trust;
  readonly status?: Protocol.ReleaseStatus;
  readonly reason?: string;
  readonly api?: number;
  readonly manifest?: Partial<Manifest.Model>;
  /** Archive bytes to sign and serve instead of a generated package. */
  readonly archive?: Uint8Array<ArrayBuffer>;
  /** Serve these bytes while signing the integrity of the real archive. */
  readonly tamperedArchive?: Uint8Array<ArrayBuffer>;
  /** Sign with this private key instead of the registry's. */
  readonly signWith?: string;
  /** Replace the signature with garbage. */
  readonly corruptSignature?: boolean;
}

export interface FixtureRegistry {
  readonly url: string;
  readonly namespace: string;
  readonly keyId: string;
  readonly keys: Signing.KeyPair;
  /** Serve `/v1/search`; otherwise it 404s and clients filter the index. */
  searchEnabled: boolean;
  metadataOverride?: Partial<Protocol.Metadata>;
  readonly packages: Map<string, Protocol.Package>;
  readonly files: Map<string, Uint8Array<ArrayBuffer>>;
  readonly publish: (options: PublishOptions) => Effect.Effect<Protocol.Release>;
  /** Re-signs an existing release with a new status, e.g. to revoke it. */
  readonly setStatus: (
    publisher: string,
    name: string,
    version: string,
    status: Protocol.ReleaseStatus,
    reason?: string,
  ) => Effect.Effect<void>;
}

export const makeRegistry = (url: string, namespace: string) =>
  Effect.gen(function* () {
    const keys = yield* Effect.orDie(Signing.generateKeyPair);
    const keyId = "key-1";
    const packages = new Map<string, Protocol.Package>();
    const files = new Map<string, Uint8Array<ArrayBuffer>>();

    const signRecord = (privateKey: string, record: Protocol.SignedRecord) =>
      Effect.orDie(
        Effect.flatMap(Signing.importPrivateKey(privateKey), (key) => Signing.sign(key, record)),
      );

    const registry: FixtureRegistry = {
      url,
      namespace,
      keyId,
      keys,
      searchEnabled: false,
      packages,
      files,
      publish: (options) =>
        Effect.gen(function* () {
          const publisher = options.publisher ?? "bob";
          const name = options.name ?? "lights";
          const model = manifest(publisher, name, options.version, {
            api: options.api ?? 1,
            ...options.manifest,
          });
          const archive = options.archive ?? (yield* packageTarball(model));
          const integrity = yield* Effect.orDie(Integrity.compute(new Uint8Array(archive)));
          const path = `/tarballs/${publisher}/${name}/${options.version}.tgz`;
          files.set(path, new Uint8Array(options.tamperedArchive ?? archive));
          const base = {
            version: options.version,
            api: model.api,
            integrity,
            trust: options.trust ?? "trusted",
            status: options.status ?? "active",
          } as const;
          const signature = yield* signRecord(
            options.signWith ?? keys.privateKey,
            Protocol.signedRecord(namespace, { publisher, name }, base),
          );
          const release: Protocol.Release = {
            ...base,
            publishedAt: "2026-01-01T00:00:00.000Z",
            manifest: model,
            tarball: path.slice(1),
            ...(options.reason === undefined ? {} : { reason: options.reason }),
            signature: {
              keyId,
              value: options.corruptSignature === true ? btoa("x".repeat(64)) : signature,
            },
          };
          const key = `${publisher}/${name}`;
          const existing = packages.get(key);
          packages.set(key, {
            publisher,
            name,
            releases: [...(existing?.releases ?? []), release],
          });
          return release;
        }),
      setStatus: (publisher, name, version, status, reason) =>
        Effect.gen(function* () {
          const key = `${publisher}/${name}`;
          const pkg = packages.get(key);
          if (pkg === undefined) return yield* Effect.die("unknown package");
          const releases = yield* Effect.forEach(pkg.releases, (release) =>
            release.version !== version
              ? Effect.succeed(release)
              : Effect.map(
                  signRecord(
                    keys.privateKey,
                    Protocol.signedRecord(namespace, pkg, { ...release, status }),
                  ),
                  (value): Protocol.Release => {
                    const { reason: _, ...rest } = release;
                    return {
                      ...rest,
                      status,
                      ...(reason === undefined ? {} : { reason }),
                      signature: { keyId, value },
                    };
                  },
                ),
          );
          packages.set(key, { ...pkg, releases });
        }),
    };
    return registry;
  });

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

const indexOf = (registry: FixtureRegistry): Protocol.Index => ({
  packages: [...registry.packages.values()].map((pkg) => {
    const latest = pkg.releases.at(-1);
    return {
      publisher: pkg.publisher,
      name: pkg.name,
      displayName: latest?.manifest.displayName ?? pkg.name,
      latestVersion: latest?.version ?? "0.0.0",
    };
  }),
});

const route = (registry: FixtureRegistry, url: URL): Uint8Array | undefined => {
  const basePath = new URL(registry.url).pathname.replace(/\/+$/, "");
  if (!url.pathname.startsWith(`${basePath}/`)) return undefined;
  const path = url.pathname.slice(basePath.length);
  if (path === Protocol.WellKnownPath)
    return json({
      protocol: 1,
      namespace: registry.namespace,
      displayName: `Fixture ${registry.namespace}`,
      keys: [{ id: registry.keyId, algorithm: "Ed25519", publicKey: registry.keys.publicKey }],
      ...registry.metadataOverride,
    });
  if (path === Protocol.IndexPath) return json(indexOf(registry));
  if (path === Protocol.SearchPath && registry.searchEnabled) {
    const query = url.searchParams.get("q") ?? "";
    return json({
      packages: indexOf(registry).packages.filter((entry) => entry.name.includes(query)),
    });
  }
  const match = /^\/v1\/packages\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (match !== null) {
    const pkg = registry.packages.get(`${match[1]}/${match[2]}`);
    return pkg === undefined ? undefined : json(pkg);
  }
  return registry.files.get(path);
};

/** An `HttpClient` serving fixture registries by origin, recording requested URLs. */
export const httpClient = (registries: ReadonlyArray<FixtureRegistry>, log: Array<string> = []) =>
  HttpClient.make((request, url) => {
    log.push(url.toString());
    const registry = registries.find((candidate) => url.toString().startsWith(`${candidate.url}/`));
    const body = registry === undefined ? undefined : route(registry, url);
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        body === undefined
          ? new Response("not found", { status: 404 })
          : new Response(new Uint8Array(body), { status: 200 }),
      ),
    );
  });
