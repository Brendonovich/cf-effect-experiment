import { assert } from "@effect/vitest";

import { handshake, HandshakeType, parseFragments } from "../src/DTLS/Handshake.js";
import { CIPHER_SUITE } from "../src/DTLS/HandshakeHandler.js";
import { ContentType, encodeRecord, parseRecords, VERSION } from "../src/DTLS/RecordLayer.js";
import { Reader, uint, vector } from "../src/lib/codec.js";
import { decrypt, encrypt } from "../src/TLS/AEADCipher.js";
import { ConnectionState } from "../src/TLS/ConnectionState.js";
import { hash, prf } from "../src/TLS/PRF.js";

export const options = {
  address: "127.0.0.1",
  port: 5684,
  identity: "Client_identity",
  psk: "secretPSK",
  timeoutMs: 1000,
} as const;

/** Deterministic test peer. OpenSSL tests independently verify the production crypto. */
export class Peer {
  private readonly transcript: Buffer[] = [];
  private plainSequence = 0;
  private encryptedSequence = 0;
  private handshakeSequence = 0;
  state: ConnectionState | undefined;
  finished: Buffer | undefined;
  readonly application: Buffer[] = [];
  constructor(
    readonly config: {
      readonly cookie?: boolean;
      readonly firmwareReplay?: boolean;
      readonly holdFinished?: boolean;
      readonly badFinished?: boolean;
    } = {},
  ) {}

  plaintext(type: number, fragment: Buffer): Buffer {
    return encodeRecord({
      type,
      version: VERSION,
      epoch: 0,
      sequence: this.plainSequence++,
      fragment,
    });
  }

  encrypted(type: number, fragment: Buffer): Buffer {
    assert.isDefined(this.state);
    return encodeRecord(
      encrypt(
        { type, version: VERSION, epoch: 1, sequence: this.encryptedSequence++, fragment },
        this.state!.server,
      ),
    );
  }

  applicationData(data: string): Buffer {
    return this.encrypted(ContentType.applicationData, Buffer.from(data));
  }

  receive(data: Buffer): Buffer[] {
    const output: Buffer[] = [];
    for (const record of parseRecords(data)) {
      if (record.epoch === 1) {
        assert.isDefined(this.state);
        const plaintext = decrypt(record, this.state!.client);
        assert.isDefined(plaintext);
        if (record.type === ContentType.applicationData) {
          this.application.push(plaintext!.fragment);
          continue;
        }
        const fragment = parseFragments(plaintext!.fragment)[0]!;
        assert.strictEqual(fragment.type, HandshakeType.finished);
        const expected = prf(
          this.state!.masterSecret,
          "client finished",
          hash(Buffer.concat(this.transcript)),
          12,
        );
        assert.deepStrictEqual(fragment.body, expected);
        this.transcript.push(plaintext!.fragment);
        const verify = this.config.badFinished
          ? Buffer.alloc(12)
          : prf(
              this.state!.masterSecret,
              "server finished",
              hash(Buffer.concat(this.transcript)),
              12,
            );
        this.finished = this.encrypted(
          ContentType.handshake,
          handshake(HandshakeType.finished, this.handshakeSequence++, verify),
        );
        output.push(this.plaintext(ContentType.changeCipherSpec, Buffer.from([1])));
        if (!this.config.holdFinished) output.push(this.finished);
        continue;
      }
      if (record.type !== ContentType.handshake) continue;
      for (const fragment of parseFragments(record.fragment)) {
        if (fragment.type === HandshakeType.clientKeyExchange) {
          const reader = new Reader(fragment.body);
          assert.strictEqual(reader.vector(2).toString(), options.identity);
          reader.end();
          this.transcript.push(handshake(fragment.type, fragment.sequence, fragment.body));
          continue;
        }
        assert.strictEqual(fragment.type, HandshakeType.clientHello);
        const reader = new Reader(fragment.body);
        assert.strictEqual(reader.uint(2), VERSION);
        const clientRandom = reader.take(32);
        reader.vector(1);
        const cookie = reader.vector(1);
        assert.deepStrictEqual(reader.vector(2), uint(CIPHER_SUITE, 2));
        if (this.config.cookie !== false && cookie.length === 0) {
          output.push(
            this.plaintext(
              ContentType.handshake,
              handshake(
                HandshakeType.helloVerifyRequest,
                this.handshakeSequence++,
                Buffer.from([0xfe, 0xff, 3, 1, 2, 3]),
              ),
            ),
          );
          if (this.config.firmwareReplay) this.plainSequence = 0;
          continue;
        }
        this.transcript.push(handshake(fragment.type, fragment.sequence, fragment.body));
        const serverRandom = Buffer.alloc(32, 0x42);
        this.state = new ConnectionState(Buffer.from(options.psk), clientRandom, serverRandom);
        const hello = handshake(
          HandshakeType.serverHello,
          this.handshakeSequence++,
          Buffer.concat([
            uint(VERSION, 2),
            serverRandom,
            vector(Buffer.alloc(0), 1),
            uint(CIPHER_SUITE, 2),
            Buffer.from([0]),
          ]),
        );
        const hint = handshake(
          HandshakeType.serverKeyExchange,
          this.handshakeSequence++,
          vector(Buffer.from("hint"), 2),
        );
        const done = handshake(
          HandshakeType.serverHelloDone,
          this.handshakeSequence++,
          Buffer.alloc(0),
        );
        this.transcript.push(hello, hint, done);
        // Several handshake messages inside one record, unlike upstream's first-only parsing.
        output.push(this.plaintext(ContentType.handshake, Buffer.concat([hello, hint, done])));
      }
    }
    return output;
  }
}
