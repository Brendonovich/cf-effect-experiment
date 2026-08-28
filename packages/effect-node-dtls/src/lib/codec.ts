// Source-derived from node-dtls-client 2.0.3; see README.md and LICENSE.
// Copyright (c) 2017-2026 AlCalzone <d.griesel@gmx.net> (MIT).

/** Checked replacement for lib/BitConverter and dynamic TLSStruct/Vector codecs. */
export function uint(value: number, bytes: 1 | 2 | 3 | 4 | 6): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** (bytes * 8))
    throw new Error(`Invalid uint${bytes * 8}: ${value}`);
  const buffer = Buffer.alloc(bytes);
  // Do not use JS bitwise shifts: DTLS record sequences are 48 bits.
  buffer.writeUIntBE(value, 0, bytes);
  return buffer;
}

export function vector(data: Buffer, bytes: 1 | 2): Buffer {
  return Buffer.concat([uint(data.length, bytes), data]);
}

export class Reader {
  private offset = 0;
  constructor(private readonly data: Buffer) {}
  get remaining(): number {
    return this.data.length - this.offset;
  }
  take(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining)
      throw new Error("Truncated DTLS field");
    const result = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
  uint(bytes: 1 | 2 | 3 | 4 | 6): number {
    return this.take(bytes).readUIntBE(0, bytes);
  }
  vector(bytes: 1 | 2): Buffer {
    return this.take(this.uint(bytes));
  }
  end(): void {
    if (this.remaining !== 0) throw new Error("Trailing DTLS fields");
  }
}
