import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import { VoicemodEngine } from "./Definition.ts";

export const ids = ["SetVoice", "SetVoiceChangerState", "SetHearSelfState"] as const;
export default Plugin.make({
  id: "voicemod",
  name: "Voicemod",
  engine: VoicemodEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "SetVoice",
      name: "Set Voice",
      description:
        "Selects an available voice by ID or friendly name, querying the live voice list.",
      io: (io) => ({
        voice: io.data.in("voice", DataType.String, {
          name: "Voice ID or Name",
          defaultValue: "",
          suggestions: ({ engine }) =>
            engine
              .GetVoices()
              .pipe(
                Effect.map((voices) =>
                  voices.filter((voice) => voice.enabled !== false).map((voice) => voice.id),
                ),
              ),
        }),
      }),
      run: ({ io, engine }) => engine.SetVoice({ voice: io.voice }),
    });
    yield* context.schema.register({
      id: "SetVoiceChangerState",
      name: "Set Voice Changer State",
      description:
        "Queries the live voice changer state and toggles only when it differs from the requested state.",
      io: (io) => ({
        state: io.data.in("state", DataType.Bool, { name: "State", defaultValue: false }),
      }),
      run: ({ io, engine }) => engine.SetVoiceChangerState({ state: io.state }),
    });
    yield* context.schema.register({
      id: "SetHearSelfState",
      name: "Set Hear Self State",
      description:
        "Queries the live hear-self state and toggles only when it differs from the requested state.",
      io: (io) => ({
        state: io.data.in("state", DataType.Bool, { name: "State", defaultValue: false }),
      }),
      run: ({ io, engine }) => engine.SetHearSelfState({ state: io.state }),
    });
  }),
});
