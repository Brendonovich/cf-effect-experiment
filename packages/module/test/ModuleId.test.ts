import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";

import { ModuleId } from "../src/index.ts";

describe("ModuleId", () => {
  it("accepts local, official and third-party ids", () => {
    for (const value of [
      "local/alice/my-thing",
      `${ModuleId.OfficialNamespace}/macrograph/twitch`,
      "modules.example.com/bob/lights",
      "a.b/x/y2",
    ])
      assert.isTrue(Option.isSome(ModuleId.parse(value)), value);
  });

  it("rejects malformed ids", () => {
    for (const value of [
      "",
      "twitch",
      "macrograph/twitch",
      "local/alice",
      "local/alice/foo/bar",
      "localhost/alice/foo",
      "Local/alice/foo",
      "local/Alice/foo",
      "local/alice/foo_bar",
      "local/-alice/foo",
      "local/alice/foo-",
      "local//foo",
      "example..com/alice/foo",
      "-example.com/alice/foo",
      "example.com/alice/foo ",
    ])
      assert.isTrue(Option.isNone(ModuleId.parse(value)), value);
  });

  it("formats, makes and splits ids", () => {
    const id = ModuleId.make({ namespace: "local", publisher: "alice", name: "foo" });
    assert.strictEqual(id, "local/alice/foo");
    assert.deepStrictEqual(ModuleId.parts(id), {
      namespace: "local",
      publisher: "alice",
      name: "foo",
    });
    assert.strictEqual(ModuleId.namespace(id), "local");
    assert.strictEqual(ModuleId.publisher(id), "alice");
    assert.strictEqual(ModuleId.name(id), "foo");
    assert.isTrue(ModuleId.isLocal(id));
    assert.isFalse(ModuleId.isOfficial(id));
    assert.strictEqual(ModuleId.format(ModuleId.parts(id)), id);
    assert.strictEqual(ModuleId.routePrefix(id), "/module/local/alice/foo");
    assert.strictEqual(
      ModuleId.withNamespace(id, ModuleId.OfficialNamespace),
      `${ModuleId.OfficialNamespace}/alice/foo`,
    );
    assert.throws(() => ModuleId.make({ namespace: "local", publisher: "Alice", name: "foo" }));
  });

  it("decodes through the schema", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* ModuleId.decode("local/a/b"), "local/a/b");
      assert.isTrue(Exit.isFailure(yield* Effect.exit(ModuleId.decode("nope"))));
      assert.isTrue(ModuleId.is("local/a/b"));
      assert.isFalse(ModuleId.is(42));
    }).pipe(Effect.runSync));

  it("shortens only official ids for display", () => {
    const official = ModuleId.make({
      namespace: ModuleId.OfficialNamespace,
      publisher: "macrograph",
      name: "twitch",
    });
    assert.strictEqual(ModuleId.toDisplay(official), "macrograph/twitch");
    assert.deepStrictEqual(ModuleId.parseDisplay("macrograph/twitch"), Option.some(official));
    const local = ModuleId.make({ namespace: "local", publisher: "alice", name: "foo" });
    assert.strictEqual(ModuleId.toDisplay(local), "local/alice/foo");
    assert.deepStrictEqual(ModuleId.parseDisplay("local/alice/foo"), Option.some(local));
  });

  it("reserves the local namespace and the macrograph publisher", () => {
    assert.isTrue(ModuleId.isNamespace("local"));
    assert.isFalse(ModuleId.isRegistryNamespace("local"));
    assert.isTrue(ModuleId.isRegistryNamespace("modules.example.com"));
    assert.isFalse(ModuleId.isRegistryNamespace("example"));
    assert.isTrue(ModuleId.isReservedPublisher("macrograph"));
    assert.isFalse(ModuleId.isReservedPublisher("alice"));
  });
});
