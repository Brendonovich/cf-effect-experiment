import { assert, describe, it, vi } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { SignConfig, TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

import { ClientFactory, clientLayer } from "../src/Transport.ts";

describe("TikTok real transport adapter", () => {
  it.effect(
    "uses private Euler instances, native events and disposes without changing global signing config",
    () =>
      Effect.gen(function* () {
        const instances: TikTokLiveConnection[] = [];
        const originalKey = SignConfig.apiKey;
        const originalCache = SignConfig.cachedInstance;
        const connect = vi
          .spyOn(TikTokLiveConnection.prototype, "connect")
          .mockImplementation(function (this: TikTokLiveConnection) {
            instances.push(this);
            return Promise.resolve(this.state);
          });
        const disconnect = vi
          .spyOn(TikTokLiveConnection.prototype, "disconnect")
          .mockResolvedValue();
        try {
          const context = yield* Layer.build(clientLayer);
          const factory = Context.get(context, ClientFactory);
          const first = factory.create({
            mode: "connector",
            username: "first",
            apiKey: "private-first",
          });
          const second = factory.create({
            mode: "connector",
            username: "second",
            apiKey: "private-second",
          });
          const community = factory.create({
            mode: "connector",
            username: "community",
            apiKey: "",
          });
          yield* Effect.promise(() =>
            Promise.all([first.connect(), second.connect(), community.connect()]),
          );
          assert.notStrictEqual(instances[0]!.apiClient, instances[1]!.apiClient);
          assert.strictEqual(
            instances[0]!.apiClient.configuration.baseOptions.headers["X-Api-Key"],
            "private-first",
          );
          assert.strictEqual(
            instances[1]!.apiClient.configuration.baseOptions.headers["X-Api-Key"],
            "private-second",
          );
          assert.isUndefined(
            instances[2]!.apiClient.configuration.baseOptions.headers["X-Api-Key"],
          );
          assert.strictEqual(SignConfig.apiKey, originalKey);
          assert.strictEqual(SignConfig.cachedInstance, originalCache);
          const managed = factory.create({ mode: "managed", username: "managed", apiKey: "" });
          const managedError = vi.fn();
          managed.on("error", managedError);
          yield* Effect.promise(() => managed.connect());
          assert.deepStrictEqual(managedError.mock.calls, [[{ reason: "authentication-failed" }]]);
          assert.strictEqual(instances.length, 3);
          assert.isFalse(instances[0]!.options.processInitialData);
          assert.isFalse(instances[0]!.options.enableExtendedGiftInfo);
          assert.isFalse(instances[0]!.options.authenticateWs);
          const listener = vi.fn();
          first.on("chat", listener);
          assert.strictEqual(instances[0]!.listeners(WebcastEvent.CHAT)[0], listener);
          first.off("chat", listener);
          assert.strictEqual(instances[0]!.listenerCount(WebcastEvent.CHAT), 0);
          yield* Effect.promise(() => first.disconnect());
          assert.isTrue(instances[0]!.apiClient.configuration.baseOptions.signal.aborted);
          assert.isFalse(instances[1]!.apiClient.configuration.baseOptions.signal.aborted);
          assert.strictEqual(disconnect.mock.calls.length, 1);
        } finally {
          connect.mockRestore();
          disconnect.mockRestore();
        }
      }),
  );
});
