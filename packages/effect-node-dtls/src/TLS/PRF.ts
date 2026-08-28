// Port of TLS/PRF.ts from node-dtls-client 2.0.3, narrowed to SHA-256.
// Copyright (c) 2017-2026 AlCalzone <d.griesel@gmx.net> (MIT); see LICENSE.
import { createHash, createHmac } from "node:crypto";

export function hash(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/** TLS 1.2 P_SHA256(secret, ASCII(label) + seed), RFC 5246 section 5. */
export function prf(secret: Buffer, label: string, seed: Buffer, length: number): Buffer {
  if (!Number.isSafeInteger(length) || length < 0 || length > 4096)
    throw new Error("Invalid PRF output length");
  seed = Buffer.concat([Buffer.from(label, "ascii"), seed]);
  const hmac = (data: Buffer) => createHmac("sha256", secret).update(data).digest();
  let a = seed;
  const hashes: Buffer[] = [];
  for (let produced = 0; produced < length; produced += 32) {
    a = hmac(a);
    hashes.push(hmac(Buffer.concat([a, seed])));
  }
  return Buffer.concat(hashes, length);
}
