import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as Conversion from "../src/Conversion.ts";
import * as t from "../src/DataType.ts";

const intToFloat = Conversion.make({
  from: t.Int,
  to: t.Float,
  convert: (value) => Effect.succeed(value),
});
const intToString = Conversion.make({
  from: t.Int,
  to: t.String,
  convert: (value) => Effect.succeed(String(value)),
});
const registry = Conversion.registry([intToFloat, intToString]);
const run = (effect: Effect.Effect<unknown, unknown>) => Effect.runSync(effect);

describe("conversion registry", () => {
  it("finds only registered directional scalar pairs", () => {
    expect(registry.find(t.Int, t.Float)).toBeDefined();
    expect(registry.find(t.Int, t.String)).toBeDefined();
    expect(registry.find(t.Float, t.Int)).toBeUndefined();
    expect(registry.find(t.String, t.Int)).toBeUndefined();
    expect(registry.find(t.Bool, t.String)).toBeUndefined();
  });

  it("uses an identity conversion for equal types", () => {
    expect(run(Conversion.empty.find(t.Int, t.Int)!.convert(3))).toBe(3);
    expect(Conversion.empty.find(t.Int, t.Float)).toBeUndefined();
  });

  it("rejects duplicate scalar pairs", () => {
    expect(() => Conversion.registry([intToFloat, intToFloat])).toThrow("Duplicate conversion");
  });

  it("does not chain conversions", () => {
    const floatToString = Conversion.make({
      from: t.Float,
      to: t.String,
      convert: (value) => Effect.succeed(String(value)),
    });
    expect(Conversion.registry([intToFloat, floatToString]).find(t.Int, t.String)).toBeUndefined();
  });

  it("lifts List and Option conversions from scalar rules", () => {
    const lists = registry.find(t.List(t.Int), t.List(t.Float));
    expect(lists).toBeDefined();
    expect(run(lists!.convert([1, 2]))).toEqual([1, 2]);
    expect(run(Effect.flip(lists!.convert("not a list")))).toBeInstanceOf(TypeError);
    const options = registry.find(t.Option(t.Int), t.Option(t.String));
    expect(run(options!.convert(Option.some(7)))).toEqual(Option.some("7"));
    expect(run(options!.convert(Option.none()))).toEqual(Option.none());
    expect(registry.find(t.List(t.Int), t.List(t.Bool))).toBeUndefined();
    expect(registry.find(t.List(t.Int), t.Option(t.Float))).toBeUndefined();
  });

  it("keeps same-type matching unchanged and adds only registered conversions", () => {
    expect(Conversion.connectable(t.Int, t.Int, Conversion.empty)).toBe(true);
    expect(Conversion.connectable(t.Int, t.Float, Conversion.empty)).toBe(false);
    expect(Conversion.connectable(t.Int, t.Float, registry)).toBe(true);
    expect(Conversion.connectable(t.Float, t.Int, registry)).toBe(false);
    expect(Conversion.connectable(t.Wildcard("T"), t.Float, Conversion.empty)).toBe(true);
  });
});
