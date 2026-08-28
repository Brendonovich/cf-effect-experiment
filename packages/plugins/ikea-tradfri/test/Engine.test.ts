import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Deferred, Effect, Exit, Fiber, Layer, Result, Scope } from "effect";
import { DtlsClient } from "effect-node-dtls";
import { TestClock } from "effect/testing";

import {
  IkeaEngine,
  IkeaLight,
  LightId,
  initialStorage,
  type RuntimeStorage,
  type StatePatch,
} from "../src/Definition.ts";
import { runtimeLayer, Transport } from "../src/Engine.ts";
import { connect, HostResolver, type Client, type ConnectionOptions } from "../src/Native.ts";
import { bulb, plug } from "./fixtures.ts";

const id = LightId.make(65537);
const wire = {
  "9003": id,
  "9001": "Desk",
  "9019": 1,
  "5750": 2,
  "3311": [{ "5850": 1, "5851": 127, "5711": 370, "5706": "aabbcc" }],
};
const config: typeof RuntimeStorage.Type = {
  host: "192.168.1.20",
  timeoutMs: 10000,
  identity: "saved-identity",
  psk: "saved-secret",
  lights: [{ id, name: "Desk" }],
};
const harness = Effect.fnUntraced(function* (
  connect: typeof Transport.Service.connect,
  initial: typeof RuntimeStorage.Type = config,
) {
  let stored = initial;
  let refreshes = 0;
  let events = 0;
  const context = yield* Layer.build(
    runtimeLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Transport)({ connect }),
          Layer.succeed(IkeaEngine.EngineContext)({
            storage: {
              get: Effect.sync(() => stored),
              set: (value) =>
                Effect.sync(() => {
                  stored = value;
                }),
              update: (update) =>
                Effect.sync(() => {
                  stored = update(stored);
                }),
            },
            credentials: {
              get: Effect.succeed([]),
              refresh: () => Effect.die("unused"),
              subscribe: () => Effect.void,
            },
            client: { refresh: Effect.void },
            resource: {
              refresh: () =>
                Effect.sync(() => {
                  refreshes++;
                }),
            },
            emit: () =>
              Effect.sync(() => {
                events++;
              }),
          }),
        ),
      ),
    ),
  );
  const clients = yield* EngineTest.makeClients(IkeaEngine).pipe(Effect.provideContext(context));
  return { ...clients, stored: () => stored, refreshes: () => refreshes, events: () => events };
});
function mock(
  request: Client["request"] = (_method, path) => Effect.succeed(path === "15001" ? [id] : wire),
  closeBarrier: Effect.Effect<void> = Effect.void,
) {
  const connections: ConnectionOptions[] = [];
  const sessions: Client[] = [];
  let closed = 0;
  return {
    connections,
    sessions,
    closed: () => closed,
    connect: Effect.fnUntraced(function* (options: ConnectionOptions) {
      connections.push(options);
      let alive = true;
      const client: Client = {
        get connected() {
          return alive;
        },
        request,
        close: Effect.sync(() => {
          if (alive) {
            alive = false;
            closed++;
          }
        }).pipe(Effect.andThen(closeBarrier)),
      };
      sessions.push(client);
      yield* Effect.addFinalizer(() => client.close);
      return client;
    }),
  };
}
describe("IKEA project engine", () => {
  it.effect("project disposal releases a locked RPC still resolving its gateway host", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void),
        );
        const resolving = yield* Deferred.make<void>();
        const h = yield* harness(
          (options) =>
            connect(options).pipe(
              Effect.provideService(HostResolver, {
                resolve: () =>
                  Deferred.succeed(resolving, undefined).pipe(Effect.andThen(Effect.never)),
              }),
              Effect.provideService(DtlsClient, {
                connect: () => Effect.die("DTLS must not start while DNS is unresolved"),
              }),
            ),
          { ...config, host: "gateway.local" },
        ).pipe(Scope.provide(scope));
        const pending = yield* h.runtime.IkeaListLights().pipe(Effect.forkChild);
        yield* Deferred.await(resolving);
        yield* Scope.close(scope, Exit.void);
        assert.isTrue(Exit.isFailure(yield* Fiber.await(pending)));
      }),
    ),
  );
  it.effect("project disposal waits for a disconnect already closing its child scope", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const scope = yield* Scope.make();
      const t = mock(undefined, Deferred.await(gate));
      const h = yield* harness(t.connect).pipe(Scope.provide(scope));
      yield* h.runtime.IkeaListLights();
      const disconnect = yield* h.client.IkeaDisconnect().pipe(Effect.forkChild);
      while (t.closed() === 0) yield* Effect.yieldNow;
      const disposal = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.isUndefined(disposal.pollUnsafe());
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.await(disconnect);
      yield* Fiber.join(disposal);
      assert.strictEqual(t.closed(), 1);
    }),
  );
  it.effect("enumerates real bulb IDs 65537/65538 and persists both light resources", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const second = { ...bulb, "9003": 65538, "9001": "Second bulb" };
        const calls: string[] = [];
        const transport = mock((_method, path) =>
          Effect.sync(() => {
            calls.push(path);
            return path === "15001" ? [65537, 65538] : path === "15001/65537" ? bulb : second;
          }),
        );
        const h = yield* harness(transport.connect);
        const lights = yield* h.client.IkeaRefreshLights();
        assert.deepStrictEqual(
          lights.map((light) => light.id),
          [LightId.make(65537), LightId.make(65538)],
        );
        assert.deepStrictEqual(calls, ["15001", "15001/65537", "15001/65538"]);
        assert.deepStrictEqual(h.stored().lights, [
          { id: LightId.make(65537), name: bulb["9001"] },
          { id: LightId.make(65538), name: second["9001"] },
        ]);
        assert.deepStrictEqual(yield* IkeaLight.values.pipe(Effect.provide(h.engine.resources)), [
          { id: LightId.make(65537), display: bulb["9001"] },
          { id: LightId.make(65538), display: second["9001"] },
        ]);
      }),
    ),
  );
  it.effect(
    "GETs and PUTs persisted unsigned 32-bit resources without truncation and rejects invalid IDs",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const value of [0, 65537, 4294967295, -1, 4294967296]) {
            const lightId = LightId.make(value);
            const calls: unknown[] = [];
            const transport = mock((method, path, body) =>
              Effect.sync(() => {
                calls.push([method, path, body]);
                return method === "GET" ? { ...bulb, "9003": value } : undefined;
              }),
            );
            const h = yield* harness(transport.connect, {
              ...config,
              lights: [{ id: lightId, name: bulb["9001"] }],
            });
            const get = yield* Effect.result(h.runtime.IkeaGetLightState({ lightId }));
            const put = yield* Effect.result(
              h.runtime.IkeaSetLightState({ lightId, state: { on: false } }),
            );
            if (value < 0 || value > 4294967295) {
              assert.isTrue(Result.isFailure(get));
              assert.isTrue(Result.isFailure(put));
              assert.deepStrictEqual(calls, []);
              assert.strictEqual(transport.connections.length, 0);
            } else {
              assert.isTrue(Result.isSuccess(get));
              assert.isTrue(Result.isSuccess(put));
              if (Result.isSuccess(get)) assert.strictEqual(get.success.id, lightId);
              assert.deepStrictEqual(calls, [
                ["GET", `15001/${value}`, undefined],
                ["PUT", `15001/${value}`, { "3311": [{ "5850": 0 }] }],
              ]);
            }
          }
        }),
      ),
  );
  it.effect(
    "publishes only bulbs in mixed bulb/plug enumeration and preserves metadata on malformed type 2",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let second: unknown = plug;
          const transport = mock((_method, path) =>
            Effect.sync(() =>
              path === "15001" ? [65537, 65538] : path === "15001/65537" ? bulb : second,
            ),
          );
          const h = yield* harness(transport.connect);
          const lights = yield* h.client.IkeaRefreshLights();
          assert.deepStrictEqual(
            lights.map((light) => light.id),
            [LightId.make(65537)],
          );
          assert.deepStrictEqual(h.stored().lights, [
            { id: LightId.make(65537), name: bulb["9001"] },
          ]);
          assert.deepStrictEqual(yield* IkeaLight.values.pipe(Effect.provide(h.engine.resources)), [
            { id: LightId.make(65537), display: bulb["9001"] },
          ]);
          const saved = h.stored();
          second = { ...bulb, "9003": 65538, "3311": [] };
          assert.isTrue(Result.isFailure(yield* Effect.result(h.client.IkeaRefreshLights())));
          assert.deepStrictEqual(h.stored(), saved);
          assert.strictEqual(h.refreshes(), 1);
        }),
      ),
  );
  it.effect("mounts inertly and rejects unconfigured executions without opening a socket", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const transport = mock();
        const h = yield* harness(transport.connect, initialStorage);
        assert.deepStrictEqual(yield* h.engine.client.state, {
          host: "",
          timeoutMs: 10000,
          hasCredentials: false,
          connected: false,
          lights: [],
        });
        assert.isTrue(Result.isFailure(yield* Effect.result(h.runtime.IkeaListLights())));
        assert.deepStrictEqual(transport.connections, []);
        assert.strictEqual(h.events(), 0);
      }),
    ),
  );
  it.effect(
    "pairs with temporary credentials, persists only identity/PSK, refreshes stable resources and closes sessions",
    () =>
      Effect.gen(function* () {
        const calls: unknown[] = [];
        const transport = mock((method, path, body) =>
          Effect.sync(() => {
            calls.push([method, path, body]);
            return path === "15011/9063"
              ? { "9091": "acquired-secret" }
              : path === "15001"
                ? [id]
                : wire;
          }),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const h = yield* harness(transport.connect, initialStorage);
            yield* h.client.IkeaPair({
              host: config.host,
              timeoutMs: 10000,
              securityCode: "printed-secret",
            });
            assert.strictEqual(transport.closed(), 1);
            assert.strictEqual(transport.connections[0]!.identity, "Client_identity");
            assert.strictEqual(transport.connections[0]!.psk, "printed-secret");
            assert.strictEqual(transport.connections[1]!.psk, "acquired-secret");
            assert.strictEqual(h.stored().identity, transport.connections[1]!.identity);
            assert.notInclude(JSON.stringify(h.stored()), "printed-secret");
            assert.deepStrictEqual(calls[0], [
              "POST",
              "15011/9063",
              { "9090": h.stored().identity },
            ]);
            const lights = yield* h.client.IkeaRefreshLights();
            assert.deepStrictEqual(lights, [
              {
                id,
                name: "Desk",
                reachable: true,
                on: true,
                brightness: 127,
                colorTemp: 2703,
                hexColor: "aabbcc",
              },
            ]);
            assert.deepStrictEqual(
              yield* IkeaLight.values.pipe(Effect.provide(h.engine.resources)),
              [{ id, display: "Desk" }],
            );
            const state = JSON.stringify(yield* h.engine.client.state);
            assert.notInclude(state, "secret");
            assert.notInclude(state, h.stored().identity);
            assert.strictEqual(h.events(), 0);
            yield* h.client.IkeaReconnect();
            assert.strictEqual(transport.closed(), 2);
            yield* h.client.IkeaForget();
            assert.deepStrictEqual(h.stored(), initialStorage);
            assert.strictEqual(transport.closed(), 3);
          }),
        );
        assert.strictEqual(transport.closed(), 3);
      }),
  );
  it.effect("uses persisted credentials on demand and isolates project lifecycles", () =>
    Effect.gen(function* () {
      const a = mock();
      const b = mock();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* harness(a.connect);
          yield* Effect.scoped(
            Effect.gen(function* () {
              const second = yield* harness(b.connect);
              yield* first.runtime.IkeaGetLightState({ lightId: id });
              yield* second.runtime.IkeaGetLightState({ lightId: id });
              assert.strictEqual(a.connections[0]!.psk, "saved-secret");
              assert.strictEqual(a.closed(), 0);
            }),
          );
          assert.strictEqual(b.closed(), 1);
          assert.strictEqual(a.closed(), 0);
          yield* first.runtime.IkeaGetLightState({ lightId: id });
          assert.strictEqual(a.connections.length, 1);
        }),
      );
      assert.strictEqual(a.closed(), 1);
    }),
  );
  it.effect("encodes only requested fields and rejects invalid inputs before networking", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls: unknown[] = [];
        const transport = mock((method, path, body) =>
          Effect.sync(() => {
            calls.push([method, path, body]);
          }),
        );
        const h = yield* harness(transport.connect);
        for (const state of [
          {},
          { brightness: -1 },
          { brightness: 255 },
          { colorTemp: 0 },
          { colorTemp: 4001 },
          { hexColor: "bad" },
        ] satisfies StatePatch[]) {
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(h.runtime.IkeaSetLightState({ lightId: id, state })),
            ),
          );
        }
        assert.strictEqual(transport.connections.length, 0);
        yield* h.runtime.IkeaSetLightState({
          lightId: id,
          state: { on: false, brightness: 0, colorTemp: 2700, hexColor: "#ABCDEF" },
        });
        assert.deepStrictEqual(calls, [
          [
            "PUT",
            `15001/${id}`,
            { "3311": [{ "5850": 0, "5851": 0, "5711": 370, "5706": "abcdef" }] },
          ],
        ]);
      }),
    ),
  );
  it.effect(
    "revalidates saved host/credentials, preserves storage on bad pairing and never leaks provider errors",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const bad of [
            { ...config, host: "http://secret@gateway" },
            { ...config, psk: "" },
          ]) {
            const t = mock();
            const h = yield* harness(t.connect, bad);
            assert.isTrue(Result.isFailure(yield* Effect.result(h.runtime.IkeaListLights())));
            assert.strictEqual(t.connections.length, 0);
          }
          const t = mock(() => Effect.die(new Error("printed-secret saved-secret")));
          const h = yield* harness(t.connect);
          const result = yield* Effect.result(
            h.client.IkeaPair({
              host: config.host,
              timeoutMs: 10000,
              securityCode: "printed-secret",
            }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.notInclude(result.failure.reason, "secret");
          assert.deepStrictEqual(h.stored(), config);
          assert.strictEqual(t.closed(), 1);
        }),
      ),
  );
  it.effect(
    "fails refresh atomically on malformed devices, rather than keeping a silently partial list",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const response of [
            "bad",
            [id, id],
            [-1],
            [4294967296],
            [65537.5],
            Array.from({ length: 257 }, (_, i) => i + 1),
          ]) {
            const h = yield* harness(mock(() => Effect.succeed(response)).connect);
            assert.isTrue(Result.isFailure(yield* Effect.result(h.client.IkeaRefreshLights())));
            assert.deepStrictEqual(h.stored(), config);
            assert.strictEqual(h.refreshes(), 0);
          }
          const h = yield* harness(
            mock((_m, path) =>
              Effect.succeed(
                path === "15001" ? [id] : { ...wire, "3311": [{ "5850": 1, "5851": 999 }] },
              ),
            ).connect,
          );
          assert.isTrue(Result.isFailure(yield* Effect.result(h.client.IkeaRefreshLights())));
          assert.deepStrictEqual(h.stored(), config);
        }),
      ),
  );
  it.effect("aborts interrupted requests, releases locks and bounds complete enumeration", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let aborted = 0;
        let calls = 0;
        const t = mock(() =>
          Effect.suspend(() => {
            calls++;
            if (calls === 2) return Effect.succeed(wire);
            return Effect.never.pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  aborted++;
                }),
              ),
            );
          }),
        );
        const h = yield* harness(t.connect);
        const fiber = yield* h.runtime.IkeaGetLightState({ lightId: id }).pipe(Effect.forkChild);
        while (calls === 0) yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
        assert.strictEqual(aborted, 1);
        assert.strictEqual((yield* h.runtime.IkeaGetLightState({ lightId: id })).brightness, 127);
        const enumeration = yield* h.runtime.IkeaListLights().pipe(Effect.result, Effect.forkChild);
        yield* TestClock.adjust("60 seconds");
        assert.isTrue(Result.isFailure(yield* Fiber.join(enumeration)));
        assert.strictEqual(aborted, 2);
      }),
    ),
  );
  it.effect(
    "rejects malformed pairing payloads and preserves saved credentials on verification failure",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          for (const raw of [null, {}, { "9091": 123 }, { "9091": "" }, { "9091": "secret\n" }]) {
            const t = mock(() => Effect.succeed(raw));
            const h = yield* harness(t.connect);
            assert.isTrue(
              Result.isFailure(
                yield* Effect.result(
                  h.client.IkeaPair({
                    host: config.host,
                    timeoutMs: 10000,
                    securityCode: "printed-secret",
                  }),
                ),
              ),
            );
            assert.deepStrictEqual(h.stored(), config);
            assert.strictEqual(t.closed(), 1);
            assert.strictEqual(t.connections.length, 1);
          }
          const t = mock(() => Effect.succeed({ "9091": "acquired-secret" }));
          const h = yield* harness((options) =>
            options.identity === "Client_identity"
              ? t.connect(options)
              : Effect.die(new Error("acquired-secret")),
          );
          const result = yield* Effect.result(
            h.client.IkeaPair({
              host: config.host,
              timeoutMs: 10000,
              securityCode: "printed-secret",
            }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.notInclude(result.failure.reason, "secret");
          assert.deepStrictEqual(h.stored(), config);
          assert.strictEqual(t.closed(), 1);
        }),
      ),
  );
  it.effect(
    "reconnects a closed session, updates the same gateway address without pairing and aborts pending handshakes",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const t = mock();
          const h = yield* harness(t.connect);
          yield* h.runtime.IkeaListLights();
          yield* t.sessions[0]!.close;
          yield* h.runtime.IkeaListLights();
          assert.strictEqual(t.connections.length, 2);
          yield* h.client.IkeaConfigure({ host: "gateway.local", timeoutMs: 5000 });
          assert.deepStrictEqual(h.stored(), {
            ...config,
            host: "gateway.local",
            timeoutMs: 5000,
            lights: [],
          });
          assert.strictEqual(t.closed(), 2);
          assert.strictEqual(t.connections.length, 2);
          let started = false;
          let aborted = false;
          const hanging = yield* harness(() =>
            Effect.suspend(() => {
              started = true;
              return Effect.never.pipe(
                Effect.onInterrupt(() =>
                  Effect.sync(() => {
                    aborted = true;
                  }),
                ),
              );
            }),
          );
          const fiber = yield* hanging.runtime.IkeaListLights().pipe(Effect.forkChild);
          while (!started) yield* Effect.yieldNow;
          yield* Fiber.interrupt(fiber);
          assert.isTrue(aborted);
        }),
      ),
  );
});
