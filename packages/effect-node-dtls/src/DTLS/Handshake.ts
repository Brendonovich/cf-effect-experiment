// Port of DTLS/Handshake.ts: fixed PSK codecs and bounded fragment assembly.
// Copyright (c) 2017-2026 AlCalzone <d.griesel@gmx.net> (MIT); see LICENSE.
import { Reader, uint } from "../lib/codec.js";

export const HandshakeType = {
  clientHello: 1,
  serverHello: 2,
  helloVerifyRequest: 3,
  serverKeyExchange: 12,
  serverHelloDone: 14,
  clientKeyExchange: 16,
  finished: 20,
} as const;
export const MAX_HANDSHAKE_MESSAGE = 4096;
export const MAX_HANDSHAKE_BYTES = 16384;

export interface Fragment {
  readonly type: number;
  readonly total: number;
  readonly sequence: number;
  readonly offset: number;
  readonly body: Buffer;
}

export function encodeFragment(fragment: Fragment): Buffer {
  if (
    fragment.total > MAX_HANDSHAKE_MESSAGE ||
    fragment.offset + fragment.body.length > fragment.total
  )
    throw new Error("Invalid handshake fragment bounds");
  return Buffer.concat([
    uint(fragment.type, 1),
    uint(fragment.total, 3),
    uint(fragment.sequence, 2),
    uint(fragment.offset, 3),
    uint(fragment.body.length, 3),
    fragment.body,
  ]);
}

export function handshake(type: number, sequence: number, body: Buffer): Buffer {
  return encodeFragment({ type, sequence, body, total: body.length, offset: 0 });
}

export function parseFragments(data: Buffer): Fragment[] {
  const reader = new Reader(data);
  const fragments: Fragment[] = [];
  while (reader.remaining > 0) {
    if (fragments.length >= 64) throw new Error("Too many handshake fragments");
    const type = reader.uint(1);
    const total = reader.uint(3);
    const sequence = reader.uint(2);
    const offset = reader.uint(3);
    const length = reader.uint(3);
    if (total > MAX_HANDSHAKE_MESSAGE || offset + length > total || (total > 0 && length === 0))
      throw new Error("Invalid handshake fragment bounds");
    fragments.push({ type, total, sequence, offset, body: reader.take(length) });
  }
  return fragments;
}

interface Assembly {
  readonly type: number;
  readonly body: Buffer;
  readonly coverage: Uint8Array;
  received: number;
}

/** At most eight pending messages / 16KiB bodies, plus same-size coverage bitmap. */
export class MessageAssembler {
  private next = 0;
  private bytes = 0;
  private fragments = 0;
  private readonly messages = new Map<number, Assembly>();

  add(fragment: Fragment): void {
    if (++this.fragments > 256) throw new Error("Handshake fragment budget exceeded");
    if (fragment.sequence < this.next) return;
    if (fragment.sequence >= this.next + 8 || fragment.sequence > 16)
      throw new Error("Handshake sequence outside bounded flight window");
    if (
      fragment.total < 0 ||
      fragment.total > MAX_HANDSHAKE_MESSAGE ||
      fragment.offset < 0 ||
      fragment.offset + fragment.body.length > fragment.total
    )
      throw new Error("Invalid handshake fragment bounds");
    let assembly = this.messages.get(fragment.sequence);
    if (!assembly) {
      if (this.bytes + fragment.total > MAX_HANDSHAKE_BYTES)
        throw new Error("Handshake reassembly capacity exceeded");
      assembly = {
        type: fragment.type,
        body: Buffer.alloc(fragment.total),
        coverage: new Uint8Array(fragment.total),
        received: 0,
      };
      this.messages.set(fragment.sequence, assembly);
      this.bytes += fragment.total;
    }
    if (assembly.type !== fragment.type || assembly.body.length !== fragment.total)
      throw new Error("Conflicting handshake fragment metadata");
    for (let i = 0; i < fragment.body.length; i++) {
      const index = fragment.offset + i;
      const byte = fragment.body.readUInt8(i);
      if (assembly.coverage[index]) {
        if (assembly.body[index] !== byte)
          throw new Error("Conflicting overlapping handshake fragments");
      } else {
        assembly.body[index] = byte;
        assembly.coverage[index] = 1;
        assembly.received++;
      }
    }
  }

  take(): Fragment | undefined {
    const assembly = this.messages.get(this.next);
    if (!assembly || assembly.received !== assembly.body.length) return undefined;
    const sequence = this.next++;
    this.messages.delete(sequence);
    this.bytes -= assembly.body.length;
    return {
      type: assembly.type,
      sequence,
      body: assembly.body,
      total: assembly.body.length,
      offset: 0,
    };
  }

  clear(): void {
    this.messages.clear();
    this.bytes = 0;
  }
}
