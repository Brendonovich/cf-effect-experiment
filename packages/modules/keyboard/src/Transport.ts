import type { Effect, Scope } from "effect";

import { Context } from "effect";

import type { KeyboardFailure, Source } from "./Definition.ts";

export type Listener = (key: string, pressed: boolean) => void;

/** A source of physical key presses, reported by key name from `Keys`. */
export class Service extends Context.Service<
  Service,
  {
    readonly source: Source;
    /** Whether listening starts before it has been enabled in Settings. */
    readonly listenByDefault: boolean;
    readonly listen: (listener: Listener) => Effect.Effect<void, KeyboardFailure, Scope.Scope>;
  }
>()("@macrograph/module-keyboard/Transport") {}
