import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { MidiFailure } from "../src/Definition.ts";
import { encode, type Message, parse, validateRaw } from "../src/Protocol.ts";
import { uniqueNames } from "../src/Transport.ts";

describe("MIDI protocol", () => {
  it.effect("round-trips every channel message with 1-based channels", () =>
    Effect.gen(function* () {
      const messages: Array<[Message, number[]]> = [
        [{ type: "noteOn", channel: 1, note: 60, velocity: 127 }, [0x90, 60, 127]],
        [{ type: "noteOff", channel: 16, note: 0, velocity: 64 }, [0x8f, 0, 64]],
        [{ type: "polyphonicAftertouch", channel: 2, note: 11, pressure: 5 }, [0xa1, 11, 5]],
        [{ type: "controlChange", channel: 3, control: 7, value: 100 }, [0xb2, 7, 100]],
        [{ type: "programChange", channel: 4, program: 9 }, [0xc3, 9]],
        [{ type: "channelAftertouch", channel: 5, pressure: 33 }, [0xd4, 33]],
        [{ type: "pitchBend", channel: 1, value: 0 }, [0xe0, 0x00, 0x40]],
        [{ type: "pitchBend", channel: 1, value: -8192 }, [0xe0, 0x00, 0x00]],
        [{ type: "pitchBend", channel: 1, value: 8191 }, [0xe0, 0x7f, 0x7f]],
        [{ type: "sysex", data: [0x00, 0x20, 0x29] }, [0xf0, 0x00, 0x20, 0x29, 0xf7]],
      ];
      for (const [message, bytes] of messages) {
        assert.deepStrictEqual(yield* encode(message), bytes);
        assert.deepStrictEqual(parse(bytes), message);
      }
    }),
  );

  it("reports Note On with velocity 0 as Note Off", () => {
    assert.deepStrictEqual(parse([0x92, 36, 0]), {
      type: "noteOff",
      channel: 3,
      note: 36,
      velocity: 0,
    });
  });

  it("ignores malformed, truncated and system messages", () => {
    for (const bytes of [
      [],
      [0x40, 1, 2],
      [0x90, 60],
      [0x90, 60, 128],
      [0xc0],
      [0xc0, 1, 2],
      [0xf0, 0x01],
      [0xf0, 0x80, 0xf7],
      [0xf8],
    ])
      assert.isUndefined(parse(bytes), JSON.stringify(bytes));
  });

  it.effect("rejects out-of-range values with tagged reasons", () =>
    Effect.gen(function* () {
      for (const [message, reason] of [
        [
          { type: "noteOn", channel: 0, note: 60, velocity: 1 },
          "Channel must be an integer between 1 and 16",
        ],
        [
          { type: "noteOn", channel: 1, note: 128, velocity: 1 },
          "Note must be an integer between 0 and 127",
        ],
        [
          { type: "controlChange", channel: 1, control: 1, value: 1.5 },
          "Value must be an integer between 0 and 127",
        ],
        [
          { type: "pitchBend", channel: 1, value: 8192 },
          "Bend must be an integer between -8192 and 8191",
        ],
        [
          { type: "sysex", data: [0xf0, 1] },
          "SysEx bytes must be integers between 0 and 127; omit the F0/F7 framing bytes",
        ],
      ] as Array<[Message, string]>) {
        const error = yield* Effect.flip(encode(message));
        assert.instanceOf(error, MidiFailure);
        assert.strictEqual(error.reason, reason);
      }
      for (const bytes of [[], [0x10], [0x90, 256], [0x90, -1]])
        assert.instanceOf(yield* Effect.flip(validateRaw(bytes)), MidiFailure);
      assert.deepStrictEqual(yield* validateRaw([0xf8]), [0xf8]);
    }),
  );

  it("disambiguates duplicate port names", () => {
    assert.deepStrictEqual(uniqueNames(["Launchpad", "IAC", "Launchpad", "Launchpad"]), [
      "Launchpad",
      "IAC",
      "Launchpad #2",
      "Launchpad #3",
    ]);
  });
});
