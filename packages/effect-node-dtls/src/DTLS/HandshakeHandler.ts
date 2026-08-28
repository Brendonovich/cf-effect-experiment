// Source port of DTLS/HandshakeHandler.ts; no events, transport or native timers.
// Copyright (c) 2017-2026 AlCalzone <d.griesel@gmx.net> (MIT); see LICENSE.
import { timingSafeEqual } from "node:crypto";

import { Reader, uint, vector } from "../lib/codec.js";
import { ConnectionState } from "../TLS/ConnectionState.js";
import { hash, prf } from "../TLS/PRF.js";
import {
  encodeFragment,
  handshake,
  HandshakeType,
  MAX_HANDSHAKE_BYTES,
  MessageAssembler,
  parseFragments,
  type Fragment,
} from "./Handshake.js";
import { ContentType, RecordLayer, VERSION } from "./RecordLayer.js";

export const CIPHER_SUITE = 0xc0a8; // TLS_PSK_WITH_AES_128_CCM_8
type State = "hello" | "serverHello" | "serverFlight" | "finished" | "established" | "closed";

export class ClientHandshakeHandler {
  private state: State = "hello";
  private readonly assembler = new MessageAssembler();
  private readonly transcript: Buffer[] = [];
  private transcriptBytes = 0;
  private clientSequence = 0;
  private serverRandom: Buffer | undefined;
  private sawKeyExchange = false;
  private receivedCCS = false;
  private readonly output: Buffer[] = [];

  constructor(
    readonly recordLayer: RecordLayer,
    private readonly identity: Buffer,
    private readonly psk: Buffer,
    private readonly clientRandom: Buffer,
    private readonly resetAntiReplayWindowBeforeServerHello: boolean,
  ) {
    if (clientRandom.length !== 32) throw new Error("Invalid client random");
    this.sendHello(Buffer.alloc(0));
  }

  get established(): boolean {
    return this.state === "established";
  }
  drainOutput(): Buffer[] {
    return this.output.splice(0);
  }

  private remember(data: Buffer): void {
    if (this.transcriptBytes + data.length > MAX_HANDSHAKE_BYTES)
      throw new Error("Handshake transcript capacity exceeded");
    this.transcript.push(data);
    this.transcriptBytes += data.length;
  }

  private sendHello(cookie: Buffer): void {
    // Offer only null compression and the empty renegotiation_info extension.
    const extensions = Buffer.from([0xff, 0x01, 0x00, 0x01, 0x00]);
    const body = Buffer.concat([
      uint(VERSION, 2),
      this.clientRandom,
      vector(Buffer.alloc(0), 1),
      vector(cookie, 1),
      vector(uint(CIPHER_SUITE, 2), 2),
      Buffer.from([1, 0]),
      vector(extensions, 2),
    ]);
    const message = handshake(HandshakeType.clientHello, this.clientSequence++, body);
    this.remember(message);
    this.output.push(this.recordLayer.send(ContentType.handshake, message));
  }

  changeCipherSpec(data: Buffer, epoch: number): void {
    if (
      this.state !== "finished" ||
      this.receivedCCS ||
      epoch !== 0 ||
      data.length !== 1 ||
      data[0] !== 1
    )
      throw new Error("Unexpected ChangeCipherSpec");
    this.recordLayer.advanceReadEpoch();
    this.receivedCCS = true;
  }

  receive(data: Buffer, epoch: number): void {
    // Renegotiation and post-handshake retransmissions are not implemented.
    if (this.established) return;
    for (const fragment of parseFragments(data)) {
      if (fragment.type === HandshakeType.finished) {
        if (epoch !== 1 || this.state !== "finished" || !this.receivedCCS)
          throw new Error("Unauthenticated or premature Finished");
      } else if (epoch !== 0 || this.state === "finished") {
        throw new Error("Unexpected handshake epoch/type");
      }
      this.assembler.add(fragment);
      let message: Fragment | undefined;
      while ((message = this.assembler.take()) !== undefined) this.process(message);
    }
  }

