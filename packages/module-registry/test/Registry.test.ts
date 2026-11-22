import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { CanonicalJson, Integrity, Protocol, Signing } from "../src/index.ts";

const encoder = new TextEncoder();

describe("CanonicalJson", () => {
  it("sorts keys recursively and drops whitespace", () => {
    assert.strictEqual(
      CanonicalJson.stringify({ b: 1, a: [true, null, { z: "x", y: 2.5 }], c: undefined }),
      '{"a":[true,null,{"y":2.5,"z":"x"}],"b":1}',
    );
  });

  it("is stable regardless of key insertion order", () => {
    const left = { namespace: "a.b", publisher: "p", nested: { one: 1, two: 2 } };
    const right = { nested: { two: 2, one: 1 }, publisher: "p", namespace: "a.b" };
    assert.strictEqual(CanonicalJson.stringify(left), CanonicalJson.stringify(right));
    assert.deepStrictEqual(CanonicalJson.encode(left), CanonicalJson.encode(right));
  });

  it("escapes strings and normalizes numbers like JSON", () => {
    assert.strictEqual(CanonicalJson.stringify({ é: 'a"b\n', n: -0 }), '{"n":0,"é":"a\\"b\\n"}');
    assert.throws(() => CanonicalJson.stringify({ n: Number.NaN }));
    assert.throws(() => CanonicalJson.stringify([Number.POSITIVE_INFINITY]));
  });
});

describe("Integrity", () => {
  it.effect("computes and verifies sha256 integrity", () =>
    Effect.gen(function* () {
      const bytes = encoder.encode("hello");
      const integrity = yield* Integrity.compute(bytes);
      assert.strictEqual(integrity, "sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=");
      assert.isTrue(Integrity.isIntegrity(integrity));
      yield* Integrity.verify(bytes, integrity);
      const exit = yield* Effect.exit(Integrity.verify(encoder.encode("hellO"), integrity));
      assert.isTrue(Exit.isFailure(exit));
    }),
  );

  it("rejects malformed integrity strings", () => {
    assert.isFalse(Integrity.isIntegrity("sha512-abc"));
    assert.isFalse(Integrity.isIntegrity("sha256-short="));
  });
});

const makeRecord = (integrity: string): Protocol.SignedRecord => ({
  namespace: "modules.example.com",
  publisher: "bob",
  name: "lights",
  version: "1.0.0",
  api: 1,
  integrity,
  trust: "untrusted",
  status: "active",
});

describe("Signing", () => {
  it.effect("signs and verifies a release record", () =>
    Effect.gen(function* () {
      const pair = yield* Signing.generateKeyPair;
      const integrity = yield* Integrity.compute(encoder.encode("tarball"));
      const record = makeRecord(integrity);
      const signature = yield* Signing.sign(
        yield* Signing.importPrivateKey(pair.privateKey),
        record,
      );
      const publicKey = yield* Signing.importPublicKey(pair.publicKey);
      assert.isTrue(yield* Signing.verify(publicKey, record, signature));

      const keys = [{ id: "k1", algorithm: "Ed25519", publicKey: pair.publicKey }] as const;
      yield* Signing.verifyRelease(keys, record, { keyId: "k1", value: signature });
    }),
  );

  it.effect("detects tampered records, signatures and keys", () =>
    Effect.gen(function* () {
      const pair = yield* Signing.generateKeyPair;
      const other = yield* Signing.generateKeyPair;
      const record = makeRecord(yield* Integrity.compute(encoder.encode("tarball")));
      const signature = yield* Signing.sign(
        yield* Signing.importPrivateKey(pair.privateKey),
        record,
      );
      const publicKey = yield* Signing.importPublicKey(pair.publicKey);

      for (const tampered of [
        { ...record, trust: "trusted" as const },
        { ...record, status: "revoked" as const },
        { ...record, version: "1.0.1" },
        { ...record, namespace: "evil.example.com" },
      ])
        assert.isFalse(yield* Signing.verify(publicKey, tampered, signature));

      const flipped = `${signature.slice(0, 4)}${signature[4] === "A" ? "B" : "A"}${signature.slice(5)}`;
      assert.isFalse(yield* Signing.verify(publicKey, record, flipped));
      assert.isFalse(yield* Signing.verify(publicKey, record, "not base64!"));

      const wrongKey = [{ id: "k1", algorithm: "Ed25519", publicKey: other.publicKey }] as const;
      const wrong = yield* Effect.exit(
        Signing.verifyRelease(wrongKey, record, { keyId: "k1", value: signature }),
      );
      assert.isTrue(Exit.isFailure(wrong));
      const unknown = yield* Effect.exit(
        Signing.verifyRelease(wrongKey, record, { keyId: "k2", value: signature }),
      );
      assert.isTrue(Exit.isFailure(unknown));
    }),
  );

  it("builds the signed record from a release", () => {
    const record = Protocol.signedRecord(
      "modules.example.com",
      { publisher: "bob", name: "lights" },
      {
        version: "1.0.0",
        api: 1,
        integrity: "sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=",
        trust: "trusted",
        status: "active",
      },
    );
    assert.strictEqual(
      CanonicalJson.stringify(record),
      '{"api":1,"integrity":"sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=","name":"lights","namespace":"modules.example.com","publisher":"bob","status":"active","trust":"trusted","version":"1.0.0"}',
    );
  });
});

describe("Protocol", () => {
  it.effect("decodes registry metadata and package releases", () =>
    Effect.gen(function* () {
      const metadata = yield* Protocol.decodeMetadata({
        protocol: 1,
        namespace: "modules.example.com",
        displayName: "Example",
        keys: [{ id: "k1", algorithm: "Ed25519", publicKey: "AAAA" }],
      });
      assert.strictEqual(metadata.namespace, "modules.example.com");
      const local = yield* Effect.exit(
        Protocol.decodeMetadata({ ...metadata, namespace: "local" }),
      );
      assert.isTrue(Exit.isFailure(local));

      const pkg = yield* Protocol.decodePackage({
        publisher: "bob",
        name: "lights",
        releases: [
          {
            version: "1.0.0",
            api: 1,
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
            tarball: "https://modules.example.com/t/bob-lights-1.0.0.tgz",
            integrity: "sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=",
            trust: "untrusted",
            status: "yanked",
            reason: "broken",
            signature: { keyId: "k1", value: "AAAA" },
          },
        ],
      });
      assert.strictEqual(pkg.releases[0]?.status, "yanked");
      assert.strictEqual(Protocol.packagePath("bob", "lights"), "/v1/packages/bob/lights.json");
    }),
  );
});
