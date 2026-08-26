import { createEffect, createRoot, flush, untrack } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createClock } from "../../src/events/createClock";

vi.mock(
  "solid-js",
  () => import(new URL("./dist/solid.js", import.meta.resolve("solid-js/package.json")).href),
);

const disposers: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});

function mount() {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const clock = createClock();
    const observed: number[] = [];
    createEffect(clock, (value) => {
      observed.push(value);
    });
    return { clock, observed, dispose };
  });
}

describe("createClock", () => {
  it("uses the render time immediately, even between ticks or after an idle period", () => {
    vi.setSystemTime(200_000);
    const first = mount();
    expect(untrack(first.clock)).toBe(200_000);
    flush();
    expect(first.observed.at(-1)).toBe(200_000);

    vi.advanceTimersByTime(250);
    expect(untrack(first.clock)).toBe(200_250);
    const second = mount();
    expect(untrack(second.clock)).toBe(200_250);
    flush();
    expect(second.observed.at(-1)).toBe(200_250);
  });

  it("shares one timer, recalculates each second, and stops after the last unmount", () => {
    const first = mount();
    const second = mount();
    flush();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1_000);
    flush();
    expect(first.observed.at(-1)).toBe(101_000);
    expect(second.observed.at(-1)).toBe(101_000);

    first.dispose();
    expect(vi.getTimerCount()).toBe(1);
    second.dispose();
    expect(vi.getTimerCount()).toBe(0);

    vi.setSystemTime(300_000);
    const remounted = mount();
    expect(untrack(remounted.clock)).toBe(300_000);
    flush();
    expect(vi.getTimerCount()).toBe(1);
  });
});
