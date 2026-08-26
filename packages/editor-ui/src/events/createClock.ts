import { createEffect, createSignal } from "solid-js";

const [tick, setTick] = createSignal(0);
let subscribers = 0;
let interval: ReturnType<typeof setInterval> | undefined;

export function createClock() {
  createEffect(
    () => true,
    () => {
      setTick(Date.now());
      if (subscribers++ === 0) {
        interval = setInterval(() => setTick(Date.now()), 1_000);
      }
      return () => {
        if (--subscribers === 0) {
          clearInterval(interval);
          interval = undefined;
        }
      };
    },
  );

  return () => {
    // The shared tick triggers recalculation; newly rendered timestamps use the actual time.
    tick();
    return Date.now();
  };
}
