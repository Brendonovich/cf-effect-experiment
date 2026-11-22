import { Effect, Layer } from "effect";

import * as Keys from "../Keys.ts";
import { Service } from "../Transport.ts";

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement);

/**
 * Key presses in this browser tab while it has focus. Presses while typing in a text field are
 * ignored, and held keys are released when the tab loses focus because the browser stops
 * reporting their key ups.
 */
export const layer = Layer.succeed(Service)(
  Service.of({
    source: "browser",
    listenByDefault: true,
    listen: (listener) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const held = new Set<string>();
          const onDown = (event: KeyboardEvent) => {
            const key = Keys.fromBrowserCode(event.code);
            if (key === undefined || isEditable(event.target)) return;
            held.add(key);
            listener(key, true);
          };
          const onUp = (event: KeyboardEvent) => {
            const key = Keys.fromBrowserCode(event.code);
            if (key === undefined || !held.delete(key)) return;
            listener(key, false);
          };
          const releaseAll = () => {
            for (const key of held) {
              held.delete(key);
              listener(key, false);
            }
          };
          window.addEventListener("keydown", onDown, true);
          window.addEventListener("keyup", onUp, true);
          window.addEventListener("blur", releaseAll);
          return () => {
            window.removeEventListener("keydown", onDown, true);
            window.removeEventListener("keyup", onUp, true);
            window.removeEventListener("blur", releaseAll);
          };
        }),
        (remove) => Effect.sync(remove),
      ).pipe(Effect.asVoid),
  }),
);
