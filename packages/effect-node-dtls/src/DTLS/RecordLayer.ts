import type { ConnectionState } from "../TLS/ConnectionState.js";

// Transport-free port of DTLS/RecordLayer.ts and DTLS packet codecs.
// Copyright (c) 2017-2026 AlCalzone <d.griesel@gmx.net> (MIT); see LICENSE.
import { Reader, uint } from "../lib/codec.js";
import { decrypt, encrypt, type Record } from "../TLS/AEADCipher.js";
import { AntiReplayWindow, MAX_SEQUENCE } from "../TLS/AntiReplayWindow.js";

export const VERSION = 0xfefd;
export const MAX_PLAINTEXT = 16384;
export const ContentType = {
  changeCipherSpec: 20,
  alert: 21,
  handshake: 22,
  applicationData: 23,
} as const;

export function encodeRecord(record: Record): Buffer {
  return Buffer.concat([
    uint(record.type, 1),
    uint(record.version, 2),
    uint(record.epoch, 2),
    uint(record.sequence, 6),
    uint(record.fragment.length, 2),
    record.fragment,
  ]);
}

/** Parse the entire datagram before changing state; never accept a truncated prefix. */
export function parseRecords(data: Buffer): Record[] {
  if (data.length > 65507) throw new Error("Oversized DTLS datagram");
  const reader = new Reader(data);
  const records: Record[] = [];
  while (reader.remaining > 0) {
    if (records.length >= 64) throw new Error("Too many records in datagram");
    const type = reader.uint(1);
    const version = reader.uint(2);
    const epoch = reader.uint(2);
    const sequence = reader.uint(6);
    const length = reader.uint(2);
    if (length > MAX_PLAINTEXT + (epoch === 0 ? 0 : 16)) throw new Error("Oversized DTLS record");
    records.push({ type, version, epoch, sequence, fragment: reader.take(length) });
  }
  return records;
}

export class RecordLayer {
  state: ConnectionState | undefined;
  private readEpoch = 0;
  private writeEpoch = 0;
  private readonly replay = [new AntiReplayWindow(), new AntiReplayWindow()] as const;
  private readonly sequences = [-1, -1];

  /** Invoke separately for each record, interleaved with CCS/handshake processing. */
  receive(record: Record): Record | undefined {
    if (record.epoch !== this.readEpoch) return undefined;
    if (record.version !== VERSION && !(record.epoch === 0 && record.version === 0xfeff))
      return undefined;
    const window = this.replay[record.epoch];
    if (!window || !window.mayReceive(record.sequence)) return undefined;
    if (record.epoch === 1) {
      if (!this.state) return undefined;
      const plaintext = decrypt(record, this.state.server);
      if (!plaintext || plaintext.fragment.length > MAX_PLAINTEXT) return undefined;
      window.markAsReceived(record.sequence);
      return plaintext;
    }
    if (
      record.type !== ContentType.handshake &&
      record.type !== ContentType.changeCipherSpec &&
      record.type !== ContentType.alert
    )
      return undefined;
    window.markAsReceived(record.sequence);
    return record;
  }

  send(type: number, data: Buffer): Buffer {
    if (data.length > MAX_PLAINTEXT) throw new Error("DTLS plaintext exceeds 16384 bytes");
    const previous = this.sequences[this.writeEpoch];
    if (previous === undefined || previous >= MAX_SEQUENCE)
      throw new Error("DTLS sequence exhausted; reconnect required");
    const sequence = previous + 1;
    // Reserve BEFORE encryption/send. Failed or interrupted sends never reuse nonces.
    this.sequences[this.writeEpoch] = sequence;
    const record: Record = {
      type,
      version: VERSION,
      epoch: this.writeEpoch,
      sequence,
      fragment: data,
    };
    if (this.writeEpoch === 0) return encodeRecord(record);
    if (!this.state) throw new Error("No DTLS traffic keys");
    return encodeRecord(encrypt(record, this.state.client));
  }

  advanceReadEpoch(): void {
    if (this.readEpoch !== 0 || !this.state) throw new Error("Unexpected ChangeCipherSpec");
    this.readEpoch = 1;
  }

  advanceWriteEpoch(): void {
    if (this.writeEpoch !== 0 || !this.state) throw new Error("Unexpected write epoch transition");
    this.writeEpoch = 1;
  }

  resetBeforeServerHello(): void {
    if (this.readEpoch !== 0 || this.state) throw new Error("Replay reset outside cookie exchange");
    this.replay[0].reset();
  }

  destroy(): void {
    this.state?.destroy();
    this.state = undefined;
  }
}
