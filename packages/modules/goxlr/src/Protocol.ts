import { Effect, Schema } from "effect";

import {
  ButtonState,
  ChannelMuteState,
  type Command,
  type ConnectionId,
  DialState,
  type GoXLREvent,
  LevelChange,
} from "./Definition.ts";

export const PatchOperation = Schema.Union([
  Schema.Struct({
    op: Schema.Literals(["add", "replace", "test"]),
    path: Schema.String,
    value: Schema.Unknown,
  }),
  Schema.Struct({ op: Schema.Literal("remove"), path: Schema.String }),
  Schema.Struct({
    op: Schema.Literals(["move", "copy"]),
    path: Schema.String,
    from: Schema.String,
  }),
]);
export const MixerStatus = Schema.Struct({
  levels: Schema.Struct({ volumes: Schema.Record(Schema.String, Schema.Finite) }),
});
export const Mixers = Schema.Record(Schema.String, MixerStatus);
export const DaemonStatus = Schema.Struct({ mixers: Mixers });
export const Response = Schema.Struct({
  // Broadcast patches use u64::MAX, which JSON.parse rounds outside the safe integer range.
  id: Schema.Finite,
  data: Schema.Union([
    Schema.Literal("Ok"),
    Schema.Struct({ Error: Schema.String }),
    Schema.Struct({ Status: DaemonStatus }),
    Schema.Struct({ Patch: Schema.Array(PatchOperation) }),
  ]),
});

export const decodeResponse = (text: string) =>
  Effect.try({ try: () => JSON.parse(text) as unknown, catch: (error) => error }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Response)),
  );
export const statusRequest = JSON.stringify({ id: 0, data: "GetStatus" });
export const commandRequest = (mixerId: string, command: Command) =>
  JSON.stringify({ id: 0, data: { Command: [mixerId, command] } });
export const pathParts = (path: string) =>
  path.startsWith("/")
    ? path
        .slice(1)
        .split("/")
        .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    : [];

export const patchEvents = (
  connectionId: ConnectionId,
  mixerId: string,
  operations: ReadonlyArray<typeof PatchOperation.Type>,
): Array<GoXLREvent> => {
  const events: Array<GoXLREvent> = [];
  for (const op of operations) {
    if (op.op !== "add" && op.op !== "replace") continue;
    const path = pathParts(op.path);
    if (path[0] !== "mixers" || path[1] !== mixerId) continue;
    const value = op.value;
    if (
      path[2] === "levels" &&
      path[3] === "volumes" &&
      path.length === 5 &&
      typeof value === "number" &&
      Number.isSafeInteger(Math.round(value))
    ) {
      events.push(new LevelChange({ connectionId, channel: path[4]!, value: Math.round(value) }));
    } else if (path[2] === "button_down" && path.length === 4 && typeof value === "boolean") {
      events.push(new ButtonState({ connectionId, buttonName: path[3]!, state: value }));
    } else if (
      path[2] === "effects" &&
      path[3] === "current" &&
      path.length === 6 &&
      path[5] === "amount" &&
      typeof value === "number" &&
      Number.isSafeInteger(Math.round(value))
    ) {
      events.push(new DialState({ connectionId, dial: path[4]!, amount: Math.round(value) }));
    } else if (
      path[2] === "fader_status" &&
      (path.length === 4 || (path.length === 5 && path[4] === "mute_state"))
    ) {
      const mute =
        typeof value === "object" && value !== null && "mute_state" in value
          ? value.mute_state
          : value;
      if (
        typeof mute === "boolean" ||
        mute === "MutedToX" ||
        mute === "MutedToAll" ||
        mute === "Unmuted"
      ) {
        events.push(
          new ChannelMuteState({
            connectionId,
            channel: path[3]!,
            state: typeof mute === "boolean" ? mute : mute !== "Unmuted",
          }),
        );
      }
    }
  }
  return events;
};
