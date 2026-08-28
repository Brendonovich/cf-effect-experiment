import { Effect } from "effect";

import { DeviceId, LIFXFailure, type Device, type RuntimeStorage } from "./Definition.ts";

export const range = Effect.fnUntraced(function* (
  name: string,
  value: number,
  minimum: number,
  maximum: number,
  integer = false,
) {
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  )
    return yield* new LIFXFailure({
      reason: `${name} must be ${integer ? "an integer " : ""}between ${minimum} and ${maximum}`,
    });
  return value;
});

export const validateDevice = Effect.fnUntraced(function* (device: Device) {
  if (
    !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(device.id) ||
    /^(?:00:){5}00$|^(?:ff:){5}ff$/i.test(device.id) ||
    (Number.parseInt(device.id.slice(0, 2), 16) & 1) !== 0
  )
    return yield* new LIFXFailure({
      reason: "Device ID must be a nonzero unicast MAC address (aa:bb:cc:dd:ee:ff)",
    });
  const octets = device.address.split(".");
  if (
    octets.length !== 4 ||
    octets.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255) ||
    Number(octets[0]) === 0 ||
    Number(octets[0]) >= 224 ||
    Number(octets[3]) === 255
  )
    return yield* new LIFXFailure({
      reason: "Address must be a literal unicast IPv4 address, not a hostname or broadcast address",
    });
  yield* range("Port", device.port, 1, 65535, true);
  if (device.name.trim().length === 0 || device.name.length > 128)
    return yield* new LIFXFailure({ reason: "Device name must contain 1-128 characters" });
  return { ...device, id: DeviceId.make(device.id.toLowerCase()), name: device.name.trim() };
});

export const validateStorage = Effect.fnUntraced(function* (storage: typeof RuntimeStorage.Type) {
  yield* range("Timeout (ms)", storage.timeout, 100, 30000, true);
  if (storage.devices.length > 128)
    return yield* new LIFXFailure({ reason: "At most 128 devices may be configured" });
  const devices = yield* Effect.forEach(storage.devices, validateDevice);
  if (new Set(devices.map((device) => device.id)).size !== devices.length)
    return yield* new LIFXFailure({ reason: "Device IDs must be unique" });
  return { devices, timeout: storage.timeout };
});

export const failure = (error: unknown) =>
  error instanceof LIFXFailure ? error : new LIFXFailure({ reason: "LIFX LAN operation failed" });
