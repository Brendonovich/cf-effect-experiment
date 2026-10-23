import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Effect } from "effect";

import { OpenCodeConnection, OpenCodeEngine } from "./Definition.ts";

export default Module.make({
  id: "opencode",
  name: "OpenCode",
  description: "Generates model-agnostic text through OpenCode.",
  engine: OpenCodeEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "GenerateText",
      name: "Generate Text",
      description:
        "Runs one stateless generation on the selected OpenCode connection. Leave Model empty to use OpenCode's default.",
      properties: { connection: { name: "Connection", resource: OpenCodeConnection } },
      io: (io) => ({
        prompt: io.data.in("prompt", t.String, { name: "Prompt" }),
        model: io.data.in("model", t.String, {
          name: "Model",
          defaultValue: "",
          suggestions: ({ engine, properties }) =>
            engine.OpenCodeListModels({ connectionId: properties.connection }),
        }),
        response: io.data.out("response", t.String, { name: "Response" }),
      }),
      run: ({ io, engine, properties }) =>
        engine
          .OpenCodeGenerateText({
            connectionId: properties.connection,
            prompt: io.prompt,
            model: io.model,
          })
          .pipe(
            Effect.tap((response) => Effect.sync(() => io.response(response))),
            Effect.asVoid,
          ),
    });
  }),
});
