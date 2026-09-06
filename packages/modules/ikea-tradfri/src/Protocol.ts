import { Effect, Schema } from "effect";

import { IkeaFailure, LightId, type LightState, type StatePatch } from "./Definition.ts";

export const integer = Effect.fnUntraced(function* (
  value: number,
  min: number,
  max: number,
  field: string,
) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    return yield* new IkeaFailure({ reason: `${field} must be an integer from ${min} to ${max}.` });
  return value;
});
export const validateHost = Effect.fnUntraced(function* (host: string) {
  // DNS names and IPv4 only: no URLs, credentials, paths, ports or whitespace.
  if (
    host.length < 1 ||
    host.length > 253 ||
    !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
    (/^[0-9.]+$/.test(host) &&
      (host.split(".").length !== 4 ||
        host.split(".").some((part) => Number(part) > 255 || (part.length > 1 && part[0] === "0"))))
  )
    return yield* new IkeaFailure({
      reason: "Gateway host must be a plain IPv4 address or DNS hostname.",
    });
  return host;
});
export const validateConfig = Effect.fnUntraced(function* (config: {
  host: string;
  timeoutMs: number;
}) {
  yield* validateHost(config.host);
  yield* integer(config.timeoutMs, 1000, 30000, "Timeout (milliseconds)");
  return config;
});
export const validateSecret = Effect.fnUntraced(function* (secret: string) {
  if (!/^[\x21-\x7e]{1,128}$/.test(secret))
    return yield* new IkeaFailure({ reason: "Invalid gateway credential format." });
  return secret;
});
const WireLight = Schema.Struct({
  "5850": Schema.Literals([0, 1]),
  "5851": Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 254 })),
  "5711": Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))),
  "5706": Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{6}$/i))),
});
const WireDevice = Schema.Struct({
  "9003": Schema.optional(Schema.Int),
  "9001": Schema.String.check(Schema.isMaxLength(256)),
  "9019": Schema.Literals([0, 1]),
  "5750": Schema.Int,
  "3311": Schema.optional(
    Schema.Array(WireLight).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  ),
});
const DeviceIds = Schema.Array(
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4294967295 })),
).check(Schema.isMaxLength(256));
export const parseIds = Effect.fnUntraced(function* (data: unknown) {
  const invalid = () =>
    new IkeaFailure({
      reason: "Gateway returned an invalid device list (maximum 256 devices).",
    });
  const ids = yield* Schema.decodeUnknownEffect(DeviceIds)(data).pipe(Effect.mapError(invalid));
  if (new Set(ids).size !== ids.length) return yield* invalid();
  return ids.map((id) => LightId.make(id));
});
export const parseLight: (
  id: LightId,
  data: unknown,
) => Effect.Effect<LightState | undefined, IkeaFailure> = Effect.fnUntraced(function* (
  id: LightId,
  data: unknown,
) {
  const invalid = () => new IkeaFailure({ reason: "Gateway returned an invalid device state." });
  yield* integer(id, 0, 4294967295, "Device ID").pipe(Effect.mapError(invalid));
  const device = yield* Schema.decodeUnknownEffect(WireDevice)(data).pipe(Effect.mapError(invalid));
  if (device["9003"] !== undefined && device["9003"] !== id) return yield* invalid();
  if (device["5750"] !== 2) return undefined;
  const light = device["3311"]?.[0];
  if (!light) return yield* invalid();
  return {
    id,
    name: device["9001"],
    reachable: device["9019"] === 1,
    on: light["5850"] === 1,
    brightness: light["5851"],
    ...(light["5711"] === undefined || light["5711"] === 0
      ? {}
      : { colorTemp: Math.round(1000000 / light["5711"]) }),
    ...(light["5706"] === undefined ? {} : { hexColor: light["5706"].toLowerCase() }),
  };
});
export const command = Effect.fnUntraced(function* (state: StatePatch) {
  const fields: Record<string, number | string> = {};
  if (state.on !== undefined) {
    if (typeof state.on !== "boolean")
      return yield* new IkeaFailure({ reason: "On must be a boolean." });
    fields["5850"] = state.on ? 1 : 0;
  }
  if (state.brightness !== undefined)
    fields["5851"] = yield* integer(state.brightness, 0, 254, "Brightness");
  if (state.colorTemp !== undefined)
    fields["5711"] = Math.round(
      1000000 / (yield* integer(state.colorTemp, 2200, 4000, "Color temperature (Kelvin)")),
    );
  if (state.hexColor !== undefined) {
    if (!/^#?[0-9a-f]{6}$/i.test(state.hexColor))
      return yield* new IkeaFailure({
        reason: "Color must be six hexadecimal digits, optionally prefixed with #.",
      });
    fields["5706"] = state.hexColor.replace(/^#/, "").toLowerCase();
  }
  if (Object.keys(fields).length === 0)
    return yield* new IkeaFailure({ reason: "At least one state field is required." });
  return { "3311": [fields] };
});
