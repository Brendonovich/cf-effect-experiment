import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { IkeaFailure, LightId } from "../src/Definition.ts";
import {
  command,
  parseIds,
  parseLight,
  validateConfig,
  validateHost,
  validateSecret,
} from "../src/Protocol.ts";
import { bulb, plug } from "./fixtures.ts";

const rejected = Effect.fnUntraced(function* (
  effect: Effect.Effect<unknown, IkeaFailure>,
  reason?: string,
) {
  const error = yield* Effect.flip(effect);
  assert.instanceOf(error, IkeaFailure);
  if (reason) assert.strictEqual(error.reason, reason);
});

describe("TRADFRI wire validation", () => {
  it.effect("accepts explicitly trusted LAN hosts and rejects URL/address injection", () =>
    Effect.gen(function* () {
      for (const host of ["192.168.1.20", "gateway.local", "localhost", "gateway-01"])
        assert.strictEqual(yield* validateHost(host), host);
      for (const host of [
        "",
        "http://gateway",
        "user:secret@gateway",
        " gateway",
        "gateway\n",
        "gateway:5684",
        "gateway/path",
        "gateway?",
        "gateway#",
        "[::1]",
        "1.2.3",
        "256.1.1.1",
        "01.2.3.4",
        "-gateway",
        "x".repeat(254),
      ])
        yield* rejected(
          validateHost(host),
          "Gateway host must be a plain IPv4 address or DNS hostname.",
        );
      for (const timeoutMs of [999, 30001, NaN, Infinity, 1000.5])
        yield* rejected(
          validateConfig({ host: "gateway", timeoutMs }),
          "Timeout (milliseconds) must be an integer from 1000 to 30000.",
        );
      for (const secret of ["", "secret\n", " ", "x".repeat(129)])
        yield* rejected(validateSecret(secret), "Invalid gateway credential format.");
      assert.strictEqual(yield* validateSecret("x".repeat(128)), "x".repeat(128));
      for (const timeoutMs of [1000, 30000])
        assert.deepStrictEqual(yield* validateConfig({ host: "gateway", timeoutMs }), {
          host: "gateway",
          timeoutMs,
        });
    }),
  );
  it.effect(
    "preserves optional capabilities, filters non-lights and verifies ID/state fields",
    () =>
      Effect.gen(function* () {
        const id = LightId.make(1);
        const wire = {
          "9003": 1,
          "9001": "Light",
          "9019": 0,
          "5750": 2,
          "3311": [{ "5850": 0, "5851": 0 }],
        };
        assert.deepStrictEqual(yield* parseLight(id, wire), {
          id,
          name: "Light",
          reachable: false,
          on: false,
          brightness: 0,
        });
        assert.isUndefined(yield* parseLight(id, { "9001": "Remote", "9019": 1, "5750": 0 }));
        assert.isUndefined(
          (yield* parseLight(id, { ...wire, "3311": [{ "5850": 0, "5851": 0, "5711": 0 }] }))!
            .colorTemp,
        );
        for (const patch of [
          { "9003": 2 },
          { "9019": 2 },
          { "3311": [] },
          { "3311": [{ "5850": 1 }] },
          { "3311": [{ "5850": 1, "5851": 1, "5706": "secret" }] },
        ])
          yield* rejected(
            parseLight(id, { ...wire, ...patch }),
            "Gateway returned an invalid device state.",
          );
        assert.deepStrictEqual(yield* parseIds([0, 65537, 65538, 4294967295]), [
          LightId.make(0),
          LightId.make(65537),
          LightId.make(65538),
          LightId.make(4294967295),
        ]);
        yield* rejected(command({ brightness: 1.5 }));
        for (const ids of [
          [1, 1],
          [4294967296],
          [-1],
          [65537.5],
          [NaN],
          [Infinity],
          "bad",
          Array.from({ length: 257 }, (_, i) => i),
        ])
          yield* rejected(
            parseIds(ids),
            "Gateway returned an invalid device list (maximum 256 devices).",
          );
        assert.lengthOf(yield* parseIds(Array.from({ length: 256 }, (_, i) => i)), 256);
      }),
  );
  it.effect("parses recorded bulb IDs above 16 bits and skips type 3 plugs using 3312", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* parseLight(LightId.make(65537), bulb), {
        id: LightId.make(65537),
        name: bulb["9001"],
        reachable: true,
        on: true,
        brightness: 135,
        colorTemp: 4000,
        hexColor: "f5faf6",
      });
      assert.isUndefined(yield* parseLight(LightId.make(65538), plug));
      yield* rejected(parseLight(LightId.make(65538), { ...plug, "5750": 2 }));
      for (const id of [-1, 4294967296])
        yield* rejected(
          parseLight(LightId.make(id), { ...bulb, "9003": id }),
          "Gateway returned an invalid device state.",
        );
      assert.throws(() => LightId.make(65537.5));
    }),
  );
  it.effect(
    "rounds temperature to mireds, normalizes hex and rejects rather than silently clamping",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* command({ colorTemp: 2200 }), { "3311": [{ "5711": 455 }] });
        assert.deepStrictEqual(yield* command({ colorTemp: 4000 }), { "3311": [{ "5711": 250 }] });
        assert.deepStrictEqual(yield* command({ hexColor: "#AAbBcC" }), {
          "3311": [{ "5706": "aabbcc" }],
        });
        yield* rejected(command({ brightness: 255 }));
        yield* rejected(command({ colorTemp: 2199 }));
        yield* rejected(
          command({ hexColor: "secret" }),
          "Color must be six hexadecimal digits, optionally prefixed with #.",
        );
        yield* rejected(command({}), "At least one state field is required.");
        // @ts-expect-error Exercise the runtime guard for callers bypassing the schema.
        yield* rejected(command({ on: 1 }), "On must be a boolean.");
      }),
  );
});
