import { Effect, FiberHandle, Layer, Queue, SubscriptionRef } from "effect";

import { ClientRpcs, type ClientState, KeyboardEngine, KeyEvent } from "./Definition.ts";
import * as Keys from "./Keys.ts";
import * as Transport from "./Transport.ts";

type Modifiers = Pick<KeyEvent, "ctrl" | "shift" | "alt" | "meta">;

type State = { readonly listening: boolean; readonly error: string | undefined };

export const runtimeLayer = KeyboardEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const transport = yield* Transport.Service;
    const listener = yield* FiberHandle.make();
    const state = yield* SubscriptionRef.make<State>({ listening: false, error: undefined });
    const update = (f: (state: State) => State) =>
      SubscriptionRef.update(state, f).pipe(Effect.andThen(mg.client.refresh));

    const enabled = mg.storage.get.pipe(
      Effect.map(({ listen }) => listen ?? transport.listenByDefault),
    );

    const listen = Effect.gen(function* () {
      // Held keys and the modifiers each was pressed with. OS key repeat is dropped.
      const held = new Map<string, Modifiers>();
      const queue = yield* Queue.unbounded<readonly [string, boolean]>();
      yield* transport.listen((key, pressed) => {
        Queue.offerUnsafe(queue, [key, pressed]);
      });
      yield* update(() => ({ listening: true, error: undefined }));
      return yield* Queue.take(queue).pipe(
        Effect.flatMap(([key, pressed]) => {
          if (pressed) {
            if (held.has(key)) return Effect.void;
            const isHeld = (modifier: Keys.Modifier) => modifier !== key && held.has(modifier);
            const modifiers = {
              ctrl: isHeld("Ctrl"),
              shift: isHeld("Shift"),
              alt: isHeld("Alt"),
              meta: isHeld("Meta"),
            };
            held.set(key, modifiers);
            return mg.emit(new KeyEvent({ key, state: "pressed", ...modifiers }));
          }
          const modifiers = held.get(key);
          if (modifiers === undefined) return Effect.void;
          held.delete(key);
          return mg.emit(new KeyEvent({ key, state: "released", ...modifiers }));
        }),
        Effect.forever,
      );
    }).pipe(
      Effect.scoped,
      Effect.catch((error) => update(() => ({ listening: false, error: error.reason }))),
      Effect.onInterrupt(() => update((current) => ({ ...current, listening: false }))),
    );

    const reconcile = Effect.gen(function* () {
      if (yield* enabled) yield* FiberHandle.run(listener, listen, { onlyIfMissing: true });
      else {
        yield* FiberHandle.clear(listener);
        yield* update(() => ({ listening: false, error: undefined }));
      }
    });

    yield* reconcile;

    const clientState = Effect.gen(function* () {
      const current = yield* SubscriptionRef.get(state);
      return {
        source: transport.source,
        enabled: yield* enabled,
        listening: current.listening,
        ...(current.error === undefined ? {} : { error: current.error }),
      } satisfies ClientState;
    });

    return KeyboardEngine.of({
      resources: Layer.empty,
      rpcs: Layer.empty,
      client: {
        state: clientState,
        rpcs: ClientRpcs.toLayer({
          KeyboardSetListening: ({ enabled }) =>
            Effect.gen(function* () {
              yield* mg.storage.update((storage) => ({ ...storage, listen: enabled }));
              // Clear first so re-enabling after a failure retries.
              yield* FiberHandle.clear(listener);
              yield* reconcile;
              yield* mg.client.refresh;
            }),
        }),
      },
    });
  }),
);
