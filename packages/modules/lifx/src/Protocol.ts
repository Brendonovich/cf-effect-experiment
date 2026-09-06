import { Effect } from "effect";
import { Buffer } from "node:buffer";

import { colorToHex, toRaw, validateColor } from "./Color.ts";
import { LIFXFailure, type Color } from "./Definition.ts";
import { failure, range } from "./Validation.ts";

export const MessageType = { Get: 101, SetColor: 102, State: 107, SetPower: 117, Ack: 45 } as const;

export function encode(
  type: number,
  target: string,
  source: number,
  sequence: number,
  payload: Buffer,
  ack: boolean,
) {
  const packet = Buffer.alloc(36 + payload.length);
  packet.writeUInt16LE(packet.length, 0);
  packet.writeUInt16LE(0x1400, 2); // protocol 1024, addressable, untagged unicast
  packet.writeUInt32LE(source, 4);
  Buffer.from(target.replaceAll(":", ""), "hex").copy(packet, 8);
  packet[22] = ack ? 2 : 1;
  packet[23] = sequence;
  packet.writeUInt16LE(type, 32);
  payload.copy(packet, 36);
  return packet;
}

export function decode(packet: Buffer) {
  if (
    packet.length < 36 ||
    packet.readUInt16LE(0) !== packet.length ||
    packet.readUInt16LE(2) !== 0x1400 ||
    packet.readUInt16LE(14) !== 0
  )
    return undefined;
  return {
    type: packet.readUInt16LE(32),
    source: packet.readUInt32LE(4),
    sequence: packet[23]!,
    target: [...packet.subarray(8, 14)].map((byte) => byte.toString(16).padStart(2, "0")).join(":"),
    payload: packet.subarray(36),
  };
}

export const parseState = Effect.fnUntraced(function* (payload: Buffer) {
  if (payload.length !== 52)
    return yield* new LIFXFailure({ reason: "Invalid LIFX LightState payload length" });
  const state = yield* Effect.try({
    try: () => {
      const labelBytes = payload.subarray(12, 44);
      const end = labelBytes.indexOf(0);
      return {
        hue: (payload.readUInt16LE(0) / 65535) * 360,
        saturation: (payload.readUInt16LE(2) / 65535) * 100,
        brightness: (payload.readUInt16LE(4) / 65535) * 100,
        kelvin: payload.readUInt16LE(6),
        power: payload.readUInt16LE(10) !== 0,
        label: labelBytes.subarray(0, end < 0 ? 32 : end).toString("utf8"),
      };
    },
    catch: failure,
  });
  yield* range("Reported kelvin", state.kelvin, 1500, 9000, true);
  return {
    ...state,
    hex: yield* colorToHex(state.hue, state.saturation, state.brightness),
  };
});

export const powerPayload = Effect.fnUntraced(function* (power: boolean, duration: number) {
  if (typeof power !== "boolean")
    return yield* new LIFXFailure({ reason: "Power must be a boolean" });
  yield* range("Duration (ms)", duration, 0, 0xffffffff, true);
  return yield* Effect.try({
    try: () => {
      const payload = Buffer.alloc(6);
      payload.writeUInt16LE(power ? 65535 : 0, 0);
      payload.writeUInt32LE(duration, 2);
      return payload;
    },
    catch: failure,
  });
});

export const colorPayload = Effect.fnUntraced(function* (color: Color, duration: number) {
  yield* validateColor(color);
  yield* range("Duration (ms)", duration, 0, 0xffffffff, true);
  return yield* Effect.try({
    try: () => {
      const payload = Buffer.alloc(13);
      payload.writeUInt16LE(toRaw(color.hue, 360), 1);
      payload.writeUInt16LE(toRaw(color.saturation, 100), 3);
      payload.writeUInt16LE(toRaw(color.brightness, 100), 5);
      payload.writeUInt16LE(color.kelvin, 7);
      payload.writeUInt32LE(duration, 9);
      return payload;
    },
    catch: failure,
  });
});
