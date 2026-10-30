import { Engine, Resource } from "@macrograph/module";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

export const InputId = Schema.String.pipe(Schema.brand("MidiInputId"));
export type InputId = typeof InputId.Type;
export const OutputId = Schema.String.pipe(Schema.brand("MidiOutputId"));
export type OutputId = typeof OutputId.Type;

export class MidiFailure extends Schema.TaggedError<MidiFailure>()("MidiFailure", {
  reason: Schema.String,
}) {}

export class MidiMessage extends Schema.TaggedClass<MidiMessage>()("MidiMessage", {
  inputId: InputId,
  data: Schema.Array(Schema.Int),
}) {}

export class MidiInput extends Resource.make<MidiInput, InputId>()("MidiInput", {
  name: "MIDI Input",
  description: "A MIDI input port the server listens to. Enable inputs in the MIDI settings.",
}) {}

export class MidiOutput extends Resource.make<MidiOutput, OutputId>()("MidiOutput", {
  name: "MIDI Output",
  description: "A MIDI output port connected to the server.",
}) {}

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("MidiSetInputEnabled", {
    payload: Schema.Struct({ id: InputId, enabled: Schema.Boolean }),
    error: MidiFailure,
  }),
  Rpc.make("MidiRescan", { error: MidiFailure }),
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("MidiSend", {
    payload: Schema.Struct({ outputId: OutputId, data: Schema.Array(Schema.Int) }),
    error: MidiFailure,
  }),
) {}

export const RuntimeStorage = Schema.Struct({ enabledInputs: Schema.Array(InputId) });

export const ClientState = Schema.Struct({
  available: Schema.Boolean,
  error: Schema.optional(Schema.String),
  inputs: Schema.Array(
    Schema.Struct({
      id: InputId,
      connected: Schema.Boolean,
      enabled: Schema.Boolean,
      listening: Schema.Boolean,
      error: Schema.optional(Schema.String),
    }),
  ),
  outputs: Schema.Array(Schema.Struct({ id: OutputId, open: Schema.Boolean })),
});
export type ClientState = typeof ClientState.Type;

export class MidiEngine extends Engine.make({
  resources: [MidiInput, MidiOutput],
  events: Array.empty<MidiMessage>(),
  storage: RuntimeStorage,
  initialStorage: { enabledInputs: [] },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
