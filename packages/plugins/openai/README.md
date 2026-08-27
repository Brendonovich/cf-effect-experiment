# OpenAI

Runtime-compatible adaptation of MacroGraph's OpenAI package. Import the plugin from
`@macrograph/plugin-openai`, its deployment from `/Deployment`, and editor settings
from `/Settings` (`settings` export). `/Definition` exports RPC/storage schemas and
`/Engine` exports the implementation layer. The host must provide the engine context
and Effect `HttpClient`; no OpenAI SDK or browser-side provider calls are used.

## Schemas

- `ChatGPTMessage`: inputs `message`, `model` (default `gpt-4o-mini`), and `historyIn`
  (JSON string, default `[]`). Outputs `response` and `historyOut` (updated JSON).
- `DallEImageGeneration`: inputs `prompt` and `model` (default `gpt-image-1`). Outputs
  optional `url`, optional `base64`, `mime` (`image/png`), and optional `revised` prompt.

Chat history must be an array of `{ "role": "user", "content": "Hello" }` objects.
Supported roles are `system`, `developer`, `user`, and `assistant`; unknown fields
are rejected. The message is appended as a user message and the returned assistant
message is included in `historyOut`. History is caller-managed, not engine storage.
Chat is **non-streaming**: unsupported legacy streaming/completion scopes have been
replaced by one normal execution continuation. Tools, multimodal messages, and
structured map pins are not implemented.

Images use one 1024x1024 image. `gpt-image-1`, `gpt-image-1-mini`, and `gpt-image-1.5`
return base64 PNG with no URL. Legacy `dall-e-2` and `dall-e-3` request a temporary
provider URL instead; only DALL-E 3 sends `style: vivid`. Legacy model availability
depends on OpenAI and may be discontinued. URLs are returned as data, never fetched.
This differs from the original always-DALL-E-3, required-URL output contract.

## Security And Failures

API keys are persisted in server-side engine storage, not in graph pins or browser
storage. `ClientState` contains only `{ configured: boolean }`. Password settings
call `OpenAIUpdateKey` or `OpenAIClearKey`; neither RPC returns the key. Storage is
not encrypted by this plugin: secure the host's storage and transport accordingly.
Updating a key does not test its validity with the provider.

Requests only use `https://api.openai.com`, with redirects disabled and a 60-second
timeout covering request and response consumption. Successful responses are
validated, and authorization headers are redacted in Effect HTTP traces.
`OpenAIRequestFailure` contains an operation, a fixed safe reason, and
optionally an HTTP status, never a credential, transport cause, or provider error
body. Requests are not retried automatically to avoid duplicate billable work.

Run `pnpm --filter @macrograph/plugin-openai exec vitest run` and `pnpm typecheck` after
workspace dependency installation.
