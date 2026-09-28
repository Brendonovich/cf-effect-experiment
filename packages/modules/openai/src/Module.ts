import { t, Module } from "@macrograph/module";
import { Effect, Option } from "effect";

import { defaultChatModel, defaultImageModel, OpenAIEngine } from "./Definition.ts";

export default Module.make({
  id: "openai",
  name: "OpenAI",
  engine: OpenAIEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "ChatGPTMessage",
      name: "ChatGPT Message",
      description: "Returns a non-streaming chat completion and updated JSON history.",
      io: (io) => ({
        message: io.data.in("message", t.String, { name: "Message" }),
        model: io.data.in("model", t.String, {
          name: "Model",
          defaultValue: defaultChatModel,
        }),
        historyIn: io.data.in("historyIn", t.String, {
          name: "Chat History",
          defaultValue: "[]",
        }),
        response: io.data.out("response", t.String, { name: "Response" }),
        historyOut: io.data.out("historyOut", t.String, { name: "Chat History JSON" }),
      }),
      run: ({ io, engine }) =>
        engine.OpenAIChat({ message: io.message, model: io.model, historyIn: io.historyIn }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              io.response(result.response);
              io.historyOut(result.historyOut);
            }),
          ),
          Effect.asVoid,
        ),
    });
    yield* context.schema.register({
      id: "DallEImageGeneration",
      name: "Dall E Image Generation",
      description:
        "Generates a PNG with GPT Image, or a temporary image URL with legacy DALL-E models.",
      io: (io) => ({
        prompt: io.data.in("prompt", t.String, { name: "Prompt" }),
        model: io.data.in("model", t.String, {
          name: "Model",
          defaultValue: defaultImageModel,
        }),
        url: io.data.out("url", t.Option(t.String), { name: "Image URL" }),
        base64: io.data.out("base64", t.Option(t.String), { name: "Image Base64" }),
        mime: io.data.out("mime", t.String, { name: "MIME Type" }),
        revised: io.data.out("revised", t.Option(t.String), {
          name: "Revised Prompt",
        }),
      }),
      run: ({ io, engine }) =>
        engine.OpenAIImage({ prompt: io.prompt, model: io.model }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              io.url(Option.fromNullOr(result.url));
              io.base64(Option.fromNullOr(result.base64));
              io.mime(result.mime);
              io.revised(Option.fromNullOr(result.revised));
            }),
          ),
          Effect.asVoid,
        ),
    });
  }),
});
