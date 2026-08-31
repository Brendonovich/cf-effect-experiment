import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { type Credential, decrypt, encrypt } from "../src/credentials.ts";

const key = Buffer.alloc(32, 1).toString("base64");
const repository = "owner/repository";
const credential: Credential = {
  access: "access-token",
  refresh: "refresh-token",
  expires: 1_800_000_000_000,
};

// Authenticate arbitrary plaintext to exercise validation separately from GCM rejection.
function encryptPlaintext(plaintext: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), nonce);
  cipher.setAAD(Buffer.from(`${repository}:OPENCODE_CREDENTIALS`));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64");
}

describe("credential encryption", () => {
  it("roundtrips all credential fields", () => {
    expect(decrypt(encrypt(credential, key, repository), key, repository)).toEqual(credential);
  });

  it("uses a fresh 12-byte nonce for each encryption", () => {
    const first = encrypt(credential, key, repository);
    const second = encrypt(credential, key, repository);

    expect(Buffer.from(first, "base64").subarray(0, 12)).not.toEqual(
      Buffer.from(second, "base64").subarray(0, 12),
    );
    expect(first).not.toBe(second);
    expect(decrypt(first, key, repository)).toEqual(credential);
    expect(decrypt(second, key, repository)).toEqual(credential);
  });

  it.each([
    ["nonce", 0],
    ["authentication tag", 12],
    ["ciphertext", 28],
  ] as const)("rejects a tampered %s", (_segment, offset) => {
    const bytes = Buffer.from(encrypt(credential, key, repository), "base64");
    bytes.writeUInt8(bytes.readUInt8(offset) ^ 1, offset);

    expect(() => decrypt(bytes.toString("base64"), key, repository)).toThrow();
  });

  it("rejects a different valid-length key", () => {
    const wrongKey = Buffer.alloc(32, 2).toString("base64");

    expect(() => decrypt(encrypt(credential, key, repository), wrongKey, repository)).toThrow();
  });

  it.each(["other/repository", "owner/other"])(
    "rejects credentials copied to %s",
    (otherRepository) => {
      expect(() => decrypt(encrypt(credential, key, repository), key, otherRepository)).toThrow();
    },
  );

  it.each([0, 11, 12, 27, 28])("rejects an envelope truncated to %i bytes", (length) => {
    const bytes = Buffer.from(encrypt(credential, key, repository), "base64");

    expect(() => decrypt(bytes.subarray(0, length).toString("base64"), key, repository)).toThrow();
  });
});

describe("stored credential validation", () => {
  it.each([
    ["null", "null"],
    ["boolean", "false"],
    ["number", "42"],
    ["string", '"credential"'],
    ["array", "[]"],
    ["empty object", "{}"],
    [
      "missing access",
      JSON.stringify({ refresh: credential.refresh, expires: credential.expires }),
    ],
    ["empty access", JSON.stringify({ ...credential, access: "" })],
    ["non-string access", JSON.stringify({ ...credential, access: 42 })],
    ["missing refresh", JSON.stringify({ access: credential.access, expires: credential.expires })],
    ["empty refresh", JSON.stringify({ ...credential, refresh: "" })],
    ["non-string refresh", JSON.stringify({ ...credential, refresh: false })],
    ["missing expiry", JSON.stringify({ access: credential.access, refresh: credential.refresh })],
    ["string expiry", JSON.stringify({ ...credential, expires: "1800000000000" })],
    ["null expiry", JSON.stringify({ ...credential, expires: null })],
    ["non-finite expiry", '{"access":"access-token","refresh":"refresh-token","expires":1e400}'],
  ])("rejects %s in authenticated plaintext", (_description, plaintext) => {
    expect(() => decrypt(encryptPlaintext(plaintext), key, repository)).toThrow(
      "Invalid stored credential",
    );
  });

  it("rejects authenticated plaintext that is not valid JSON", () => {
    expect(() => decrypt(encryptPlaintext("not JSON"), key, repository)).toThrow(SyntaxError);
  });

  it("returns only the credential fields", () => {
    const plaintext = JSON.stringify({ ...credential, extra: "not a credential field" });

    expect(decrypt(encryptPlaintext(plaintext), key, repository)).toEqual(credential);
  });
});
