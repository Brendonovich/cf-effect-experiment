import { assert, it } from "@effect/vitest";
import { Effect, Exit, Option } from "effect";
import { HttpServerResponse } from "effect/unstable/http";

import { PluginHost } from "../src/PluginHost.ts";

it.effect("registers plugin RPC apps and rejects collisions", () =>
  Effect.gen(function* () {
    const host = yield* PluginHost.Service;
    const first = Effect.succeed(HttpServerResponse.text("first"));
    const second = Effect.succeed(HttpServerResponse.text("second"));

    yield* host.register("test", first);
    assert.strictEqual(Option.getOrThrow(yield* host.get("test")), first);

    const duplicate = yield* Effect.exit(host.register("test", second));
    assert.isTrue(Exit.isFailure(duplicate));
    assert.strictEqual(Option.getOrThrow(yield* host.get("test")), first);
  }).pipe(Effect.provide(PluginHost.layer)),
);
