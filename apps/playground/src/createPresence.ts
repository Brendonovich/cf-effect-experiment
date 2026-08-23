import type { Accessor } from "solid-js";

import { createEffect, createSignal, onCleanup, untrack } from "solid-js";

type PresenceState = "present" | "hiding" | "hidden";

const durationMs = (value: string) =>
  value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;

export const createPresence = (props: {
  readonly show: Accessor<boolean>;
  readonly element: Accessor<HTMLElement | null>;
}) => {
  const [state, setState] = createSignal<PresenceState>("hidden");

  createEffect(
    () => ({ show: props.show(), element: props.element(), state: untrack(state) }),
    ({ show, element, state: currentState }) => {
      if (show) {
        setState("present");
        return;
      }

      if (currentState !== "present" || element === null) {
        setState("hidden");
        return;
      }

      setState("hiding");
      queueMicrotask(() => {
        if (untrack(state) !== "hiding") return;
        const styles = getComputedStyle(element);
        const durations = styles.animationDuration
          .split(",")
          .map((value) => durationMs(value.trim()));
        const delays = styles.animationDelay.split(",").map((value) => durationMs(value.trim()));
        const animated =
          styles.animationName !== "none" &&
          durations.some((duration, index) => duration + (delays[index] ?? delays[0] ?? 0) > 0);
        if (!animated) setState("hidden");
      });
    },
  );

  createEffect(props.element, (element) => {
    if (element === null) return;
    const finish = (event: AnimationEvent) => {
      if (event.target === element && untrack(state) === "hiding") setState("hidden");
    };
    element.addEventListener("animationend", finish);
    element.addEventListener("animationcancel", finish);
    onCleanup(() => {
      element.removeEventListener("animationend", finish);
      element.removeEventListener("animationcancel", finish);
    });
  });

  return {
    present: () => state() !== "hidden",
    state,
  };
};
