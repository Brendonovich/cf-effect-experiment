import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { Client, Integrity, Protocol, Signing } from "../src/index.ts";

const base = "https://example.com/registry";
const namespace = "modules.example.com";
const tarball = new TextEncoder().encode("tarball bytes");

const fixture = Effect.gen(function* () {
  const keys = yield* Signing.generateKeyPair;
  const privateKey = yield* Signing.importPrivateKey(keys.privateKey);
  const integrity = yield* Integrity.compute(tarball);
  const unsigned = {
    version: "1.0.0",
    api: 1,
    integrity,
    trust: "trusted",
    status: "active",
  } as const;
  const signature = yield* Signing.sign(
    privateKey,
    Protocol.signedRecord(namespace, { publisher: "bob", name: "lights" }, unsigned),
  );
  const release: Protocol.Release = {
    ...unsigned,
    publishedAt: "2026-01-01T00:00:00.000Z",
    manifest: {
      manifest: 1,
      publisher: "bob",
      name: "lights",
      version: "1.0.0",
      api: 1,
      displayName: "Lights",
      server: "server.cjs",
    },
    tarball: "tarballs/lights-1.0.0.tgz",
    signature: { keyId: "k1", value: signature },
  };
  const signingKeys: ReadonlyArray<Protocol.SigningKey> = [
    { id: "k1", algorithm: "Ed25519", publicKey: keys.publicKey },
  ];
  return { release, signingKeys };
});

const serve = (routes: Record<string, unknown>, requested: Array<string>) =>
  HttpClient.make((request, url) => {
    requested.push(url.toString());
    const key = url.pathname + url.search;
    const body = routes[key];
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        body === undefined
          ? new Response("missing", { status: 404 })
          : new Response(body instanceof Uint8Array ? body : JSON.stringify(body)),
      ),
    );
  });

describe("Client", () => {
  it.effect("fetches protocol documents relative to the registry URL", () =>
    Effect.gen(function* () {
      const { release, signingKeys } = yield* fixture;
      const requested: Array<string> = [];
      const pkg: Protocol.Package = { publisher: "bob", name: "lights", releases: [release] };
      const http = serve(
        {
          "/registry/.well-known/macrograph-registry.json": {
            protocol: 1,
            namespace,
            displayName: "Example",
            keys: signingKeys,
          },
          "/registry/v1/index.json": {
            packages: [
              { publisher: "bob", name: "lights", displayName: "Lights", latestVersion: "1.0.0" },
              { publisher: "alice", name: "fog", displayName: "Fog", latestVersion: "0.1.0" },
            ],
          },
          "/registry/v1/packages/bob/lights.json": pkg,
          "/registry/tarballs/lights-1.0.0.tgz": tarball,
        },
        requested,
      );
      const client = yield* Effect.provideService(
        Client.make(`${base}/`),
        HttpClient.HttpClient,
        http,
      );
      assert.strictEqual(client.url, base);
      assert.strictEqual((yield* client.metadata).namespace, namespace);

      const fetched = yield* client.getPackage("bob", "lights");
      assert.strictEqual(fetched.releases[0]?.version, "1.0.0");
      const missing = yield* Effect.exit(client.getPackage("bob", "nope"));
      assert.isTrue(Exit.isFailure(missing));

      // No search endpoint: falls back to filtering the index.
      const results = yield* client.search("FOG");
      assert.deepStrictEqual(
        results.map((entry) => entry.name),
        ["fog"],
      );
      assert.isTrue(requested.some((url) => url.startsWith(`${base}/v1/search?q=FOG`)));

      const bytes = yield* Client.downloadVerified(client, signingKeys, namespace, pkg, release);
      assert.deepStrictEqual(bytes, tarball);

      const tampered = yield* Effect.exit(
        Client.verifyIntegrity(pkg, release, new TextEncoder().encode("other")),
      );
      assert.isTrue(Exit.isFailure(tampered));
      const replayed = yield* Effect.exit(
        Client.verifySignature(signingKeys, "other.example.com", pkg, release),
      );
      assert.isTrue(Exit.isFailure(replayed));
    }),
  );

  it.effect("uses the search endpoint when available", () =>
    Effect.gen(function* () {
      const http = serve(
        {
          "/registry/v1/search?q=lights": {
            packages: [
              { publisher: "bob", name: "lights", displayName: "Lights", latestVersion: "1.0.0" },
            ],
          },
        },
        [],
      );
      const client = yield* Effect.provideService(Client.make(base), HttpClient.HttpClient, http);
      const results = yield* client.search("lights");
      assert.strictEqual(results[0]?.name, "lights");
    }),
  );

  it.effect("rejects non-http registry URLs", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(Client.normalizeUrl("file:///etc"));
      assert.isTrue(Exit.isFailure(exit));
    }),
  );
});
