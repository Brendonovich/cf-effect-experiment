import { assert, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import { PluginHost } from "../src/PluginHost.ts";

it.effect("registers and replaces plugin RPC apps dynamically", () =>
  Effect.gen(function* () {
    const host = yield* PluginHost.Service;
    const first = Effect.succeed(HttpServerResponse.text("first"));
    const second = Effect.succeed(HttpServerResponse.text("second"));

    yield* host.register("test", first);
    assert.strictEqual(Option.getOrThrow(yield* host.get("test")), first);

    yield* host.register("test", second);
    assert.strictEqual(Option.getOrThrow(yield* host.get("test")), second);
  }).pipe(Effect.provide(PluginHost.layer)),
);
