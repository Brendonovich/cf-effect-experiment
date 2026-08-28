import { Effect, Layer, Schema, Semaphore, Stream } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/unstable/http";

import {
  ClientRpcs,
  DeviceId,
  KeyLightDevice,
  KeyLightEngine,
  KeyLightFailure,
  RuntimeRpcs,
  type DeviceDefinition,
  type Operation,
} from "./Definition.ts";
import { checked, integer, kelvinToMireds, miredsToKelvin, validateDevice } from "./Validation.ts";

const WireLight = Schema.Struct({
  on: Schema.Literals([0, 1]),
  brightness: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  temperature: Schema.Int.check(Schema.isBetween({ minimum: 143, maximum: 344 })),
});
const WireState = Schema.Struct({
  numberOfLights: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 })),
  lights: Schema.Array(WireLight).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
});
type WireState = typeof WireState.Type;
const maxBodyBytes = 64 * 1024;
const stateOutput = Effect.fnUntraced(function* (state: WireState) {
  return {
    on: state.lights[0]!.on === 1,
    brightness: state.lights[0]!.brightness,
    kelvin: yield* miredsToKelvin(state.lights[0]!.temperature),
  };
});

export const runtimeLayer = KeyLightEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);
    // Serialize read-modify-write operations and configuration changes in this engine.
    const lock = yield* Semaphore.make(1);
    const refresh = mg.client.refresh.pipe(Effect.andThen(mg.resource.refresh(KeyLightDevice)));
    const findDevice = Effect.fnUntraced(function* (id: DeviceId) {
      const { devices } = yield* mg.storage.get;
      const device = devices.find((device) => device.id === id);
      if (!device)
        return yield* new KeyLightFailure({
          reason: `Key Light device not found: ${id}`,
        });
      return yield* validateDevice(device);
    });

    const request = Effect.fnUntraced(function* (
      device: DeviceDefinition,
      method: "GET" | "PUT",
      body?: WireState,
    ) {
      const url = `${device.url}/elgato/lights`;
      const data = yield* Effect.gen(function* () {
        let outgoing = HttpClientRequest.make(method)(url).pipe(HttpClientRequest.acceptJson);
        if (body !== undefined) outgoing = yield* HttpClientRequest.bodyJson(outgoing, body);
        const response = yield* client.execute(outgoing);
        if (response.status < 200 || response.status >= 300)
          return yield* new KeyLightFailure({ reason: `HTTP ${response.status}` });
        let size = 0;
        let text = "";
        const decoder = new TextDecoder("utf-8", { fatal: true });
        yield* response.stream.pipe(
          Stream.runForEach((chunk) =>
            Effect.gen(function* () {
              size += chunk.byteLength;
              if (size > maxBodyBytes)
                return yield* new KeyLightFailure({
                  reason: `Response exceeds ${maxBodyBytes} bytes`,
                });
              text += yield* checked(() => decoder.decode(chunk, { stream: true }));
            }),
          ),
        );
        return yield* checked(() => JSON.parse(text + decoder.decode()) as unknown);
      }).pipe(
        Effect.scoped,
        Effect.provideService(FetchHttpClient.RequestInit, {
          redirect: "error",
          credentials: "omit",
        }),
        Effect.mapError((error) => {
          const cause =
            HttpClientError.isHttpClientError(error) && "cause" in error.reason
              ? (error.reason.cause ?? error)
              : error;
          return new KeyLightFailure({
            reason: `${method} ${url} failed: ${cause instanceof KeyLightFailure ? cause.reason : cause instanceof Error ? cause.message : String(cause)}`,
          });
        }),
        Effect.timeoutOrElse({
          duration: device.timeoutMs,
          orElse: () =>
            new KeyLightFailure({
              reason: `${method} ${url} timed out after ${device.timeoutMs}ms`,
            }),
        }),
      );
      const state = yield* Schema.decodeUnknownEffect(WireState)(data).pipe(
        Effect.mapError(
          () =>
            new KeyLightFailure({
              reason: `${method} ${url}: invalid light state response`,
            }),
        ),
      );
      if (state.numberOfLights !== state.lights.length)
        return yield* new KeyLightFailure({
          reason: `${method} ${url}: light count does not match lights`,
        });
      return state;
    });

    const getState = (id: DeviceId) =>
      findDevice(id).pipe(
        Effect.flatMap((device) => request(device, "GET")),
        Effect.flatMap(stateOutput),
        lock.withPermit,
      );
    const updateState = Effect.fnUntraced(function* (id: DeviceId, operation: Operation) {
      const device = yield* findDevice(id);
      const patch = yield* Effect.gen(function* () {
        if (operation.type !== "set") {
          if (operation.type !== "toggle")
            yield* integer(
              operation.delta,
              Number.MIN_SAFE_INTEGER,
              Number.MAX_SAFE_INTEGER,
              "Delta",
            );
          return {};
        }
        const state = operation.state;
        if (state.on === undefined && state.brightness === undefined && state.kelvin === undefined)
          return yield* new KeyLightFailure({ reason: "At least one state field is required" });
        if (state.on !== undefined && typeof state.on !== "boolean")
          return yield* new KeyLightFailure({ reason: "On must be a boolean" });
        return {
          ...(state.on !== undefined ? { on: state.on ? (1 as const) : (0 as const) } : {}),
          ...(state.brightness !== undefined
            ? { brightness: yield* integer(state.brightness, 0, 100, "Brightness") }
            : {}),
          ...(state.kelvin !== undefined
            ? { temperature: yield* kelvinToMireds(state.kelvin) }
            : {}),
        };
      });
      const current = yield* request(device, "GET");
      const first = current.lights[0]!;
      const change =
        operation.type === "toggle"
          ? { on: first.on === 1 ? (0 as const) : (1 as const) }
          : operation.type === "brightness"
            ? {
                brightness: Math.max(0, Math.min(100, first.brightness + operation.delta)),
              }
            : operation.type === "temperature"
              ? {
                  temperature: yield* kelvinToMireds(
                    Math.max(
                      2900,
                      Math.min(7000, (yield* miredsToKelvin(first.temperature)) + operation.delta),
                    ),
                  ),
                }
              : patch;
      const result = yield* request(device, "PUT", {
        numberOfLights: current.numberOfLights,
        lights: current.lights.map((light) => ({ ...light, ...change })),
      });
      return yield* stateOutput(result);
    });

    return KeyLightEngine.of({
      resources: KeyLightDevice.toLayer(
        mg.storage.get.pipe(
          Effect.map(({ devices }) =>
            devices.map((device) => ({ id: device.id, display: device.name })),
          ),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({
        ElgatoKeyLightGetState: ({ deviceId }) => getState(deviceId),
        ElgatoKeyLightUpdateState: ({ deviceId, operation }) =>
          updateState(deviceId, operation).pipe(lock.withPermit),
      }),
      client: {
        state: mg.storage.get,
        rpcs: ClientRpcs.toLayer({
          ElgatoKeyLightAddDevice: (payload) =>
            Effect.gen(function* () {
              const id = DeviceId.make(yield* checked(() => globalThis.crypto.randomUUID()));
              const device = yield* validateDevice({ ...payload, id });
              yield* mg.storage.update(({ devices }) => ({
                devices: [...devices, device],
              }));
              yield* refresh;
              return id;
            }).pipe(lock.withPermit),
          ElgatoKeyLightUpdateDevice: (payload) =>
            Effect.gen(function* () {
              const device = yield* validateDevice(payload);
              const { devices } = yield* mg.storage.get;
              if (!devices.some((entry) => entry.id === device.id))
                return yield* new KeyLightFailure({
                  reason: `Key Light device not found: ${device.id}`,
                });
              yield* mg.storage.set({
                devices: devices.map((entry) => (entry.id === device.id ? device : entry)),
              });
              yield* refresh;
            }).pipe(lock.withPermit),
          ElgatoKeyLightRemoveDevice: ({ id }) =>
            Effect.gen(function* () {
              const { devices } = yield* mg.storage.get;
              if (!devices.some((device) => device.id === id))
                return yield* new KeyLightFailure({
                  reason: `Key Light device not found: ${id}`,
                });
              yield* mg.storage.set({
                devices: devices.filter((device) => device.id !== id),
              });
              yield* refresh;
            }).pipe(lock.withPermit),
          ElgatoKeyLightTestDevice: ({ id }) => getState(id),
        }),
      },
    });
  }),
);

export const layer = runtimeLayer.pipe(Layer.provide(FetchHttpClient.layer));
export default layer;
