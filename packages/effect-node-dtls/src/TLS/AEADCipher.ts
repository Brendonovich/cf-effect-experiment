// Port of TLS/AEADCipher.ts + lib/AEADCrypto.ts, native AES-128-CCM/8 only.
// Copyright (c) 2017-2026 AlCalzone <d.griesel@gmx.net> (MIT); see LICENSE.
import { createCipheriv, createDecipheriv } from "node:crypto";

import type { TrafficKey } from "./ConnectionState.js";

import { uint } from "../lib/codec.js";

export interface Record {
  readonly type: number;
  readonly version: number;
  readonly epoch: number;
  readonly sequence: number;
  readonly fragment: Buffer;
}

function sequenceBytes(record: Record): Buffer {
  return Buffer.concat([uint(record.epoch, 2), uint(record.sequence, 6)]);
}

function additionalData(record: Record, plaintextLength: number): Buffer {
  return Buffer.concat([
    sequenceBytes(record),
    uint(record.type, 1),
    uint(record.version, 2),
    uint(plaintextLength, 2),
  ]);
}

export function encrypt(record: Record, traffic: TrafficKey): Record {
  // Unlike upstream's random explicit IV, epoch + sequence is unique for this key.
  const explicit = sequenceBytes(record);
  const cipher = createCipheriv("aes-128-ccm", traffic.key, Buffer.concat([traffic.iv, explicit]), {
    authTagLength: 8,
  });
  cipher.setAAD(additionalData(record, record.fragment.length), {
    plaintextLength: record.fragment.length,
  });
  const ciphertext = cipher.update(record.fragment);
  cipher.final();
  return { ...record, fragment: Buffer.concat([explicit, ciphertext, cipher.getAuthTag()]) };
}

/** Bad MACs are discarded, never returned as plaintext or entered in the replay window. */
export function decrypt(record: Record, traffic: TrafficKey): Record | undefined {
  if (record.fragment.length < 16) return undefined;
  const ciphertext = record.fragment.subarray(8, -8);
  try {
    const decipher = createDecipheriv(
      "aes-128-ccm",
      traffic.key,
      Buffer.concat([traffic.iv, record.fragment.subarray(0, 8)]),
      { authTagLength: 8 },
    );
    decipher.setAuthTag(record.fragment.subarray(-8));
    decipher.setAAD(additionalData(record, ciphertext.length), {
      plaintextLength: ciphertext.length,
    });
    const plaintext = decipher.update(ciphertext);
    decipher.final();
    return { ...record, fragment: plaintext };
  } catch {
    return undefined;
  }
}
