import { Effect } from "effect";

import { LIFXFailure, type Color } from "./Definition.ts";
import { range } from "./Validation.ts";

export const validateColor = Effect.fnUntraced(function* (color: Color) {
  yield* range("Hue", color.hue, 0, 360);
  yield* range("Saturation", color.saturation, 0, 100);
  yield* range("Brightness", color.brightness, 0, 100);
  yield* range("Kelvin", color.kelvin, 1500, 9000, true);
  return color;
});

export const toRaw = (value: number, maximum: number) => Math.round((value / maximum) * 65535);

export const hexToColor = Effect.fnUntraced(function* (hex: string) {
  const cleaned = hex.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(cleaned))
    return yield* new LIFXFailure({
      reason: "Hex color must contain exactly 3 or 6 hexadecimal digits",
    });
  const full = cleaned.length === 3 ? [...cleaned].map((c) => c + c).join("") : cleaned;
  const rgb = Number.parseInt(full, 16);
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const maximum = Math.max(r, g, b),
    difference = maximum - Math.min(r, g, b);
  let hue = 0;
  if (difference !== 0) {
    if (maximum === r) hue = ((g - b) / difference + (g < b ? 6 : 0)) * 60;
    else if (maximum === g) hue = ((b - r) / difference + 2) * 60;
    else hue = ((r - g) / difference + 4) * 60;
  }
  const saturation = maximum === 0 ? 0 : (difference / maximum) * 100;
  const brightness = maximum * 100;
  return {
    hue: Math.round(hue),
    saturation: Math.round(saturation),
    brightness: Math.round(brightness),
    lifxHue: toRaw(hue, 360),
    lifxSaturation: toRaw(saturation, 100),
    lifxBrightness: toRaw(brightness, 100),
  };
});

// State hex represents HSV at the reported brightness, not a kelvin-adjusted spectral color.
export const colorToHex = Effect.fnUntraced(function* (
  hue: number,
  saturation: number,
  brightness: number,
) {
  yield* range("Hue", hue, 0, 360);
  yield* range("Saturation", saturation, 0, 100);
  yield* range("Brightness", brightness, 0, 100);
  const h = (hue % 360) / 60,
    s = saturation / 100,
    v = brightness / 100;
  const c = v * s,
    x = c * (1 - Math.abs((h % 2) - 1)),
    m = v - c;
  const rgb =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  return `#${rgb
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
});
