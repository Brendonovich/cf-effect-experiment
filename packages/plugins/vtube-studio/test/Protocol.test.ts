import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { Socket } from "effect/unstable/socket";
import { vi } from "vitest";

import * as Protocol from "../src/Protocol.ts";

vi.mock("effect/unstable/socket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("effect/unstable/socket")>();
  return {
    ...actual,
    Socket: { ...actual.Socket, makeWebSocket: vi.fn(actual.Socket.makeWebSocket) },
  };
});

describe("VTube Studio transport boundaries", () => {
  it.effect("validates local URLs with typed failures and canonicalizes localhost", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* Protocol.validateUrl("ws://localhost:8001/"),
        "ws://127.0.0.1:8001/",
      );
      assert.strictEqual(yield* Protocol.validateUrl("wss://[::1]/"), "wss://[::1]/");
      for (const address of [
        "not a URL",
        "http://localhost/",
        "ws://example.com/",
        "ws://user:secret@localhost/",
        "ws://localhost/?secret",
        "ws://localhost/#secret",
        `ws://localhost/${"x".repeat(2048)}`,
      ]) {
        const error = yield* Effect.flip(Protocol.validateUrl(address));
        assert.strictEqual(error._tag, "VTubeStudioConnectionFailed");
        assert.notInclude(JSON.stringify(error), "secret");
      }
    }),
  );

  it.effect("shutdown interrupts a blocked writer without waiting for the request timeout", () =>
    Effect.gen(function* () {
      const shutdown = yield* Deferred.make<void>();
      const writing = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      const socket = Socket.make({
        runRaw: (_handler, options) =>
          (options?.onOpen ?? Effect.void).pipe(Effect.andThen(Deferred.await(shutdown))),
        writer: Effect.succeed(() =>
          Deferred.succeed(writing, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(Deferred.succeed(stopped, undefined)),
          ),
        ),
      });
      const spy = vi.spyOn(Socket, "makeWebSocket").mockReturnValue(Effect.succeed(socket));
      yield* Effect.gen(function* () {
        const client = yield* Protocol.make("ws://127.0.0.1:8001/");
        const request = yield* client.call("AvailableModels", {}).pipe(Effect.forkChild);
        yield* Deferred.await(writing);
        yield* Deferred.succeed(shutdown, undefined);
        assert.strictEqual(
          (yield* Effect.flip(Fiber.join(request)))._tag,
          "VTubeStudioConnectionFailed",
        );
        assert.isTrue(yield* Deferred.isDone(stopped));
      }).pipe(
        Effect.scoped,
        Effect.provideService(Socket.WebSocketConstructor, () => {
          throw new Error("Mock socket must be used");
        }),
        Effect.ensuring(Effect.sync(() => spy.mockRestore())),
      );
    }),
  );

  it.effect("sanitizes writer defects as typed connection failures", () =>
    Effect.gen(function* () {
      const socket = Socket.make({
        runRaw: (_handler, options) =>
          (options?.onOpen ?? Effect.void).pipe(Effect.andThen(Effect.never)),
        writer: Effect.succeed(() => {
          throw new Error("secret-token");
        }),
      });
      const spy = vi.spyOn(Socket, "makeWebSocket").mockReturnValue(Effect.succeed(socket));
      yield* Effect.gen(function* () {
        const client = yield* Protocol.make("ws://127.0.0.1:8001/");
        const error = yield* Effect.flip(client.call("AvailableModels", {}));
        assert.strictEqual(error._tag, "VTubeStudioConnectionFailed");
        assert.notInclude(JSON.stringify(error), "secret-token");
      }).pipe(
        Effect.scoped,
        Effect.provideService(Socket.WebSocketConstructor, () => {
          throw new Error("Mock socket must be used");
        }),
        Effect.ensuring(Effect.sync(() => spy.mockRestore())),
      );
    }),
  );
});
