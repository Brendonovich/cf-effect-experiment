import { Engine } from "@macrograph/plugin";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const defaultChatModel = "gpt-4o-mini";
export const defaultImageModel = "gpt-image-1";

export const ChatHistory = Schema.Array(
  Schema.Struct({
    role: Schema.Literals(["system", "developer", "user", "assistant"]),
    content: Schema.String,
  }),
);

export const ChatRequest = Schema.Struct({
  message: Schema.String,
  model: Schema.String,
  historyIn: Schema.String,
});
export const ChatResult = Schema.Struct({ response: Schema.String, historyOut: Schema.String });

export const ImageModel = Schema.Literals([
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "dall-e-2",
  "dall-e-3",
]);
export const ImageRequest = Schema.Struct({ prompt: Schema.String, model: Schema.String });
export const ImageResult = Schema.Struct({
  url: Schema.NullOr(Schema.String),
  base64: Schema.NullOr(Schema.String),
  mime: Schema.String,
  revised: Schema.NullOr(Schema.String),
});

export class RequestFailure extends Schema.TaggedError<RequestFailure>()("OpenAIRequestFailure", {
  operation: Schema.Literals(["chat", "image", "settings"]),
  reason: Schema.Literals([
    "API key is not configured",
    "Invalid input",
    "Request failed",
    "Provider rejected request",
    "Invalid provider response",
    "Request timed out",
  ]),
  status: Schema.optionalKey(Schema.Number),
}) {}

export const RuntimeStorage = Schema.Struct({ apiKey: Schema.NullOr(Schema.String) });
export const ClientState = Schema.Struct({ configured: Schema.Boolean });

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("OpenAIUpdateKey", {
    payload: Schema.Struct({ apiKey: Schema.String }),
    error: RequestFailure,
  }),
  Rpc.make("OpenAIClearKey"),
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("OpenAIChat", { payload: ChatRequest, success: ChatResult, error: RequestFailure }),
  Rpc.make("OpenAIImage", { payload: ImageRequest, success: ImageResult, error: RequestFailure }),
) {}

export class OpenAIEngine extends Engine.make({
  storage: RuntimeStorage,
  initialStorage: { apiKey: null },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
