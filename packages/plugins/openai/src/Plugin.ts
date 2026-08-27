import { DataType, Plugin } from "@macrograph/plugin";
import { Effect, Option } from "effect";

import { defaultChatModel, defaultImageModel, OpenAIEngine } from "./Definition.ts";

export default Plugin.make({
  id: "openai",
  name: "OpenAI",
  engine: OpenAIEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "ChatGPTMessage",
      name: "ChatGPT Message",
      description: "Returns a non-streaming chat completion and updated JSON history.",
      io: (io) => ({
        message: io.data.in("message", DataType.String, { name: "Message" }),
        model: io.data.in("model", DataType.String, {
          name: "Model",
          defaultValue: defaultChatModel,
        }),
        historyIn: io.data.in("historyIn", DataType.String, {
          name: "Chat History JSON",
          defaultValue: "[]",
        }),
        response: io.data.out("response", DataType.String, { name: "Response" }),
        historyOut: io.data.out("historyOut", DataType.String, { name: "Chat History JSON" }),
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
        prompt: io.data.in("prompt", DataType.String, { name: "Prompt" }),
        model: io.data.in("model", DataType.String, {
          name: "Model",
          defaultValue: defaultImageModel,
        }),
        url: io.data.out("url", DataType.Option(DataType.String), { name: "Image URL" }),
        base64: io.data.out("base64", DataType.Option(DataType.String), { name: "Image Base64" }),
        mime: io.data.out("mime", DataType.String, { name: "MIME Type" }),
        revised: io.data.out("revised", DataType.Option(DataType.String), {
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