  private process(message: Fragment): void {
    const reader = new Reader(message.body);
    switch (message.type) {
      case HandshakeType.helloVerifyRequest: {
        if (this.state !== "hello") throw new Error("Unexpected HelloVerifyRequest");
        const version = reader.uint(2);
        if (version !== VERSION && version !== 0xfeff)
          throw new Error("Unsupported HelloVerifyRequest version");
        const cookie = reader.vector(1);
        reader.end();
        if (cookie.length === 0) throw new Error("Empty DTLS cookie");
        // RFC 6347: exclude the original ClientHello and HVR, but NOT cookie-less
        // ClientHello when the server skips HVR (an upstream transcript bug).
        this.transcript.length = 0;
        this.transcriptBytes = 0;
        this.state = "serverHello";
        // IKEA v1.15.x only: one epoch-zero reset after the single accepted HVR.
        if (this.resetAntiReplayWindowBeforeServerHello) this.recordLayer.resetBeforeServerHello();
        this.sendHello(cookie);
        return;
      }
      case HandshakeType.serverHello: {
        if (this.state !== "hello" && this.state !== "serverHello")
          throw new Error("Unexpected ServerHello");
        if (reader.uint(2) !== VERSION) throw new Error("Only DTLS 1.2 is supported");
        this.serverRandom = Buffer.from(reader.take(32));
        if (reader.vector(1).length > 32) throw new Error("Invalid server session ID");
        if (reader.uint(2) !== CIPHER_SUITE)
          throw new Error("Server selected an unoffered cipher suite");
        if (reader.uint(1) !== 0) throw new Error("Compression is not supported");
        if (reader.remaining > 0) {
          const extensions = new Reader(reader.vector(2));
          let sawRenegotiation = false;
          while (extensions.remaining > 0) {
            const type = extensions.uint(2);
            const body = extensions.vector(2);
            if (type !== 0xff01 || sawRenegotiation || body.length !== 1 || body[0] !== 0)
              throw new Error("Unsupported or duplicate ServerHello extension");
            sawRenegotiation = true;
          }
        }
        reader.end();
        this.state = "serverFlight";
        break;
      }
      case HandshakeType.serverKeyExchange: {
        if (this.state !== "serverFlight" || this.sawKeyExchange)
          throw new Error("Unexpected ServerKeyExchange");
        reader.vector(2); // PSK identity hint is informational; identity is explicit in Options.
        reader.end();
        this.sawKeyExchange = true;
        break;
      }
      case HandshakeType.serverHelloDone: {
        if (this.state !== "serverFlight" || !this.serverRandom)
          throw new Error("Unexpected ServerHelloDone");
        reader.end();
        this.remember(encodeFragment(message));
        const connection = new ConnectionState(this.psk, this.clientRandom, this.serverRandom);
        this.recordLayer.state = connection;
        this.psk.fill(0);
        const keyExchange = handshake(
          HandshakeType.clientKeyExchange,
          this.clientSequence++,
          vector(this.identity, 2),
        );
        this.remember(keyExchange);
        const outgoingKeyExchange = this.recordLayer.send(ContentType.handshake, keyExchange);
        const ccs = this.recordLayer.send(ContentType.changeCipherSpec, Buffer.from([1]));
        const verifyData = this.verifyData("client");
        const finished = handshake(HandshakeType.finished, this.clientSequence++, verifyData);
        this.remember(finished);
        this.recordLayer.advanceWriteEpoch();
        this.output.push(
          Buffer.concat([
            outgoingKeyExchange,
            ccs,
            this.recordLayer.send(ContentType.handshake, finished),
          ]),
        );
        this.state = "finished";
        return;
      }
      case HandshakeType.finished: {
        if (this.state !== "finished" || !this.receivedCCS) throw new Error("Unexpected Finished");
        const expected = this.verifyData("server");
        if (message.body.length !== expected.length || !timingSafeEqual(message.body, expected))
          throw new Error("DTLS Finished verification failed");
        this.state = "established";
        this.transcript.length = 0;
        this.transcriptBytes = 0;
        this.assembler.clear();
        return;
      }
      default:
        throw new Error(`Unsupported handshake type ${message.type}`);
    }
    this.remember(encodeFragment(message));
  }

  private verifyData(source: "client" | "server"): Buffer {
    const connection = this.recordLayer.state;
    if (!connection) throw new Error("Missing handshake keys");
    return prf(
      connection.masterSecret,
      `${source} finished`,
      hash(Buffer.concat(this.transcript)),
      12,
    );
  }

  destroy(): void {
    this.state = "closed";
    this.psk.fill(0);
    this.transcript.length = 0;
    this.transcriptBytes = 0;
    this.assembler.clear();
    this.output.length = 0;
    this.recordLayer.destroy();
  }
}
