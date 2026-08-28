import { assert, describe, it } from "@effect/vitest";

import {
  encodeFragment,
  handshake,
  HandshakeType,
  MessageAssembler,
  parseFragments,
} from "../src/DTLS/Handshake.js";
import { ClientHandshakeHandler, CIPHER_SUITE } from "../src/DTLS/HandshakeHandler.js";
import {
  ContentType,
  encodeRecord,
  parseRecords,
  RecordLayer,
  VERSION,
} from "../src/DTLS/RecordLayer.js";
import { Reader, uint } from "../src/lib/codec.js";
import { decrypt, encrypt } from "../src/TLS/AEADCipher.js";
import { AntiReplayWindow, MAX_SEQUENCE } from "../src/TLS/AntiReplayWindow.js";
import { ConnectionState } from "../src/TLS/ConnectionState.js";
import { prf } from "../src/TLS/PRF.js";
import { options, Peer } from "./Peer.js";

describe("DTLS protocol port", () => {
  it("matches the published TLS 1.2 SHA256 PRF test vector", () => {
    const output = prf(
      Buffer.from("9bbe436ba940f017b17652849a71db35", "hex"),
      "test label",
      Buffer.from("a0ba9f936cda311827a6f796ffd5198c", "hex"),
      100,
    );
    assert.strictEqual(
      output.toString("hex"),
      "e3f229ba727be17b8d122620557cd453c2aab21d07c3d495329b52d4e61edb5a6" +
        "b301791e90d35c9c9a46b4e14baf9af0fa022f7077def17abfd3797c0564bab" +
        "4fbc91666e9def9b97fce34f796789baa48082d122ee42c5a72e5a5110fff701" +
        "87347b66",
    );
  });

  it("round-trips all 48 sequence bits and rejects out-of-range/truncated fields", () => {
    for (const value of [0, 2 ** 32 - 1, 2 ** 32, 2 ** 40 + 123, MAX_SEQUENCE]) {
      assert.strictEqual(new Reader(uint(value, 6)).uint(6), value);
      const packet = encodeRecord({
        type: 22,
        version: VERSION,
        epoch: 0,
        sequence: value,
        fragment: Buffer.from([1]),
      });
      assert.strictEqual(parseRecords(packet)[0]!.sequence, value);
      assert.throws(() => parseRecords(packet.subarray(0, -1)), /Truncated/);
    }
    for (const value of [-1, 0.5, NaN, Infinity, MAX_SEQUENCE + 1])
      assert.throws(() => uint(value, 6));
    assert.throws(() => parseRecords(Buffer.alloc(65508)), /Oversized/);
    const empty = encodeRecord({
      type: 22,
      version: VERSION,
      epoch: 0,
      sequence: 0,
      fragment: Buffer.alloc(0),
    });
    assert.throws(
      () => parseRecords(Buffer.concat(Array.from({ length: 65 }, () => empty))),
      /Too many/,
    );
    assert.throws(() => new Reader(Buffer.from([2, 1])).vector(1), /Truncated/);
  });

  it("slides the replay bitmap correctly at 32/64-bit boundaries and large gaps", () => {
    const window = new AntiReplayWindow();
    for (const value of [-1, 0.5, NaN, MAX_SEQUENCE + 1]) assert.isFalse(window.mayReceive(value));
    window.markAsReceived(0);
    window.markAsReceived(32);
    assert.isFalse(window.mayReceive(0));
    assert.isFalse(window.mayReceive(32));
    assert.isTrue(window.mayReceive(31));
    window.markAsReceived(64);
    assert.isFalse(window.mayReceive(0));
    assert.isFalse(window.mayReceive(32));
    window.markAsReceived(2 ** 40);
    assert.isFalse(window.mayReceive(64));
    assert.isTrue(window.mayReceive(2 ** 40 - 63));
    assert.isFalse(window.mayReceive(2 ** 40 - 64));
    assert.throws(() => window.markAsReceived(2 ** 40));
    window.reset();
    assert.isTrue(window.mayReceive(0));
  });

  it("authenticates CCM8 headers/body, uses unique sequence nonces, and never releases bad MACs", () => {
    const state = new ConnectionState(Buffer.from("PSK"), Buffer.alloc(32, 1), Buffer.alloc(32, 2));
    const base = {
      type: ContentType.applicationData,
      version: VERSION,
      epoch: 1,
      sequence: 2 ** 32,
      fragment: Buffer.from("payload"),
    };
    const encrypted = encrypt(base, state.server);
    assert.deepStrictEqual(
      encrypted.fragment.subarray(0, 8),
      Buffer.concat([uint(1, 2), uint(2 ** 32, 6)]),
    );
    assert.deepStrictEqual(decrypt(encrypted, state.server)?.fragment, base.fragment);
    assert.isUndefined(decrypt({ ...encrypted, sequence: base.sequence + 1 }, state.server));
    assert.isUndefined(decrypt({ ...encrypted, type: ContentType.handshake }, state.server));
    assert.isUndefined(decrypt({ ...encrypted, version: 0xfeff }, state.server));
    for (let index = 0; index < encrypted.fragment.length; index++) {
      const damaged = Buffer.from(encrypted.fragment);
      damaged[index] = damaged.readUInt8(index) ^ 1;
      assert.isUndefined(decrypt({ ...encrypted, fragment: damaged }, state.server));
    }
    assert.isUndefined(decrypt({ ...encrypted, fragment: Buffer.alloc(15) }, state.server));
    const next = encrypt({ ...base, sequence: base.sequence + 1 }, state.server);
    assert.notDeepEqual(next.fragment.subarray(0, 8), encrypted.fragment.subarray(0, 8));
    state.destroy();
    assert.deepStrictEqual(state.masterSecret, Buffer.alloc(48));
  });

  it("marks replay state only after authentication, including duplicate records in one datagram", () => {
    const layer = new RecordLayer();
    const peer = new Peer({ cookie: false });
    peer.receive(
      layer.send(
        ContentType.handshake,
        handshake(
          HandshakeType.clientHello,
          0,
          Buffer.concat([
            uint(VERSION, 2),
            Buffer.alloc(32, 1),
            Buffer.from([0, 0, 0, 2]),
            uint(CIPHER_SUITE, 2),
            Buffer.from([1, 0]),
          ]),
        ),
      ),
    );
    layer.state = peer.state;
    layer.advanceReadEpoch();
    const packet = parseRecords(peer.applicationData("payload"))[0]!;
    const damaged = Buffer.from(packet.fragment);
    damaged[damaged.length - 1] = damaged.readUInt8(damaged.length - 1) ^ 1;
    assert.isUndefined(layer.receive({ ...packet, fragment: damaged }));
    const records = parseRecords(Buffer.concat([encodeRecord(packet), encodeRecord(packet)]));
    assert.strictEqual(records.map((record) => layer.receive(record)).filter(Boolean).length, 1);
    assert.isUndefined(layer.receive({ ...packet, epoch: 2 }));
    assert.isUndefined(layer.receive({ ...packet, epoch: 0 }));
    assert.throws(() => layer.advanceReadEpoch());
    assert.throws(() => layer.resetBeforeServerHello());
  });

  it("reassembles reordered/overlapping fragments exactly and bounds metadata/allocations", () => {
    const assembler = new MessageAssembler();
    const body = Buffer.from("abcdef");
    assembler.add({ type: 2, sequence: 0, total: 6, offset: 3, body: body.subarray(3) });
    assert.isUndefined(assembler.take());
    assembler.add({ type: 2, sequence: 0, total: 6, offset: 1, body: body.subarray(1, 5) });
    assembler.add({ type: 2, sequence: 0, total: 6, offset: 0, body: body.subarray(0, 2) });
    assert.deepStrictEqual(assembler.take()?.body, body);
    assembler.add({ type: 14, sequence: 1, total: 0, offset: 0, body: Buffer.alloc(0) });
    assert.strictEqual(assembler.take()?.type, 14);
    assert.throws(
      () => assembler.add({ type: 2, sequence: 10, total: 1, offset: 0, body: Buffer.from([1]) }),
      /sequence/,
    );
    assert.throws(
      () => assembler.add({ type: 2, sequence: 2, total: 4097, offset: 0, body: Buffer.from([1]) }),
      /bounds/,
    );
    assembler.add({ type: 2, sequence: 2, total: 2, offset: 0, body: Buffer.from([1]) });
    assert.throws(
      () => assembler.add({ type: 2, sequence: 2, total: 2, offset: 0, body: Buffer.from([2]) }),
      /overlapping/,
    );
    assert.throws(
      () => assembler.add({ type: 3, sequence: 2, total: 2, offset: 1, body: Buffer.from([2]) }),
      /metadata/,
    );
    assert.throws(
      () => parseFragments(Buffer.from([2, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0])),
      /bounds/,
    );
    assert.throws(
      () =>
        parseFragments(
          encodeFragment({
            type: 2,
            sequence: 0,
            total: 2,
            offset: 0,
            body: Buffer.from([1, 2]),
          }).subarray(0, -1),
        ),
      /Truncated/,
    );
    const full = new MessageAssembler();
    for (let sequence = 0; sequence < 4; sequence++)
      full.add({ type: 2, sequence, total: 4096, offset: 0, body: Buffer.from([1]) });
    assert.throws(
      () => full.add({ type: 2, sequence: 4, total: 1, offset: 0, body: Buffer.from([1]) }),
      /capacity/,
    );
  });

  it("rejects unoffered suites, compression, versions, premature CCS and cleartext Finished", () => {
    const make = () =>
      new ClientHandshakeHandler(
        new RecordLayer(),
        Buffer.from(options.identity),
        Buffer.from(options.psk),
        Buffer.alloc(32),
        false,
      );
    const handler = make();
    assert.throws(() => handler.changeCipherSpec(Buffer.from([1]), 0), /Unexpected/);
    assert.throws(
      () => handler.receive(handshake(HandshakeType.finished, 0, Buffer.alloc(12)), 0),
      /Unauthenticated/,
    );
    for (const [version, suite, compression] of [
      [VERSION, 0xc0a9, 0],
      [VERSION, CIPHER_SUITE, 1],
      [0xfeff, CIPHER_SUITE, 0],
    ]) {
      const hello = Buffer.concat([
        uint(version!, 2),
        Buffer.alloc(32),
        Buffer.from([0]),
        uint(suite!, 2),
        uint(compression!, 1),
      ]);
      assert.throws(() => make().receive(handshake(HandshakeType.serverHello, 0, hello), 0));
    }
    assert.isUndefined(
      new RecordLayer().receive({
        type: ContentType.applicationData,
        version: VERSION,
        epoch: 0,
        sequence: 0,
        fragment: Buffer.from("cleartext"),
      }),
    );
  });
});
