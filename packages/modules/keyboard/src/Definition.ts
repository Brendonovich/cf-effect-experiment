import { Engine } from "@macrograph/module";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export class KeyboardFailure extends Schema.TaggedError<KeyboardFailure>()("KeyboardFailure", {
  reason: Schema.String,
}) {}

/**
 * A key changing state. Modifiers are the other modifier keys held when the key was pressed;
 * releases report the same modifiers as their press, so a keybind's release always pairs
 * with its press.
 */
export class KeyEvent extends Schema.TaggedClass<KeyEvent>()("KeyEvent", {
  key: Schema.String,
  state: Schema.Literals(["pressed", "released"]),
  ctrl: Schema.Boolean,
  shift: Schema.Boolean,
  alt: Schema.Boolean,
  meta: Schema.Boolean,
}) {}

export const Source = Schema.Literals(["global", "browser"]);
export type Source = typeof Source.Type;

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("KeyboardSetListening", {
    payload: Schema.Struct({ enabled: Schema.Boolean }),
    error: KeyboardFailure,
  }),
) {}

/** `listen` is unset until changed in Settings, which means the transport's default. */
export const RuntimeStorage = Schema.Struct({ listen: Schema.optionalKey(Schema.Boolean) });

export const ClientState = Schema.Struct({
  source: Source,
  enabled: Schema.Boolean,
  listening: Schema.Boolean,
  error: Schema.optional(Schema.String),
});
export type ClientState = typeof ClientState.Type;

export class KeyboardEngine extends Engine.make({
  events: Array.empty<KeyEvent>(),
  storage: RuntimeStorage,
  initialStorage: {},
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
