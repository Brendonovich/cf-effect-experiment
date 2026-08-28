// Port of TLS/ConnectionState.ts and TLS/PreMasterSecret.ts, PSK/CCM8 only.
// Copyright (c) 2017-2026 AlCalzone <d.griesel@gmx.net> (MIT); see LICENSE.
import { vector } from "../lib/codec.js";
import { prf } from "./PRF.js";

export interface TrafficKey {
  readonly key: Buffer;
  readonly iv: Buffer;
}

export class ConnectionState {
  readonly masterSecret: Buffer;
  readonly client: TrafficKey;
  readonly server: TrafficKey;

  constructor(psk: Buffer, clientRandom: Buffer, serverRandom: Buffer) {
    if (
      psk.length < 1 ||
      psk.length > 256 ||
      clientRandom.length !== 32 ||
      serverRandom.length !== 32
    )
      throw new Error("Invalid PSK key schedule input");
    const preMasterSecret = Buffer.concat([vector(Buffer.alloc(psk.length), 2), vector(psk, 2)]);
    this.masterSecret = prf(
      preMasterSecret,
      "master secret",
      Buffer.concat([clientRandom, serverRandom]),
      48,
    );
    preMasterSecret.fill(0);
    // CCM has no separate MAC keys: two 16-byte keys followed by two 4-byte salts.
    const block = prf(
      this.masterSecret,
      "key expansion",
      Buffer.concat([serverRandom, clientRandom]),
      40,
    );
    this.client = { key: block.subarray(0, 16), iv: block.subarray(32, 36) };
    this.server = { key: block.subarray(16, 32), iv: block.subarray(36, 40) };
  }

  destroy(): void {
    this.masterSecret.fill(0);
    this.client.key.fill(0);
    this.client.iv.fill(0);
    this.server.key.fill(0);
    this.server.iv.fill(0);
  }
}
