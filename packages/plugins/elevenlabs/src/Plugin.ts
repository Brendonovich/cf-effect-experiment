import { DataType, Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import { defaultModel, ElevenLabsEngine } from "./Definition.ts";

export default Plugin.make({
  id: "elevenlabs",
  name: "ElevenLabs",
  engine: ElevenLabsEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "ElevenLabsTTS",
      name: "ElevenLabs TTS",
      description: "Synthesizes MP3 audio and returns base64, without writing a local file.",
      io: (io) => ({
        text: io.data.in("text", DataType.String, { name: "Text" }),
        modelId: io.data.in("modelId", DataType.String, {
          name: "Model ID",
          defaultValue: defaultModel,
        }),
        voiceId: io.data.in("voiceId", DataType.String, { name: "Voice ID" }),
        body: io.data.in("body", DataType.String, { name: "Options JSON", defaultValue: "{}" }),
        audio: io.data.out("audio", DataType.String, { name: "Audio Base64" }),
        mime: io.data.out("mime", DataType.String, { name: "MIME Type" }),
      }),
      run: ({ io, engine }) =>
        engine
          .ElevenLabsTTS({ text: io.text, modelId: io.modelId, voiceId: io.voiceId, body: io.body })
          .pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                io.audio(result.audio);
                io.mime(result.mime);
              }),
            ),
            Effect.asVoid,
          ),
    });
  }),
});
