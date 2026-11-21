import { Effect, Layer } from "effect";

import { KeyboardFailure } from "../Definition.ts";
import * as Keys from "../Keys.ts";
import { Service } from "../Transport.ts";

const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

interface NativeKeyEvent {
  readonly keycode: number;
}

interface NativeHook {
  on(event: "keydown" | "keyup", listener: (event: NativeKeyEvent) => void): unknown;
  off(event: "keydown" | "keyup", listener: (event: NativeKeyEvent) => void): unknown;
  start(): void;
  stop(): void;
}

/**
 * System-wide key presses through libuiohook, loaded lazily so hosts without the native addon
 * still start. The hook is a process singleton, so only one listener may be active at a time.
 * Listening is opt-in: it observes every key typed on the host and, on macOS, requires
 * Accessibility permission.
 */
export const layer = Layer.sync(Service)(() => {
  let active = false;
  return Service.of({
    source: "global",
    listenByDefault: false,
    listen: (listener) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          if (active)
            return yield* new KeyboardFailure({ reason: "The keyboard hook is already in use" });
          const { uIOhook } = yield* Effect.tryPromise({
            try: () => import("uiohook-napi/dist/index.js"),
            catch: (cause) =>
              new KeyboardFailure({
                reason: `Global keyboard support is unavailable: ${reason(cause)}`,
              }),
          });
          const hook: NativeHook = uIOhook;
          const onDown = (event: NativeKeyEvent) => {
            const key = Keys.fromUiohookCode(event.keycode);
            if (key !== undefined) listener(key, true);
          };
          const onUp = (event: NativeKeyEvent) => {
            const key = Keys.fromUiohookCode(event.keycode);
            if (key !== undefined) listener(key, false);
          };
          hook.on("keydown", onDown);
          hook.on("keyup", onUp);
          yield* Effect.try({
            try: () => hook.start(),
            catch: (cause) =>
              new KeyboardFailure({
                reason: `Failed to start the keyboard hook: ${reason(cause)}`,
              }),
          }).pipe(
            Effect.tapError(() =>
              Effect.sync(() => {
                hook.off("keydown", onDown);
                hook.off("keyup", onUp);
              }),
            ),
          );
          active = true;
          return { hook, onDown, onUp };
        }),
        ({ hook, onDown, onUp }) =>
          Effect.sync(() => {
            hook.off("keydown", onDown);
            hook.off("keyup", onUp);
            try {
              hook.stop();
            } catch {
              // The hook may already have stopped; there is nothing left to release.
            }
            active = false;
          }),
      ).pipe(Effect.asVoid),
  });
});
