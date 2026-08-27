import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, Result } from "effect";

import { RequestFailed, SocketAddress } from "../src/Definition.ts";
import OBSPlugin from "../src/Plugin.ts";

const resolver = Effect.fnUntraced(function* (
  schemaId: string,
  inputId: string,
) {
  const schemas = yield* Registration.collect(OBSPlugin.effect);
  const input = schemas
    .find(({ id }) => id === schemaId)
    ?.dataInputs.find(({ id }) => id === inputId);
  assert.isDefined(input?.suggestions, `${schemaId}.${inputId}`);
  return input.suggestions;
});

type Call = {
  readonly address: SocketAddress;
  readonly requestType: string;
  readonly requestData?: Readonly<Record<string, unknown>>;
};

describe("OBS suggestions", () => {
  it.effect("resolves each list family through the selected socket", () =>
    Effect.gen(function* () {
      const responses: Readonly<Record<string, unknown>> = {
        GetSceneCollectionList: { sceneCollections: ["Default", "Live"] },
        GetSceneList: {
          scenes: [{ sceneName: "Intro" }, { sceneName: "Live" }],
        },
        GetInputList: {
          inputs: [{ inputName: "Mic" }, { inputName: "Camera" }],
        },
        GetInputKindList: { inputKinds: ["image_source", "browser_source"] },
        GetSourceFilterKindList: {
          sourceFilterKinds: ["color_filter", "gain_filter"],
        },
        GetVersion: { supportedImageFormats: ["png", "jpg"] },
      };
      const cases = [
        [
          "SetCurrentSceneCollection",
          "sceneCollectionName",
          ["GetSceneCollectionList"],
          ["Default", "Live"],
        ],
        [
          "SetCurrentProgramScene",
          "sceneName",
          ["GetSceneList"],
          ["Intro", "Live"],
        ],
        ["SetInputVolume", "inputName", ["GetInputList"], ["Mic", "Camera"]],
        [
          "CreateInput",
          "inputKind",
          ["GetInputKindList"],
          ["image_source", "browser_source"],
        ],
        [
          "GetInputDefaultSettings",
          "inputKind",
          ["GetInputKindList"],
          ["image_source", "browser_source"],
        ],
        [
          "CreateSourceFilter",
          "filterKind",
          ["GetSourceFilterKindList"],
          ["color_filter", "gain_filter"],
        ],
        ["SaveSourceScreenshot", "imageFormat", ["GetVersion"], ["png", "jpg"]],
        [
          "CreateSceneItem",
          "sourceName",
          ["GetSceneList", "GetInputList"],
          ["Intro", "Live", "Mic", "Camera"],
        ],
      ] as const;
      for (const [schemaId, inputId, requestTypes, expected] of cases) {
        const suggest = yield* resolver(schemaId, inputId);
        for (const url of ["ws://localhost:4455", "ws://localhost:4456"]) {
          const address = SocketAddress.make(url);
          const calls: Array<Call> = [];
          assert.deepStrictEqual(
            yield* suggest({
              properties: { socket: address },
              inputDefaults: {},
              engine: {
                Call: (payload: Call) =>
                  Effect.sync(() => {
                    calls.push(payload);
                    return responses[payload.requestType];
                  }),
              },
            }),
            expected,
          );
          assert.deepStrictEqual(
            calls,
            requestTypes.map((requestType) => ({ address, requestType })),
          );
        }
      }
    }),
  );

  it.effect(
    "uses the latest source and scene defaults for dependent lists",
    () =>
      Effect.gen(function* () {
        const cases = [
          [
            "SetSourceFilterIndex",
            "filterName",
            "sourceName",
            "GetSourceFilterList",
            "filters",
            "filterName",
          ],
          [
            "GetSceneItemId",
            "sourceName",
            "sceneName",
            "GetSceneItemList",
            "sceneItems",
            "sourceName",
          ],
        ] as const;
        const address = SocketAddress.make("ws://localhost:4455");
        for (const [
          schemaId,
          inputId,
          dependency,
          requestType,
          list,
          name,
        ] of cases) {
          const suggest = yield* resolver(schemaId, inputId);
          const calls: Array<Call> = [];
          for (const value of ["First", "Second"]) {
            assert.deepStrictEqual(
              yield* suggest({
                properties: { socket: address },
                inputDefaults: { [dependency]: value },
                engine: {
                  Call: (payload: Call) =>
                    Effect.sync(() => {
                      calls.push(payload);
                      return {
                        [list]: [
                          {
                            [name]: `${payload.requestData?.[dependency]} result`,
                          },
                        ],
                      };
                    }),
                },
              }),
              [`${value} result`],
            );
          }
          assert.deepStrictEqual(
            calls,
            ["First", "Second"].map((value) => ({
              address,
              requestType,
              requestData: { [dependency]: value },
            })),
          );
        }
      }),
  );

  it.effect(
    "does not call OBS when a dependency is absent, empty, or non-string",
    () =>
      Effect.gen(function* () {
        for (const [schemaId, inputId, dependency] of [
          ["GetSourceFilter", "filterName", "sourceName"],
          ["GetSceneItemId", "sourceName", "sceneName"],
        ] as const) {
          const suggest = yield* resolver(schemaId, inputId);
          const calls: Array<Call> = [];
          for (const value of [undefined, null, "", 42, false, {}, []]) {
            assert.deepStrictEqual(
              yield* suggest({
                properties: {
                  socket: SocketAddress.make("ws://localhost:4455"),
                },
                inputDefaults:
                  value === undefined ? {} : { [dependency]: value },
                engine: {
                  Call: (payload: Call) =>
                    Effect.sync(() => calls.push(payload)),
                },
              }),
              [],
            );
          }
          assert.deepStrictEqual(calls, []);
        }
      }),
  );

  it.effect(
    "keeps creation and renamed names freeform and wires current pins",
    () =>
      Effect.gen(function* () {
        const schemas = yield* Registration.collect(OBSPlugin.effect);
        for (const [schemaId, inputId] of [
          ["CreateSceneCollection", "sceneCollectionName"],
          ["CreateScene", "sceneName"],
          ["CreateInput", "inputName"],
          ["CreateSourceFilter", "filterName"],
          ["SetSceneName", "newSceneName"],
          ["SetInputName", "newInputName"],
          ["SetSourceFilterName", "newFilterName"],
          ["SaveSourceScreenshot", "imageFilePath"],
          ["GetGroupSceneItemList", "sceneName"],
        ]) {
          const input = schemas
            .find(({ id }) => id === schemaId)
            ?.dataInputs.find(({ id }) => id === inputId);
          assert.isDefined(input, `${schemaId}.${inputId}`);
          assert.isUndefined(input.suggestions, `${schemaId}.${inputId}`);
        }
        for (const [schemaId, inputId] of [
          ["SetSceneSceneTransitionOverride", "sceneName"],
          ["SetCurrentPreviewScene", "sceneName"],
          ["RemoveScene", "sceneName"],
          ["SetSceneName", "sceneName"],
          ["CreateInput", "sceneName"],
          ["GetSceneItemList", "sceneName"],
          ["GetSceneItemSource", "sceneName"],
          ["DuplicateSceneItem", "destinationSceneName"],
          ["SetSceneItemTransform", "sceneName"],
          ["SetSceneItemEnabled", "sceneName"],
          ["SetSceneItemLocked", "sceneName"],
          ["SetSceneItemIndex", "sceneName"],
          ["SetSceneItemBlendMode", "sceneName"],
          ["RemoveInput", "inputName"],
          ["SetInputName", "inputName"],
          ["GetInputSettings", "inputName"],
          ["SetInputSettings", "inputName"],
          ["GetInputMute", "inputName"],
          ["SetInputMute", "inputName"],
          ["ToggleInputMute", "inputName"],
          ["GetInputVolume", "inputName"],
          ["CreateSourceFilter", "sourceName"],
          ["RemoveSourceFilter", "filterName"],
          ["SetSourceFilterName", "filterName"],
          ["SetSourceFilterSettings", "filterName"],
          ["SetSourceFilterEnabled", "filterName"],
        ]) {
          const input = schemas
            .find(({ id }) => id === schemaId)
            ?.dataInputs.find(({ id }) => id === inputId);
          assert.isDefined(input?.suggestions, `${schemaId}.${inputId}`);
          assert.strictEqual(input.type._tag, "String");
        }
        const destination = schemas
          .find(({ id }) => id === "DuplicateSceneItem")
          ?.dataInputs.find(({ id }) => id === "destinationSceneName");
        assert.strictEqual(destination?.defaultValue, "");
        assert.isTrue(
          schemas.every(({ dataOutputs }) =>
            dataOutputs.every((output) => !("suggestions" in output)),
          ),
        );
      }),
  );

  it.effect("only returns strings from OBS's unknown response payloads", () =>
    Effect.gen(function* () {
      for (const [schemaId, inputId, list, values] of [
        [
          "SetCurrentProgramScene",
          "sceneName",
          "scenes",
          [{ sceneName: "Live" }, null, {}, { sceneName: 42 }, "wrong"],
        ],
        [
          "SaveSourceScreenshot",
          "imageFormat",
          "supportedImageFormats",
          ["png", null, 42, {}, false],
        ],
      ] as const) {
        const suggest = yield* resolver(schemaId, inputId);
        for (const response of [
          null,
          {},
          { [list]: "not a list" },
          { [list]: values },
        ]) {
          assert.deepStrictEqual(
            yield* suggest({
              properties: { socket: SocketAddress.make("ws://localhost:4455") },
              inputDefaults: {},
              engine: { Call: () => Effect.succeed(response) },
            }),
            response !== null && list in response && response[list] === values
              ? [schemaId === "SetCurrentProgramScene" ? "Live" : "png"]
              : [],
          );
        }
      }
    }),
  );

  it.effect("propagates RPC failures to the suggestions pipeline", () =>
    Effect.gen(function* () {
      const suggest = yield* resolver("SetCurrentProgramScene", "sceneName");
      const error = new RequestFailed({
        requestType: "GetSceneList",
        code: 500,
      });
      const result = yield* Effect.result(
        suggest({
          properties: { socket: SocketAddress.make("ws://localhost:4455") },
          inputDefaults: {},
          engine: { Call: () => Effect.fail(error) },
        }),
      );
      if (Result.isFailure(result)) assert.strictEqual(result.failure, error);
      else assert.fail("Expected the OBS request failure");
    }),
  );
});
