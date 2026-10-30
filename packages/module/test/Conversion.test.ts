import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as Conversion from "../src/Conversion.ts";
import * as t from "../src/DataType.ts";

const run = (effect: Effect.Effect<unknown, unknown>) => Effect.runSync(effect);
const User = t.defineStruct("chat/User", "User", { name: t.String });
const Scene = t.defineStruct("obs/Scene", "Scene", { name: t.String });
const userToString = Conversion.make({
  from: t.Struct(User),
  to: t.String,
  convert: (user) => Effect.succeed(String(user.name)),
});

describe("core default conversions", () => {
  const registry = Conversion.registry(Conversion.defaults);

  it("provides the default directional scalar conversions", () => {
    expect(run(registry.find(t.Int, t.Float)!.convert(3))).toBe(3);
    expect(run(registry.find(t.Int, t.String)!.convert(3))).toBe("3");
    expect(run(registry.find(t.Float, t.String)!.convert(1.5))).toBe("1.5");
    expect(run(registry.find(t.Bool, t.String)!.convert(true))).toBe("true");
    expect(registry.find(t.Float, t.Int)).toBeUndefined();
    expect(registry.find(t.String, t.Int)).toBeUndefined();
  });

  it("does not chain conversions", () => {
    expect(Conversion.defaultRules.has(t.Int, t.Bool)).toBe(false);
  });

  it("lifts List and Option conversions from scalar rules", () => {
    expect(run(registry.find(t.List(t.Int), t.List(t.Float))!.convert([1, 2]))).toEqual([1, 2]);
    expect(
      run(Effect.flip(registry.find(t.List(t.Int), t.List(t.Float))!.convert("x"))),
    ).toBeInstanceOf(TypeError);
    const options = registry.find(t.Option(t.Int), t.Option(t.String))!;
    expect(run(options.convert(Option.some(7)))).toEqual(Option.some("7"));
    expect(run(options.convert(Option.none()))).toEqual(Option.none());
    expect(Conversion.defaultRules.has(t.List(t.Int), t.Option(t.Float))).toBe(false);
  });

  it("keeps same-type matching unchanged", () => {
    expect(Conversion.connectable(t.Int, t.Int, Conversion.rules([]))).toBe(true);
    expect(Conversion.connectable(t.Int, t.Float, Conversion.rules([]))).toBe(false);
    expect(Conversion.connectable(t.Int, t.Float, Conversion.defaultRules)).toBe(true);
    expect(Conversion.connectable(t.Wildcard("T"), t.Float, Conversion.rules([]))).toBe(true);
  });
});

describe("module conversions", () => {
  it("distinguishes nominal types by ID", () => {
    const rules = Conversion.rules([userToString]);
    expect(rules.has(t.Struct(User), t.String)).toBe(true);
    expect(rules.has(t.Struct(Scene), t.String)).toBe(false);
    expect(rules.has(t.List(t.Struct(User)), t.List(t.String))).toBe(true);
  });

  it("requires namespaced type IDs", () => {
    expect(Conversion.validateModule("chat", { [User.id]: User }, [])).toBeUndefined();
    expect(Conversion.validateModule("obs", { [User.id]: User }, [])).toContain(
      "outside its namespace obs/",
    );
    expect(Conversion.validateModule("chat", { "chat/": User }, [])).toContain("namespace");
  });

  it("requires the module to declare at least one endpoint", () => {
    const types = { [User.id]: User };
    expect(Conversion.validateModule("chat", types, [userToString])).toBeUndefined();
    expect(
      Conversion.validateModule("chat", types, [{ from: t.String, to: t.Struct(User) }]),
    ).toBeUndefined();
    expect(Conversion.validateModule("chat", types, [{ from: t.Int, to: t.Bool }])).toContain(
      "without declaring either type",
    );
    expect(
      Conversion.validateModule("chat", types, [{ from: t.Struct(Scene), to: t.String }]),
    ).toContain("without declaring either type");
    expect(
      Conversion.validateModule("chat", types, [{ from: t.List(t.Struct(User)), to: t.String }]),
    ).toContain("unsupported type");
  });

  it("detects a pair registered more than once", () => {
    expect(
      Conversion.duplicate([
        { owner: "core", pairs: Conversion.defaults },
        { owner: "chat", pairs: [userToString] },
      ]),
    ).toBeUndefined();
    expect(
      Conversion.duplicate([
        { owner: "chat", pairs: [userToString] },
        { owner: "other", pairs: [{ from: t.Struct(User), to: t.String }] },
      ]),
    ).toBe("Conversion chat/User -> String is registered by both chat and other");
  });
});
