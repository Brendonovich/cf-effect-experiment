import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect } from "effect";

import { count, events, ids, requests } from "../src/Catalog.ts";
import { OBSSocket, SocketAddress } from "../src/Definition.ts";
import {
  CurrentProgramSceneChanged,
  SceneCollectionListChanged,
} from "../src/Events.ts";
import OBSPlugin from "../src/Plugin.ts";

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
      assert.strictEqual(requests.length, 146);
      assert.strictEqual(events.length, 52);
      assert.strictEqual(count, 198);
      assert.strictEqual(ids.length, 198);
      assert.strictEqual(new Set(ids).size, 198);
      assert.strictEqual(schemas.length, 198);
      assert.deepStrictEqual(
        schemas.map(({ id }) => id),
        ids,
      );
      assert.strictEqual(new Set(schemas.map(({ id }) => id)).size, 198);
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
        schemas.every(
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
