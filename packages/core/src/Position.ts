import { Schema } from "effect";

export const Position = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});
export type Position = typeof Position.Type;
