import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, Result } from "effect";

import { count, events, ids, requests } from "../src/Catalog.ts";
import { OBSSocket, SocketAddress } from "../src/Definition.ts";
import {
  CurrentProgramSceneChanged,
  SceneCollectionListChanged,
} from "../src/Events.ts";
import * as ObsEvent from "../src/Events.ts";
import OBSPlugin from "../src/Plugin.ts";
import { canvasRequests } from "../src/Protocol.ts";

const execution = {
  projectId: "project",
  graphId: "graph",
  eventNodeId: "event",
  traceId: "trace",
};
const node = {
  nodeId: "node",
  kind: "exec" as const,
  executionPath: "node",
  traceId: "trace",
  withSpan: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
};

describe("OBS catalog", () => {
  it.effect("registers the exact active catalog without duplicates", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(OBSPlugin.effect);
      assert.strictEqual(requests.length, 148);
      assert.strictEqual(events.length, 60);
      assert.strictEqual(count, 209);
      assert.strictEqual(ids.length, 209);
      assert.strictEqual(new Set(ids).size, 209);
      assert.strictEqual(schemas.length, 209);
      assert.deepStrictEqual(
        schemas.map(({ id }) => id),
        [...ids],
      );
      assert.strictEqual(new Set(schemas.map(({ id }) => id)).size, 209);
      assert.isTrue(
        schemas.every(({ description }) => description !== undefined),
      );
      assert.deepStrictEqual(
        [
          "VirtualcamStateChanged",
          "GetSceneSceneTransitionOverride",
          "SetSceneSceneTransitionOverride",
          "GetSceneItemId",
          "SetTBarPosition",
        ].map((id) => [id, schemas.find((schema) => schema.id === id)?.name]),
        [
          ["VirtualcamStateChanged", "Virtual Camera State Changed"],
          ["GetSceneSceneTransitionOverride", "Get Scene Transition Override"],
          ["SetSceneSceneTransitionOverride", "Set Scene Transition Override"],
          ["GetSceneItemId", "Get Scene Item ID"],
          ["SetTBarPosition", "Set T-Bar Position"],
        ],
      );
      const profileList = schemas.find(({ id }) => id === "GetProfileList");
      assert.isDefined(profileList);
      assert.deepStrictEqual(
        profileList.dataOutputs.map(({ id, type }) => ({
          id,
          type: type._tag,
        })),
        [
          { id: "currentProfileName", type: "String" },
          { id: "profiles", type: "List" },
        ],
      );
      assert.isTrue(
        schemas
          .filter(({ id }) => id !== "RGBAHexToOBSColour")
          .every(
            ({ properties }) =>
              properties.length === 1 &&
              properties[0]?.id === "socket" &&
              "resource" in properties[0] &&
              properties[0].resource === OBSSocket.key,
          ),
      );
      for (const id of [
        "SetCurrentProgramScene",
        "SetSceneItemTransform",
        "SetInputMute",
        "SetSourceFilterSettings",
        "ToggleStream",
        "CreateRecordChapter",
        "ToggleReplayBuffer",
        "StartVirtualCam",
        "SetCurrentSceneTransition",
        "TriggerStudioModeTransition",
        "TriggerMediaInputAction",
        "StartOutput",
        "GetSourceScreenshot",
        "OpenSourceProjector",
        "TriggerHotkeyByName",
        "SetCurrentProfile",
        "SetCurrentSceneCollection",
        "CallVendorRequest",
        "SetPersistentData",
        "VendorEvent",
      ]) {
        assert.isTrue(
          schemas.some((schema) => schema.id === id),
          `missing ${id}`,
        );
      }
    }),
  );

  it.effect("maps the dB variant to SetInputVolume and preserves real ToggleOutput", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(OBSPlugin.effect);
      const address = SocketAddress.make("ws://localhost:4455");
      for (const [id, input, expected] of [
        [
          "SetInputVolumeDb",
          { inputName: "Mic", inputVolumeDb: -12.5 },
          {
            requestType: "SetInputVolume",
            requestData: { inputName: "Mic", inputVolumeDb: -12.5 },
          },
        ],
        [
          "SetInputVolume",
          { inputName: "Mic", inputVolumeMul: 0.25 },
          {
            requestType: "SetInputVolume",
            requestData: { inputName: "Mic", inputVolumeMul: 0.25 },
          },
        ],
        [
          "ToggleOutput",
          { outputName: "VirtualCam" },
          { requestType: "ToggleOutput", requestData: { outputName: "VirtualCam" } },
        ],
        ["GetCanvasList", {}, { requestType: "GetCanvasList" }],
      ] as const) {
        const schema = schemas.find((schema) => schema.id === id);
        assert.isDefined(schema);
        const values: Readonly<Record<string, unknown>> = input;
        const calls: Array<unknown> = [];
        const outputs = new Map<string, unknown>();
        yield* schema.run({
          input: (ref) => values[ref.id],
          output: (ref, value) => outputs.set(ref.id, value),
          properties: { socket: address },
          event: undefined,
          engine: {
            Call: (payload: unknown) =>
              Effect.sync(() => {
                calls.push(payload);
                return { canvases: [{ canvasName: "Portrait", canvasUuid: "canvas-1" }] };
              }),
          },
          execution,
          node,
        });
        assert.deepStrictEqual(calls, [{ address, ...expected }]);
        if (id === "GetCanvasList")
          assert.strictEqual(
            outputs.get("canvases"),
            '[{"canvasName":"Portrait","canvasUuid":"canvas-1"}]',
          );
      }
    }),
  );

  it.effect("adds optional canvas pins only to supported requests and omits empty values", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(OBSPlugin.effect);
      const address = SocketAddress.make("ws://localhost:4455");
      assert.strictEqual(canvasRequests.size, 36);
      for (const schema of schemas) {
        const canvas = schema.dataInputs.find(({ id }) => id === "canvasUuid");
        assert.strictEqual(canvas !== undefined, canvasRequests.has(schema.id));
        if (canvas === undefined) continue;
        assert.strictEqual(canvas.defaultValue, "");
        assert.isDefined(canvas.suggestions);
        for (const canvasUuid of ["", "canvas-1"]) {
          let payload: Readonly<Record<string, unknown>> | undefined;
          yield* schema.run({
            input: (ref) =>
              ref.id === "canvasUuid"
                ? canvasUuid
                : (ref.defaultValue ??
                  (ref.type._tag === "String" ? "{}" : ref.type._tag === "Bool" ? true : 1)),
            output: () => undefined,
            properties: { socket: address },
            event: undefined,
            engine: {
              Call: (value: { readonly requestData?: Readonly<Record<string, unknown>> }) =>
                Effect.sync(() => {
                  payload = value.requestData;
                }),
            },
            execution,
            node,
          });
          assert.strictEqual(payload?.canvasUuid, canvasUuid === "" ? undefined : canvasUuid);
          if (canvasUuid === "") assert.isFalse(Object.hasOwn(payload ?? {}, "canvasUuid"));
        }
      }
    }),
  );

  it.effect("converts RGBA hex to unsigned OBS ABGR without a connection", () =>
    Effect.gen(function* () {
      const schema = (yield* Registration.collect(OBSPlugin.effect)).find(
        ({ id }) => id === "RGBAHexToOBSColour",
      );
      assert.isDefined(schema);
      assert.strictEqual(schema.type, "pure");
      assert.deepStrictEqual(schema.properties, []);
      for (const [input, expected] of [
        ["11223344", 0x44332211],
        ["#ff0000ff", 0xff0000ff],
        ["FFFFFFFF", 0xffffffff],
        ["00000000", 0],
      ] as const) {
        let output: unknown;
        yield* schema.run({
          input: () => input,
          output: (_ref, value) => {
            output = value;
          },
          properties: {},
          event: undefined,
          engine: {},
          execution,
          node,
        });
        assert.strictEqual(output, expected);
      }
      for (const input of ["", "ff0000", "123456789", "zz0000ff", "1234567g"]) {
        const result = yield* Effect.result(
          schema.run({
            input: () => input,
            output: () => assert.fail("Invalid hex produced output"),
            properties: {},
            event: undefined,
            engine: {},
            execution,
            node,
          }),
        );
        assert.isTrue(Result.isFailure(result));
      }
    }),
  );

  it.effect("decodes and maps all new server events, including legacy UUID-free payloads", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(OBSPlugin.effect);
      const address = SocketAddress.make("ws://localhost:4455");
      const cases: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
        ["CanvasCreated", { canvasName: "Portrait", canvasUuid: "canvas-1" }],
        ["CanvasRemoved", { canvasName: "Portrait", canvasUuid: "canvas-1" }],
        [
          "CanvasNameChanged",
          { canvasName: "Portrait", oldCanvasName: "Old", canvasUuid: "canvas-1" },
        ],
        ["InputActiveStateChanged", { inputName: "Camera", videoActive: true }],
        ["InputShowStateChanged", { inputName: "Camera", videoShowing: false }],
        [
          "InputVolumeMeters",
          { inputs: [{ inputName: "Mic", inputLevelsMul: [[0.1, 0.2, 0.3]] }] },
        ],
        [
          "SceneItemTransformChanged",
          {
            sceneName: "Scene",
            sceneItemId: 3,
            sceneItemTransform: { positionX: 12.5, scaleX: 1.2 },
          },
        ],
      ];
      for (const [id, data] of cases) {
        const event = yield* ObsEvent.decode({ eventType: id, eventData: data }, address);
        const schema = schemas.find((schema) => schema.id === id);
        assert.isDefined(schema);
        assert.isTrue(yield* schema.matches(event, { socket: address }));
        assert.isFalse(
          yield* schema.matches(event, { socket: SocketAddress.make("ws://elsewhere:4455") }),
        );
        const outputs = new Map<string, unknown>();
        yield* schema.run({
          input: () => undefined,
          output: (ref, value) => outputs.set(ref.id, value),
          properties: { socket: address },
          event,
          engine: {},
          execution,
          node,
        });
        for (const [key, value] of Object.entries(data))
          assert.deepStrictEqual(
            outputs.get(key),
            typeof value === "object" ? JSON.stringify(value) : value,
          );
        if (id === "InputActiveStateChanged" || id === "InputShowStateChanged")
          assert.strictEqual(outputs.get("inputUuid"), "");
        if (id === "SceneItemTransformChanged") assert.strictEqual(outputs.get("sceneUuid"), "");
      }
    }),
  );

  it.effect("keeps request-specific IO and forwards typed request data", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(OBSPlugin.effect);
      const schema = schemas.find(({ id }) => id === "SetInputMute");
      assert.isDefined(schema);
      assert.deepStrictEqual(
        schema.dataInputs.map(({ id, type }) => ({ id, type: type._tag })),
        [
          { id: "inputName", type: "String" },
          { id: "inputMuted", type: "Bool" },
        ],
      );
      const address = SocketAddress.make("ws://localhost:4455");
      const calls: Array<unknown> = [];
      yield* schema.run({
        input: (ref) => (ref.id === "inputName" ? "Mic" : true),
        output: () => undefined,
        properties: { socket: address },
        event: undefined,
        engine: {
          Call: (payload: unknown) => Effect.sync(() => calls.push(payload)),
        },
        execution,
        node,
      });
      assert.deepStrictEqual(calls, [
        {
          address,
          requestType: "SetInputMute",
          requestData: { inputName: "Mic", inputMuted: true },
        },
      ]);
      assert.deepStrictEqual(
        schema.executionOutputs.map(({ id }) => id),
        ["exec"],
      );

      const vendor = schemas.find(({ id }) => id === "CallVendorRequest");
      assert.isDefined(vendor);
      assert.strictEqual(
        vendor.dataInputs.find(({ id }) => id === "requestData")?.defaultValue,
        "{}",
      );
      yield* vendor.run({
        input: (ref) =>
          ref.id === "vendorName"
            ? "vendor"
            : ref.id === "requestType"
              ? "request"
              : "{}",
        output: () => undefined,
        properties: { socket: address },
        event: undefined,
        engine: {
          Call: (payload: unknown) => Effect.sync(() => calls.push(payload)),
        },
        execution,
        node,
      });
      assert.deepStrictEqual(calls[1], {
        address,
        requestType: "CallVendorRequest",
        requestData: { vendorName: "vendor", requestType: "request" },
      });
    }),
  );

  it.effect("filters events by socket and maps event data", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(OBSPlugin.effect);
      const schema = schemas.find(
        ({ id }) => id === "CurrentProgramSceneChanged",
      );
      assert.isDefined(schema);
      const address = SocketAddress.make("ws://localhost:4455");
      const other = SocketAddress.make("ws://localhost:4456");
      const event = new CurrentProgramSceneChanged({
        address,
        sceneName: "Live",
        sceneUuid: "scene-1",
      });
      assert.isTrue(yield* schema.matches(event, { socket: address }));
      assert.isFalse(yield* schema.matches(event, { socket: other }));
      const outputs = new Map<string, unknown>();
      yield* schema.run({
        input: () => undefined,
        output: (ref, value) => outputs.set(ref.id, value),
        properties: { socket: address },
        event,
        engine: {},
        execution,
        node,
      });
      assert.deepStrictEqual(Object.fromEntries(outputs), {
        sceneName: "Live",
        sceneUuid: "scene-1",
      });

      const listSchema = schemas.find(
        ({ id }) => id === "SceneCollectionListChanged",
      );
      assert.isDefined(listSchema);
      assert.strictEqual(listSchema.dataOutputs[0]?.type._tag, "List");
      const listOutputs = new Map<string, unknown>();
      yield* listSchema.run({
        input: () => undefined,
        output: (ref, value) => listOutputs.set(ref.id, value),
        properties: { socket: address },
        event: new SceneCollectionListChanged({
          address,
          sceneCollections: ["Default", "Live"],
        }),
        engine: {},
        execution,
        node,
      });
      assert.deepStrictEqual(Object.fromEntries(listOutputs), {
        sceneCollections: ["Default", "Live"],
      });
    }),
  );
});
