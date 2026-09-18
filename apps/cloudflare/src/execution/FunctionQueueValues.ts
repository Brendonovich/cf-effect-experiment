import type { Graph } from "@macrograph/core";

import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Schema } from "effect";

// Apply recursive DataType codecs before structured cloning or Workflow persistence.
export const transform = Effect.fnUntraced(function* (
  fields: ReadonlyArray<Graph.FunctionField>,
  values: Readonly<Record<string, unknown>>,
  direction: "encode" | "decode",
) {
  const result: Record<string, unknown> = { ...values };
  for (const field of fields) {
    if (!Object.hasOwn(values, field.id)) continue;
    const codec = DataType.JsonValueSchema(field.type);
    result[field.id] = yield* (
      direction === "encode" ? Schema.encodeUnknownEffect(codec) : Schema.decodeUnknownEffect(codec)
    )(values[field.id]);
  }
  return result;
});
