import { Effect } from "effect";

import { MidiFailure } from "./Definition.ts";

export const MAX_MESSAGE_BYTES = 65536;

const Status = {
  noteOff: 0x8,
  noteOn: 0x9,
  polyphonicAftertouch: 0xa,
  controlChange: 0xb,
  programChange: 0xc,
  channelAftertouch: 0xd,
  pitchBend: 0xe,
} as const;

/** Channels are exposed as 1-16, matching device manuals and DAWs. */
export type Message =
  | {
      readonly type: "noteOn";
      readonly channel: number;
      readonly note: number;
      readonly velocity: number;
    }
  | {
      readonly type: "noteOff";
      readonly channel: number;
      readonly note: number;
      readonly velocity: number;
    }
  | {
      readonly type: "polyphonicAftertouch";
      readonly channel: number;
      readonly note: number;
      readonly pressure: number;
    }
  | {
      readonly type: "controlChange";
      readonly channel: number;
      readonly control: number;
      readonly value: number;
    }
  | { readonly type: "programChange"; readonly channel: number; readonly program: number }
  | { readonly type: "channelAftertouch"; readonly channel: number; readonly pressure: number }
  /** Signed bend, -8192 to 8191 with 0 at center. */
  | { readonly type: "pitchBend"; readonly channel: number; readonly value: number }
  /** Payload between the F0 and F7 framing bytes. */
  | { readonly type: "sysex"; readonly data: ReadonlyArray<number> };

export type MessageOf<Type extends Message["type"]> = Extract<Message, { readonly type: Type }>;

const isData = (byte: number | undefined): byte is number =>
  byte !== undefined && Number.isInteger(byte) && byte >= 0 && byte <= 0x7f;

export const parse = (data: ReadonlyArray<number>): Message | undefined => {
  const [status, first, second] = data;
  if (status === undefined) return undefined;
  if (status === 0xf0) {
    if (data.length < 2 || data[data.length - 1] !== 0xf7) return undefined;
    const payload = data.slice(1, -1);
    return payload.every(isData) ? { type: "sysex", data: payload } : undefined;
  }
  if (status < 0x80 || status >= 0xf0) return undefined;
  const kind = status >> 4;
  const channel = (status & 0x0f) + 1;
  if (kind === Status.programChange || kind === Status.channelAftertouch) {
    if (data.length !== 2 || !isData(first)) return undefined;
    return kind === Status.programChange
      ? { type: "programChange", channel, program: first }
      : { type: "channelAftertouch", channel, pressure: first };
  }
  if (data.length !== 3 || !isData(first) || !isData(second)) return undefined;
  switch (kind) {
    case Status.noteOn:
      // Note On with velocity 0 is the standard running-status form of Note Off.
      return second === 0
        ? { type: "noteOff", channel, note: first, velocity: 0 }
        : { type: "noteOn", channel, note: first, velocity: second };
    case Status.noteOff:
      return { type: "noteOff", channel, note: first, velocity: second };
    case Status.polyphonicAftertouch:
      return { type: "polyphonicAftertouch", channel, note: first, pressure: second };
    case Status.controlChange:
      return { type: "controlChange", channel, control: first, value: second };
    case Status.pitchBend:
      return { type: "pitchBend", channel, value: ((second << 7) | first) - 8192 };
    default:
      return undefined;
  }
};

const integer = Effect.fnUntraced(function* (
  value: number,
  min: number,
  max: number,
  label: string,
) {
  if (!Number.isInteger(value) || value < min || value > max)
    return yield* new MidiFailure({
      reason: `${label} must be an integer between ${min} and ${max}`,
    });
  return value;
});
const data7 = (value: number, label: string) => integer(value, 0, 127, label);
const statusByte = (kind: number, channel: number) =>
  integer(channel, 1, 16, "Channel").pipe(Effect.map((channel) => (kind << 4) | (channel - 1)));

export const encode = Effect.fnUntraced(function* (message: Message) {
  switch (message.type) {
    case "noteOn":
    case "noteOff":
      return [
        yield* statusByte(
          message.type === "noteOn" ? Status.noteOn : Status.noteOff,
          message.channel,
        ),
        yield* data7(message.note, "Note"),
        yield* data7(message.velocity, "Velocity"),
      ];
    case "polyphonicAftertouch":
      return [
        yield* statusByte(Status.polyphonicAftertouch, message.channel),
        yield* data7(message.note, "Note"),
        yield* data7(message.pressure, "Pressure"),
      ];
    case "controlChange":
      return [
        yield* statusByte(Status.controlChange, message.channel),
        yield* data7(message.control, "Control"),
        yield* data7(message.value, "Value"),
      ];
    case "programChange":
      return [
        yield* statusByte(Status.programChange, message.channel),
        yield* data7(message.program, "Program"),
      ];
    case "channelAftertouch":
      return [
        yield* statusByte(Status.channelAftertouch, message.channel),
        yield* data7(message.pressure, "Pressure"),
      ];
    case "pitchBend": {
      const value = (yield* integer(message.value, -8192, 8191, "Bend")) + 8192;
      return [yield* statusByte(Status.pitchBend, message.channel), value & 0x7f, value >> 7];
    }
    case "sysex": {
      if (message.data.length > MAX_MESSAGE_BYTES - 2)
        return yield* new MidiFailure({
          reason: `SysEx payload exceeds ${MAX_MESSAGE_BYTES - 2} bytes`,
        });
      if (!message.data.every(isData))
        return yield* new MidiFailure({
          reason: "SysEx bytes must be integers between 0 and 127; omit the F0/F7 framing bytes",
        });
      return [0xf0, ...message.data, 0xf7];
    }
  }
});

/** Validates a complete raw message: a status byte followed by bytes in 0-255. */
export const validateRaw = Effect.fnUntraced(function* (data: ReadonlyArray<number>) {
  if (data.length === 0 || data.length > MAX_MESSAGE_BYTES)
    return yield* new MidiFailure({
      reason: `A MIDI message must contain 1 to ${MAX_MESSAGE_BYTES} bytes`,
    });
  if (!data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xff))
    return yield* new MidiFailure({ reason: "MIDI bytes must be integers between 0 and 255" });
  if (data[0]! < 0x80)
    return yield* new MidiFailure({
      reason: "A MIDI message must start with a status byte (128-255)",
    });
  return data;
});
