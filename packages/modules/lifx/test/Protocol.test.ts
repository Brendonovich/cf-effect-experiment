import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Buffer } from "node:buffer";

import { colorToHex, hexToColor } from "../src/Color.ts";
import { DeviceId, LIFXFailure } from "../src/Definition.ts";
import { colorPayload, decode, encode, parseState, powerPayload } from "../src/Protocol.ts";
import { validateStorage } from "../src/Validation.ts";
import { device, statePayload } from "./Fixtures.ts";

describe("LIFX protocol", () => {
  it.effect("encodes exact little-endian headers and power/color payloads", () =>
    Effect.gen(function* () {
      const packet = encode(117, device.id, 0x12345678, 255, yield* powerPayload(true, 1000), true);
      assert.strictEqual(
        packet.toString("hex"),
        [
          "2a00001478563412",
          "d073d51234560000",
          "00000000000002ff",
          "000000000000000075000000",
          "ffffe8030000",
        ].join(""),
      );
      assert.strictEqual(encode(101, device.id, 1, 0, Buffer.alloc(0), false)[22], 1);
      assert.strictEqual((yield* powerPayload(false, 0)).toString("hex"), "000000000000");
      assert.strictEqual(
        (yield* colorPayload(
          { hue: 180, saturation: 100, brightness: 50, kelvin: 3500 },
          1000,
        )).toString("hex"),
        "000080ffff0080ac0de8030000",
      );
      assert.strictEqual(
        (yield* colorPayload(
          { hue: 360, saturation: 0, brightness: 0, kelvin: 9000 },
          0xffffffff,
        )).toString("hex"),
        "00ffff000000002823ffffffff",
      );
      assert.deepStrictEqual(decode(packet), {
        type: 117,
        source: 0x12345678,
        sequence: 255,
        target: device.id,
        payload: yield* powerPayload(true, 1000),
      });
    }),
  );
  it("rejects malformed headers without reading beyond datagram bounds", () => {
    for (const length of [0, 1, 2, 8, 23, 35]) assert.isUndefined(decode(Buffer.alloc(length)));
    const valid = encode(101, device.id, 1, 0, Buffer.alloc(0), false);
    for (const [offset, value] of [
      [0, 35],
      [2, 0x1401],
      [2, 0x1000],
      [2, 0x3400],
      [2, 0x5400],
      [14, 1],
    ] as const) {
      const invalid = Buffer.from(valid);
      invalid.writeUInt16LE(value, offset);
      assert.isUndefined(decode(invalid));
    }
    assert.isUndefined(decode(Buffer.concat([valid, Buffer.alloc(1)])));
  });
  it.effect("reads exact state offsets, NUL-terminated labels and brightness-aware hex", () =>
    Effect.gen(function* () {
      const payload = statePayload();
      payload.write("\0garbage", 16);
      const state = yield* parseState(payload);
      assert.strictEqual(state.label, "Desk");
      assert.strictEqual(state.power, true);
      assert.strictEqual(state.hue, (12345 / 65535) * 360);
      assert.strictEqual(state.saturation, (23456 / 65535) * 100);
      assert.strictEqual(state.brightness, (34567 / 65535) * 100);
      assert.strictEqual(state.kelvin, 3500);
      payload.fill(0, 0, 8);
      payload.writeUInt16LE(3500, 6);
      payload.writeUInt16LE(0, 10);
      assert.strictEqual((yield* parseState(payload)).hex, "#000000");
      assert.strictEqual((yield* parseState(payload)).power, false);
      payload.writeUInt16LE(32768, 10);
      assert.strictEqual((yield* parseState(payload)).power, true);
      for (const kelvin of [0, 1499, 9001, 65535]) {
        payload.writeUInt16LE(kelvin, 6);
        assert.instanceOf(yield* Effect.flip(parseState(payload)), LIFXFailure);
      }
      for (const length of [0, 44, 51, 53])
        assert.instanceOf(yield* Effect.flip(parseState(Buffer.alloc(length))), LIFXFailure);
    }),
  );
  it.effect("validates finite input ranges rather than clamping or wrapping", () =>
    Effect.gen(function* () {
      const color = { hue: 0, saturation: 0, brightness: 100, kelvin: 3500 };
      for (const duration of [-1, 0x100000000, 0.5, NaN, Infinity]) {
        assert.instanceOf(yield* Effect.flip(powerPayload(true, duration)), LIFXFailure);
        assert.instanceOf(yield* Effect.flip(colorPayload(color, duration)), LIFXFailure);
      }
      for (const patch of [
        { hue: -1 },
        { hue: 361 },
        { hue: NaN },
        { saturation: 101 },
        { saturation: -1 },
        { brightness: Infinity },
        { brightness: -1 },
        { brightness: 101 },
        { kelvin: 1499 },
        { kelvin: 9001 },
        { kelvin: 3500.5 },
      ])
        assert.instanceOf(yield* Effect.flip(colorPayload({ ...color, ...patch }, 0)), LIFXFailure);
      yield* colorPayload({ hue: 0.5, saturation: 0.5, brightness: 0.5, kelvin: 2500 }, 0);
    }),
  );
  it.effect(
    "converts primary, grayscale, short and mixed-case colors with correct raw precision",
    () =>
      Effect.gen(function* () {
        for (const [hex, hue, saturation, brightness] of [
          ["#f00", 0, 100, 100],
          ["00ff00", 120, 100, 100],
          ["#00F", 240, 100, 100],
          ["#0ff", 180, 100, 100],
          ["#ff0", 60, 100, 100],
          ["#f0f", 300, 100, 100],
          ["#fff", 0, 0, 100],
          ["#000", 0, 0, 0],
          [" #808080 ", 0, 0, 50],
        ] as const) {
          const color = yield* hexToColor(hex);
          assert.deepStrictEqual(
            [color.hue, color.saturation, color.brightness],
            [hue, saturation, brightness],
          );
        }
        assert.strictEqual((yield* hexToColor("808080")).lifxBrightness, 32896);
        for (const hex of [
          "",
          "#12",
          "#1234",
          "#1234567",
          "#ggg",
          "12zz00",
          "#fff!",
          "0xffffff",
          "##fff",
          "ff ff ff",
        ])
          assert.instanceOf(yield* Effect.flip(hexToColor(hex)), LIFXFailure);
        assert.strictEqual(yield* colorToHex(0, 0, 100), "#ffffff");
        assert.strictEqual(yield* colorToHex(0, 100, 50), "#800000");
        assert.strictEqual(yield* colorToHex(360, 100, 100), "#ff0000");
        for (const hue of [0, 60, 120, 180, 240, 300])
          assert.strictEqual((yield* hexToColor(yield* colorToHex(hue, 100, 100))).hue, hue);
      }),
  );
  it.effect("validates and normalizes manual configuration", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        (yield* validateStorage({
          devices: [{ ...device, id: DeviceId.make(device.id.toUpperCase()), name: " Desk " }],
          timeout: 2000,
        })).devices[0]!.id,
        device.id,
      );
      for (const address of [
        "localhost",
        "https://192.168.1.2",
        "192.168.1.2:56700",
        "::1",
        "0.0.0.0",
        "0.1.2.3",
        "224.0.0.1",
        "255.255.255.255",
        "192.168.1.255",
        "256.0.0.1",
        "192.168.01.2",
        "127.0.0.1 ",
        "1.2.3",
        "1.2.3.4.5",
      ])
        assert.instanceOf(
          yield* Effect.flip(validateStorage({ devices: [{ ...device, address }], timeout: 2000 })),
          LIFXFailure,
        );
      for (const id of [
        "d073d5123456",
        "d0:73:d5:12:34",
        "d0:73:d5:12:34:gg",
        "00:00:00:00:00:00",
        "ff:ff:ff:ff:ff:ff",
        "01:00:00:00:00:01",
      ])
        assert.instanceOf(
          yield* Effect.flip(
            validateStorage({ devices: [{ ...device, id: DeviceId.make(id) }], timeout: 2000 }),
          ),
          LIFXFailure,
        );
      for (const port of [0, -1, 65536, 0.5, NaN])
        assert.instanceOf(
          yield* Effect.flip(validateStorage({ devices: [{ ...device, port }], timeout: 2000 })),
          LIFXFailure,
        );
      for (const timeout of [99, 30001, 100.5, NaN])
        assert.instanceOf(
          yield* Effect.flip(validateStorage({ devices: [device], timeout })),
          LIFXFailure,
        );
      for (const name of [" ", "a".repeat(129)])
        assert.instanceOf(
          yield* Effect.flip(validateStorage({ devices: [{ ...device, name }], timeout: 2000 })),
          LIFXFailure,
        );
      assert.instanceOf(
        yield* Effect.flip(
          validateStorage({
            devices: [device, { ...device, id: DeviceId.make(device.id.toUpperCase()) }],
            timeout: 2000,
          }),
        ),
        LIFXFailure,
      );
      assert.instanceOf(
        yield* Effect.flip(
          validateStorage({ devices: Array.from({ length: 129 }, () => device), timeout: 2000 }),
        ),
        LIFXFailure,
      );
      assert.deepStrictEqual(yield* validateStorage({ devices: [], timeout: 100 }), {
        devices: [],
        timeout: 100,
      });
      yield* validateStorage({
        devices: [{ ...device, address: "127.0.0.1", port: 65535 }],
        timeout: 30000,
      });
    }),
  );
});
