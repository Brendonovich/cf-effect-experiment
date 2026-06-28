import { Schema } from "effect";

export class Position extends Schema.Class<Position>("Position")({
  x: Schema.Number,
  y: Schema.Number,
}) {}
