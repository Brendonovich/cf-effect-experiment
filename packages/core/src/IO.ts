import { Schema } from "effect";

export const IoId = Schema.String.pipe(Schema.brand("IoId"));
export type IoId = typeof IoId.Type;
