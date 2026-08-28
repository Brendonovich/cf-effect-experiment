import { Effect } from "effect";

import { type DeviceDefinition, KeyLightFailure } from "./Definition.ts";

export const integer = Effect.fnUntraced(function* (
  value: number,
  min: number,
  max: number,
  label: string,
) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    return yield* new KeyLightFailure({
      reason: `${label} must be an integer between ${min} and ${max}`,
    });
  return value;
});

export const kelvinToMireds = (value: number) =>
  integer(value, 2900, 7000, "Temperature (Kelvin)").pipe(
    Effect.map((value) => Math.min(344, Math.round(1_000_000 / value))),
  );
export const miredsToKelvin = (value: number) =>
  integer(value, 143, 344, "Temperature (mireds)").pipe(
    Effect.map((value) => Math.round(1_000_000 / value)),
  );

export const checked = <A>(run: () => A) =>
  Effect.try({
    try: run,
    catch: (error) =>
      new KeyLightFailure({ reason: error instanceof Error ? error.message : String(error) }),
  });

export const validateDevice = Effect.fnUntraced(function* (definition: DeviceDefinition) {
  const name = definition.name.trim();
  if (name.length === 0 || name.length > 80)
    return yield* new KeyLightFailure({ reason: "Name must contain 1 to 80 characters" });
  if (definition.id.trim().length === 0 || definition.id.length > 128)
    return yield* new KeyLightFailure({ reason: "Device ID must contain 1 to 128 characters" });
  const input = definition.url;
  if (input.length > 2048 || /[\s\\]/.test(input) || !/^http:\/\//i.test(input))
    return yield* new KeyLightFailure({
      reason: "Use an HTTP device origin, for example http://192.168.1.20:9123",
    });
  const url = yield* checked(() => new URL(input));
  if (
    url.protocol !== "http:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    input.includes("?") ||
    input.includes("#")
  )
    return yield* new KeyLightFailure({
      reason: "Device URL must be an HTTP origin without credentials, path, query or fragment",
    });
  // URL normalizes an explicit port 80 to empty; distinguish it from an omitted port.
  const authority = input.slice(input.indexOf("//") + 2).split("/")[0]!;
  const suffix = input.slice(input.indexOf("//") + 2 + authority.length);
  if ((suffix !== "" && suffix !== "/") || authority.endsWith(":"))
    return yield* new KeyLightFailure({
      reason: "Device URL must not contain a path or an empty port",
    });
  if (!/:\d+$/.test(authority)) url.port = "9123";
  yield* integer(Number(url.port || 80), 1, 65535, "Port");
  yield* integer(definition.timeoutMs, 100, 30000, "Timeout (milliseconds)");
  return { ...definition, name, url: `http://${url.hostname}:${url.port || 80}` };
});
