import { Engine } from "@macrograph/module";
import { Layer } from "effect";

import GitHubEngineLive, { unavailableWebhookEndpoints } from "./Engine.ts";
import GitHubModule from "./Module.ts";

export default Engine.deployment(
  GitHubModule,
  GitHubEngineLive.pipe(Layer.provide(unavailableWebhookEndpoints)),
);
