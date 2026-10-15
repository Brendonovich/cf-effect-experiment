import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Effect } from "effect";

import { OpenCodeEngine } from "./Definition.ts";

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
        "Runs one stateless OpenCode generation. Leave Model empty to use OpenCode's default.",
      io: (io) => ({
        prompt: io.data.in("prompt", t.String, { name: "Prompt" }),
        model: io.data.in("model", t.String, {
          name: "Model",
          defaultValue: "",
          suggestions: ({ engine }) => engine.OpenCodeListModels(),
        }),
        response: io.data.out("response", t.String, { name: "Response" }),
      }),
      run: ({ io, engine }) =>
        engine.OpenCodeGenerateText({ prompt: io.prompt, model: io.model }).pipe(
          Effect.tap((response) => Effect.sync(() => io.response(response))),
          Effect.asVoid,
        ),
    });
  }),
});
