import { Schema } from "effect";

export const Model = Schema.Union([
  Schema.Struct({ type: Schema.Literal("CLIENT"), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal("SYSTEM") }),
]);
export type Model = typeof Model.Type;

export const system: Model = { type: "SYSTEM" };
