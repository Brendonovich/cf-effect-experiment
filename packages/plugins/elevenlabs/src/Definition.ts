import { Engine } from "@macrograph/plugin";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const defaultModel = "eleven_multilingual_v2";
const UnitInterval = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

export const SpeechOptions = Schema.Struct({
  language_code: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-z]{2}$/))),
  voice_settings: Schema.optionalKey(
    Schema.Struct({
      stability: Schema.optionalKey(UnitInterval),
      similarity_boost: Schema.optionalKey(UnitInterval),
      style: Schema.optionalKey(UnitInterval),
      use_speaker_boost: Schema.optionalKey(Schema.Boolean),
      speed: Schema.optionalKey(
        Schema.Number.check(Schema.isBetween({ minimum: 0.7, maximum: 1.2 })),
      ),
    }),
  ),
  seed: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 4294967295 })),
  ),
  previous_text: Schema.optionalKey(Schema.String),
  next_text: Schema.optionalKey(Schema.String),
});

export const SpeechRequest = Schema.Struct({
  text: Schema.String,
  modelId: Schema.String,
  voiceId: Schema.String,
  body: Schema.String,
});
export const SpeechResult = Schema.Struct({ audio: Schema.String, mime: Schema.String });

export class RequestFailure extends Schema.TaggedError<RequestFailure>()(
  "ElevenLabsRequestFailure",
  {
    reason: Schema.Literals([
      "API key is not configured",
      "Invalid input",
      "Request failed",
      "Provider rejected request",
      "Invalid provider response",
      "Request timed out",
    ]),
    status: Schema.optionalKey(Schema.Number),
  },
) {}

export const RuntimeStorage = Schema.Struct({ apiKey: Schema.NullOr(Schema.String) });
export const ClientState = Schema.Struct({ configured: Schema.Boolean });

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("ElevenLabsUpdateKey", {
    payload: Schema.Struct({ apiKey: Schema.String }),
    error: RequestFailure,
  }),
  Rpc.make("ElevenLabsClearKey"),
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("ElevenLabsTTS", {
    payload: SpeechRequest,
    success: SpeechResult,
    error: RequestFailure,
  }),
) {}

export class ElevenLabsEngine extends Engine.make({
  storage: RuntimeStorage,
  initialStorage: { apiKey: null },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
