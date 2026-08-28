import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Effect, Exit, Fiber, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";

import {
  DeviceId,
  KeyLightDevice,
  KeyLightEngine,
  KeyLightFailure,
  type DeviceDefinition,
  type Operation,
} from "../src/Definition.ts";
import { runtimeLayer } from "../src/Engine.ts";
import { integer, kelvinToMireds, miredsToKelvin, validateDevice } from "../src/Validation.ts";

const id = DeviceId.make("desk");
const device: DeviceDefinition = {
  id,
  name: "Desk",
  url: "http://192.168.1.20:9123",
  timeoutMs: 5000,
};
const wire = {
  numberOfLights: 2,
  lights: [
    { on: 1, brightness: 50, temperature: 222 },
    { on: 0, brightness: 20, temperature: 300 },
  ],
};
const harness = Effect.fnUntraced(function* (
  fetch: typeof globalThis.fetch,
  devices: readonly DeviceDefinition[] = [device],
) {
  let stored = { devices };
  let clientRefreshes = 0;
  let resourceRefreshes = 0;
  const clients = yield* EngineTest.makeClients(KeyLightEngine).pipe(
    Effect.provide(
      runtimeLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(fetch))),
            Layer.succeed(KeyLightEngine.EngineContext)({
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
              client: {
                refresh: Effect.sync(() => {
                  clientRefreshes++;
                }),
              },
              resource: {
                refresh: () =>
                  Effect.sync(() => {
                    resourceRefreshes++;
                  }),
              },
              emit: () => Effect.void,
            }),
          ),
        ),
      ),
    ),
  );
  return {
    ...clients,
    stored: () => stored,
    refreshes: () => [clientRefreshes, resourceRefreshes],
  };
});

