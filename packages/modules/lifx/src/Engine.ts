import { Effect, Layer, Schema, Semaphore } from "effect";
import { Buffer } from "node:buffer";

import {
  ClientRpcs,
  LIFXEngine,
  LIFXFailure,
  LIFXLight,
  RuntimeRpcs,
  RuntimeStorage,
  type Color,
  type DeviceId,
} from "./Definition.ts";
import { colorPayload, MessageType, parseState, powerPayload } from "./Protocol.ts";
import { nodeLayer as nodeLayerTransport, Transport } from "./Transport.ts";
import { failure, range, validateStorage } from "./Validation.ts";

export const layer = LIFXEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const transport = yield* Transport;
    const lock = yield* Semaphore.make(1);
    const lookup = Effect.fnUntraced(function* (id: DeviceId) {
      const storage = yield* mg.storage.get;
      const validated = yield* validateStorage(storage);
      const device = validated.devices.find((device) => device.id === id.toLowerCase());
      if (!device) return yield* new LIFXFailure({ reason: "LIFX light is not configured" });
      return { device, timeout: validated.timeout };
    });
    const getState = Effect.fnUntraced(function* (deviceId: DeviceId) {
      const { device, timeout } = yield* lookup(deviceId);
      const reply = yield* transport.exchange(
        device,
        MessageType.Get,
        Buffer.alloc(0),
        MessageType.State,
        timeout,
      );
      return yield* parseState(reply);
    });
    const setColor = Effect.fnUntraced(function* (
      deviceId: DeviceId,
      color: Color,
      duration: number,
    ) {
      const payload = yield* colorPayload(color, duration);
      const { device, timeout } = yield* lookup(deviceId);
      yield* transport.exchange(device, MessageType.SetColor, payload, MessageType.Ack, timeout);
    });

    return LIFXEngine.of({
      resources: LIFXLight.toLayer(
        mg.storage.get.pipe(
          Effect.map(({ devices }) => devices.map(({ id, name }) => ({ id, display: name }))),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({
        LIFXGetState: ({ deviceId }) => getState(deviceId).pipe(lock.withPermit),
        LIFXSetPower: Effect.fnUntraced(function* ({ deviceId, power, duration }) {
          const payload = yield* powerPayload(power, duration);
          const { device, timeout } = yield* lookup(deviceId);
          yield* transport.exchange(
            device,
            MessageType.SetPower,
            payload,
            MessageType.Ack,
            timeout,
          );
        }, lock.withPermit),
        LIFXSetColor: ({ deviceId, color, duration }) =>
          setColor(deviceId, color, duration).pipe(lock.withPermit),
        LIFXSetBrightness: Effect.fnUntraced(function* ({ deviceId, brightness, duration }) {
          yield* range("Brightness", brightness, 0, 100);
          yield* range("Duration (ms)", duration, 0, 0xffffffff, true);
          const state = yield* getState(deviceId);
          yield* setColor(deviceId, { ...state, brightness }, duration);
        }, lock.withPermit),
        LIFXSetKelvin: Effect.fnUntraced(function* ({ deviceId, kelvin, brightness, duration }) {
          yield* range("Kelvin", kelvin, 1500, 9000, true);
          yield* range("Brightness", brightness, 0, 100);
          yield* range("Duration (ms)", duration, 0, 0xffffffff, true);
          const state = yield* getState(deviceId);
          yield* setColor(deviceId, { ...state, saturation: 0, kelvin, brightness }, duration);
        }, lock.withPermit),
      }),
      client: {
        state: mg.storage.get,
        rpcs: ClientRpcs.toLayer({
          LIFXConfigure: Effect.fnUntraced(function* (input) {
            const decoded = yield* Schema.decodeUnknownEffect(RuntimeStorage)(input).pipe(
              Effect.mapError(failure),
            );
            const storage = yield* validateStorage(decoded);
            yield* mg.storage.set(storage);
            yield* mg.resource.refresh(LIFXLight);
            yield* mg.client.refresh;
          }, lock.withPermit),
        }),
      },
    });
  }),
);

export const nodeLayer = layer.pipe(Layer.provide(nodeLayerTransport));
export default nodeLayer;
