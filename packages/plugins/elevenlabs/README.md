# ElevenLabs

Runtime-compatible adaptation of MacroGraph's ElevenLabs package. Import the plugin
from `@macrograph/plugin-elevenlabs`, its deployment from `/Deployment`, and editor
settings from `/Settings` (`settings` export). `/Definition` exports RPC/storage
schemas and `/Engine` exports the implementation layer. The host must provide the
engine context and Effect `HttpClient`.

## Text To Speech

Schema `ElevenLabsTTS` has inputs `text`, `voiceId`, `modelId` (default
`eleven_multilingual_v2`), and `body` (options JSON string, default `{}`). Outputs
are `audio` (base64 string) and `mime` (`audio/mpeg`). The request explicitly selects
MP3 `mp3_44100_128`. The model is configurable and the voice ID must consist of
letters, digits, underscores, or hyphens.

The JSON options use ElevenLabs' API field names:

```json
{
  "language_code": "en",
  "voice_settings": {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0.1,
    "use_speaker_boost": true,
    "speed": 1
  },
  "seed": 42,
  "previous_text": "Previous sentence.",
  "next_text": "Next sentence."
}
```

All options are optional. Stability, similarity boost, and style must be between
0 and 1; speed between 0.7 and 1.2; seed an unsigned 32-bit integer; language code
two lowercase letters. Unknown fields, including attempts to override text/model
or HTTP configuration, are rejected. Structured/map pins are unavailable in the
current runtime, so the original structured body is represented by JSON instead.

**Native file writes are deferred.** The original `filePath` input and optional
`filePathOut` output are intentionally not reproduced. This plugin never writes
files, plays audio, or streams execution scopes. A future native-capability plugin
can consume the base64 audio. Audio is fully buffered, so large requests incur
memory and RPC payload costs; base64 adds roughly one third to the byte size.

## Security And Failures

Keys live in server-side engine storage. `ClientState` contains only
`{ configured: boolean }`; password settings call `ElevenLabsUpdateKey` or
`ElevenLabsClearKey`, neither of which returns the key. The plugin does not encrypt
host storage or test a key on update. Secure host storage and transport accordingly.

Requests only use `https://api.elevenlabs.io`, with redirects disabled and a
60-second timeout covering request and response consumption. Nonempty audio and
the expected MIME type are validated; `xi-api-key` is explicitly redacted in Effect
HTTP traces. `ElevenLabsRequestFailure` exposes only a
fixed safe reason and optional HTTP status, never credentials, transport causes,
or provider error bodies. There are no automatic retries of billable requests.

Run `pnpm --filter @macrograph/plugin-elevenlabs exec vitest run` and `pnpm typecheck`
after workspace dependency installation.