describe("Key Light engine", () => {
  it.effect("validation helpers fail with tagged errors and retain their reasons", () =>
    Effect.gen(function* () {
      const cases = [
        [integer(NaN, 0, 100, "Brightness"), "Brightness must be an integer between 0 and 100"],
        [kelvinToMireds(2899), "Temperature (Kelvin) must be an integer between 2900 and 7000"],
        [miredsToKelvin(345), "Temperature (mireds) must be an integer between 143 and 344"],
      ] as const;
      for (const [effect, reason] of cases) {
        const error = yield* Effect.flip(effect);
        assert.instanceOf(error, KeyLightFailure);
        assert.strictEqual(error.reason, reason);
      }
      for (const patch of [
        { id: DeviceId.make("") },
        { id: DeviceId.make("a".repeat(129)) },
        { timeoutMs: 100.5 },
        { url: "http://" },
      ])
        assert.instanceOf(
          yield* Effect.flip(validateDevice({ ...device, ...patch })),
          KeyLightFailure,
        );
    }),
  );
  it.effect("mounts inertly, persists stable device IDs and exposes configured resources", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let calls = 0;
        const { engine, client, runtime, stored, refreshes } = yield* harness(async () => {
          calls++;
          return Response.json(wire);
        }, []);
        assert.deepStrictEqual(yield* engine.client.state, { devices: [] });
        assert.strictEqual(calls, 0);
        const added = yield* client.ElgatoKeyLightAddDevice({
          name: " Desk ",
          url: "http://light.local",
          timeoutMs: 1000,
        });
        assert.deepStrictEqual(stored().devices, [
          { id: added, name: "Desk", url: "http://light.local:9123", timeoutMs: 1000 },
        ]);
        yield* client.ElgatoKeyLightUpdateDevice({
          id: added,
          name: "Studio",
          url: "http://[::1]:80/",
          timeoutMs: 2000,
        });
        assert.strictEqual(stored().devices[0]!.id, added);
        assert.strictEqual(stored().devices[0]!.url, "http://[::1]:80");
        assert.deepStrictEqual(
          yield* KeyLightDevice.values.pipe(Effect.provide(engine.resources)),
          [{ id: added, display: "Studio" }],
        );
        assert.strictEqual(calls, 0);
        assert.deepStrictEqual(yield* client.ElgatoKeyLightTestDevice({ id: added }), {
          on: true,
          brightness: 50,
          kelvin: 4505,
        });
        assert.strictEqual(calls, 1);
        yield* client.ElgatoKeyLightRemoveDevice({ id: added });
        assert.deepStrictEqual(stored(), { devices: [] });
        assert.deepStrictEqual(refreshes(), [3, 3]);
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(runtime.ElgatoKeyLightGetState({ deviceId: added })),
          ),
        );
        assert.isTrue(
          Result.isFailure(yield* Effect.result(client.ElgatoKeyLightRemoveDevice({ id: added }))),
        );
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(client.ElgatoKeyLightUpdateDevice({ ...device, id: added })),
          ),
        );
      }),
    ),
  );

  it.effect("rejects invalid configuration without persisting or making requests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let calls = 0;
        const { client, stored } = yield* harness(async () => {
          calls++;
          return Response.json(wire);
        }, []);
        for (const url of [
          "not a url",
          "https://light.local",
          "file:///etc/passwd",
          "http://user:secret@light.local",
          "http://light.local/path",
          "http://light.local/path/..",
          "http://light.local?",
          "http://light.local#",
          "http://light.local:0",
          "http://light.local:65536",
          "http://light.local:-1",
          "http://light.local:",
          "http://light.local:1.5",
          " http://light.local",
          "http://light.local\n",
          "http://light.local\\foo",
          "http://",
        ]) {
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(
                client.ElgatoKeyLightAddDevice({ name: "Desk", url, timeoutMs: 5000 }),
              ),
            ),
            url,
          );
        }
        for (const timeoutMs of [0, 99, 30001])
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(
                client.ElgatoKeyLightAddDevice({ name: "Desk", url: device.url, timeoutMs }),
              ),
            ),
          );
        for (const name of ["", " ", "x".repeat(81)])
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(
                client.ElgatoKeyLightAddDevice({ name, url: device.url, timeoutMs: 5000 }),
              ),
            ),
          );
        assert.deepStrictEqual(stored(), { devices: [] });
        assert.strictEqual(calls, 0);
      }),
    ),
  );

  it.effect("revalidates persisted configuration before sending HTTP", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let calls = 0;
        const { runtime } = yield* harness(async () => {
          calls++;
          return Response.json(wire);
        }, [{ ...device, url: "http://light.local/private" }]);
        assert.isTrue(
          Result.isFailure(yield* Effect.result(runtime.ElgatoKeyLightGetState({ deviceId: id }))),
        );
        assert.strictEqual(calls, 0);
      }),
    ),
  );

  it.effect(
    "uses GET/PUT, preserves unchanged channel fields and returns the actual PUT state",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
          const { runtime } = yield* harness(async (url, init) => {
            calls.push({ url: String(url), init });
            return Response.json(
              init?.method === "PUT"
                ? { numberOfLights: 1, lights: [{ on: 0, brightness: 42, temperature: 250 }] }
                : wire,
            );
          });
          const result = yield* runtime.ElgatoKeyLightUpdateState({
            deviceId: id,
            operation: { type: "set", state: { brightness: 80 } },
          });
          assert.deepStrictEqual(result, { on: false, brightness: 42, kelvin: 4000 });
          assert.deepStrictEqual(
            calls.map(({ url, init }) => [url, init?.method, init?.redirect, init?.credentials]),
            [
              [`${device.url}/elgato/lights`, "GET", "error", "omit"],
              [`${device.url}/elgato/lights`, "PUT", "error", "omit"],
            ],
          );
          assert.strictEqual(
            new Headers(calls[1]!.init?.headers).get("Content-Type"),
            "application/json",
          );
          assert.deepStrictEqual(
            yield* Effect.promise(() => new Response(calls[1]!.init?.body).json()),
            {
              numberOfLights: 2,
              lights: [
                { on: 1, brightness: 80, temperature: 222 },
                { on: 0, brightness: 80, temperature: 300 },
              ],
            },
          );
        }),
      ),
  );

  it.effect("toggles and clamps increments using the first channel as baseline", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { runtime } = yield* harness(
          async (_url, init) =>
            new Response(init?.method === "PUT" ? init.body : JSON.stringify(wire)),
        );
        const cases: Array<[Operation, { on: boolean; brightness: number; kelvin: number }]> = [
          [{ type: "toggle" }, { on: false, brightness: 50, kelvin: 4505 }],
          [
            { type: "brightness", delta: 60 },
            { on: true, brightness: 100, kelvin: 4505 },
          ],
          [
            { type: "brightness", delta: -60 },
            { on: true, brightness: 0, kelvin: 4505 },
          ],
          [
            { type: "temperature", delta: 10000 },
            { on: true, brightness: 50, kelvin: 6993 },
          ],
          [
            { type: "temperature", delta: -10000 },
            { on: true, brightness: 50, kelvin: 2907 },
          ],
          [
            { type: "set", state: { on: false, brightness: 0, kelvin: 4000 } },
            { on: false, brightness: 0, kelvin: 4000 },
          ],
        ];
        for (const [operation, expected] of cases)
          assert.deepStrictEqual(
            yield* runtime.ElgatoKeyLightUpdateState({ deviceId: id, operation }),
            expected,
          );
      }),
    ),
  );

  it.effect("rejects invalid state inputs before contacting the device", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let calls = 0;
        const { runtime } = yield* harness(async () => {
          calls++;
          return Response.json(wire);
        });
        for (const operation of [
          { type: "set", state: {} },
          { type: "set", state: { brightness: -1 } },
          { type: "set", state: { brightness: 101 } },
          { type: "set", state: { kelvin: 2899 } },
          { type: "set", state: { kelvin: 7001 } },
          { type: "brightness", delta: Number.MAX_SAFE_INTEGER + 1 },
          { type: "brightness", delta: NaN },
          { type: "temperature", delta: Infinity },
          { type: "set", state: { brightness: 1.5 } },
        ] satisfies Operation[])
          assert.isTrue(
            Exit.isFailure(
              yield* Effect.exit(runtime.ElgatoKeyLightUpdateState({ deviceId: id, operation })),
            ),
          );
        assert.strictEqual(calls, 0);
      }),
    ),
  );

  it.effect("serializes concurrent read-modify-write operations", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let body: BodyInit | null | undefined = JSON.stringify(wire);
        const methods: string[] = [];
        const { runtime } = yield* harness(async (_url, init) => {
          methods.push(init!.method!);
          if (init?.method === "PUT") body = init.body;
          return new Response(body);
        });
        yield* Effect.all(
          [1, 2].map(() =>
            runtime.ElgatoKeyLightUpdateState({
              deviceId: id,
              operation: { type: "brightness", delta: 5 },
            }),
          ),
          { concurrency: "unbounded" },
        );
        assert.deepStrictEqual(methods, ["GET", "PUT", "GET", "PUT"]);
        assert.strictEqual(
          (yield* runtime.ElgatoKeyLightGetState({ deviceId: id })).brightness,
          60,
        );
      }),
    ),
  );

  it.effect("propagates bad statuses, JSON, light values and oversized bodies", () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const response of [
          () => new Response("no", { status: 503 }),
          () => new Response(null, { status: 204 }),
          () => new Response(null, { status: 302, headers: { location: "http://other.local" } }),
          () => new Response("not json"),
          () => new Response(" ".repeat(65537)),
          () => new Response(new Uint8Array([0xff])),
          () => Response.json({ numberOfLights: 0, lights: [] }),
          () => Response.json({ ...wire, numberOfLights: 1 }),
          ...[
            { on: 2 },
            { brightness: 101 },
            { brightness: 2.5 },
            { temperature: 142 },
            { temperature: 345 },
          ].map(
            (change) => () =>
              Response.json({ numberOfLights: 1, lights: [{ ...wire.lights[0], ...change }] }),
          ),
        ]) {
          let calls = 0;
          const { runtime } = yield* harness(async () => {
            calls++;
            return response();
          });
          const result = yield* Effect.result(
            runtime.ElgatoKeyLightUpdateState({ deviceId: id, operation: { type: "toggle" } }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result))
            assert.strictEqual(result.failure._tag, "ElgatoKeyLightFailure");
          assert.strictEqual(calls, 1, "A failed GET must not cause a PUT");
        }
      }),
    ),
  );

  it.effect("does not swallow network or PUT response failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failed = yield* harness(async () => {
          throw new Error("connection refused");
        });
        const result = yield* Effect.result(
          failed.runtime.ElgatoKeyLightGetState({ deviceId: id }),
        );
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.include(result.failure.reason, "connection refused");
        for (const response of [
          () => new Response("error", { status: 500 }),
          () => new Response("bad JSON"),
        ]) {
          const { runtime } = yield* harness(async (_url, init) =>
            init?.method === "GET" ? Response.json(wire) : response(),
          );
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(
                runtime.ElgatoKeyLightUpdateState({ deviceId: id, operation: { type: "toggle" } }),
              ),
            ),
          );
        }
      }),
    ),
  );

  it.effect("cancels oversized response bodies and releases the operation lock", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let cancelled = false;
        let requests = 0;
        const { runtime } = yield* harness(async () => {
          if (++requests > 1) return Response.json(wire);
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(65537));
              },
              cancel() {
                cancelled = true;
              },
            }),
          );
        });
        const error = yield* Effect.flip(runtime.ElgatoKeyLightGetState({ deviceId: id }));
        assert.strictEqual(error._tag, "ElgatoKeyLightFailure");
        assert.include(error.reason, "Response exceeds 65536 bytes");
        assert.isTrue(cancelled);
        assert.deepStrictEqual(yield* runtime.ElgatoKeyLightGetState({ deviceId: id }), {
          on: true,
          brightness: 50,
          kelvin: 4505,
        });
      }),
    ),
  );

  it.effect("times out and aborts a pending native fetch", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let aborted = false;
        const { runtime } = yield* harness(
          (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                aborted = true;
                reject(new Error("aborted"));
              });
            }),
        );
        const fiber = yield* runtime
          .ElgatoKeyLightGetState({ deviceId: id })
          .pipe(Effect.result, Effect.forkChild);
        yield* TestClock.adjust("5 seconds");
        const result = yield* Fiber.join(fiber);
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result))
          assert.include(result.failure.reason, "timed out after 5000ms");
        assert.isTrue(aborted);
      }),
    ),
  );

  it.effect("includes body consumption in the timeout", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let aborted = false;
        const { runtime } = yield* harness(
          async (_url, init) =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  init?.signal?.addEventListener("abort", () => {
                    aborted = true;
                    controller.error(new Error("aborted"));
                  });
                },
              }),
            ),
        );
        const fiber = yield* runtime
          .ElgatoKeyLightGetState({ deviceId: id })
          .pipe(Effect.result, Effect.forkChild);
        yield* TestClock.adjust("5 seconds");
        assert.isTrue(Result.isFailure(yield* Fiber.join(fiber)));
        assert.isTrue(aborted);
      }),
    ),
  );

  it.effect("execution cancellation aborts HTTP and releases the operation lock", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let signal: AbortSignal | null | undefined;
        let requests = 0;
        const { runtime } = yield* harness((_url, init) => {
          requests++;
          if (requests > 1) return Promise.resolve(Response.json(wire));
          signal = init?.signal;
          return new Promise<Response>((_resolve, reject) =>
            signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          );
        });
        const fiber = yield* runtime
          .ElgatoKeyLightGetState({ deviceId: id })
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
        assert.isTrue(signal?.aborted);
        assert.strictEqual(
          (yield* runtime.ElgatoKeyLightGetState({ deviceId: id })).brightness,
          50,
        );
      }),
    ),
  );
});
