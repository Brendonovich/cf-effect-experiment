import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect, Schema } from "effect";

import { RequestFailed, VTubeStudioEngine, VTubeStudioInstance } from "./Definition.ts";

const properties = {
  instance: { name: "VTube Studio Instance", resource: VTubeStudioInstance },
} as const;
export const ids = [
  "AvailableModels",
  "LoadModel",
  "ExpressionState",
  "ToggleExpression",
  "GetHotkeyList",
  "ExecuteHotkey",
] as const;
export default Plugin.make({
  id: "vtube-studio",
  name: "VTube Studio",
  engine: VTubeStudioEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "AvailableModels",
      name: "Available Models",
      properties,
      description: "Returns the available model objects as a JSON array string.",
      io: (io) => ({ models: io.data.out("models", DataType.String, { name: "Models (JSON)" }) }),
      run: ({ io, properties, engine }) =>
        engine.Call({ url: properties.instance, requestType: "AvailableModels", data: {} }).pipe(
          Effect.flatMap((response) =>
            Array.isArray(response.availableModels)
              ? Effect.sync(() => io.models(JSON.stringify(response.availableModels)))
              : Effect.fail(
                  new RequestFailed({
                    requestType: "AvailableModels",
                    reason: "Invalid model list.",
                  }),
                ),
          ),
        ),
    });
    yield* context.schema.register({
      id: "LoadModel",
      name: "Load Model",
      properties,
      description: "Loads a model by its modelID string from Available Models.",
      io: (io) => ({
        model: io.data.in("model", DataType.String, {
          name: "Model ID",
          defaultValue: "",
          suggestions: ({ properties, engine }) =>
            engine
              .Call({ url: properties.instance, requestType: "AvailableModels", data: {} })
              .pipe(
                Effect.flatMap((response) =>
                  Schema.decodeUnknownEffect(
                    Schema.Array(Schema.Struct({ modelID: Schema.String })),
                  )(response.availableModels).pipe(
                    Effect.mapError(
                      () =>
                        new RequestFailed({
                          requestType: "AvailableModels",
                          reason: "Invalid model list.",
                        }),
                    ),
                  ),
                ),
                Effect.map((models) => models.map((model) => model.modelID)),
              ),
        }),
      }),
      run: ({ io, properties, engine }) =>
        engine
          .Call({ url: properties.instance, requestType: "ModelLoad", data: { modelID: io.model } })
          .pipe(Effect.asVoid),
    });
    yield* context.schema.register({
      id: "ExpressionState",
      name: "Expression State",
      properties,
      description:
        "Returns current expression objects as a JSON array string, without parameter details.",
      io: (io) => ({
        expressions: io.data.out("expressions", DataType.String, { name: "Expressions (JSON)" }),
      }),
      run: ({ io, properties, engine }) =>
        engine
          .Call({
            url: properties.instance,
            requestType: "ExpressionState",
            data: { details: false },
          })
          .pipe(
            Effect.flatMap((response) =>
              Array.isArray(response.expressions)
                ? Effect.sync(() => io.expressions(JSON.stringify(response.expressions)))
                : Effect.fail(
                    new RequestFailed({
                      requestType: "ExpressionState",
                      reason: "Invalid expression list.",
                    }),
                  ),
            ),
          ),
    });
    yield* context.schema.register({
      id: "ToggleExpression",
      name: "Toggle Expression",
      properties,
      description: "Sets an expression file's active state to the supplied boolean.",
      io: (io) => ({
        file: io.data.in("file", DataType.String, {
          name: "Expression File",
          defaultValue: "",
          suggestions: ({ properties, engine }) =>
            engine
              .Call({
                url: properties.instance,
                requestType: "ExpressionState",
                data: { details: false },
              })
              .pipe(
                Effect.flatMap((response) =>
                  Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ file: Schema.String })))(
                    response.expressions,
                  ).pipe(
                    Effect.mapError(
                      () =>
                        new RequestFailed({
                          requestType: "ExpressionState",
                          reason: "Invalid expression list.",
                        }),
                    ),
                  ),
                ),
                Effect.map((expressions) => expressions.map((expression) => expression.file)),
              ),
        }),
        active: io.data.in("active", DataType.Bool, { name: "Active", defaultValue: false }),
      }),
      run: ({ io, properties, engine }) =>
        engine
          .Call({
            url: properties.instance,
            requestType: "ExpressionActivation",
            data: { expressionFile: io.file, active: io.active },
          })
          .pipe(Effect.asVoid),
    });
    yield* context.schema.register({
      id: "GetHotkeyList",
      name: "Get Hotkey List",
      properties,
      description:
        "Returns current model hotkey objects as a JSON array string. Use hotkeyID to execute one.",
      io: (io) => ({
        hotkeys: io.data.out("hotkeys", DataType.String, { name: "Hotkeys (JSON)" }),
      }),
      run: ({ io, properties, engine }) =>
        engine
          .Call({ url: properties.instance, requestType: "HotkeysInCurrentModel", data: {} })
          .pipe(
            Effect.flatMap((response) =>
              Array.isArray(response.availableHotkeys)
                ? Effect.sync(() => io.hotkeys(JSON.stringify(response.availableHotkeys)))
                : Effect.fail(
                    new RequestFailed({
                      requestType: "HotkeysInCurrentModel",
                      reason: "Invalid hotkey list.",
                    }),
                  ),
            ),
          ),
    });
    yield* context.schema.register({
      id: "ExecuteHotkey",
      name: "Execute Hotkey",
      properties,
      description: "Executes a hotkey using its hotkeyID string from Get Hotkey List.",
      io: (io) => ({
        id: io.data.in("id", DataType.String, {
          name: "Hotkey ID",
          defaultValue: "",
          suggestions: ({ properties, engine }) =>
            engine
              .Call({ url: properties.instance, requestType: "HotkeysInCurrentModel", data: {} })
              .pipe(
                Effect.flatMap((response) =>
                  Schema.decodeUnknownEffect(
                    Schema.Array(Schema.Struct({ hotkeyID: Schema.String })),
                  )(response.availableHotkeys).pipe(
                    Effect.mapError(
                      () =>
                        new RequestFailed({
                          requestType: "HotkeysInCurrentModel",
                          reason: "Invalid hotkey list.",
                        }),
                    ),
                  ),
                ),
                Effect.map((hotkeys) => hotkeys.map((hotkey) => hotkey.hotkeyID)),
              ),
        }),
      }),
      run: ({ io, properties, engine }) =>
        engine
          .Call({
            url: properties.instance,
            requestType: "HotkeyTrigger",
            data: { hotkeyID: io.id },
          })
          .pipe(Effect.asVoid),
    });
  }),
});
