import { assert, describe, it } from "@effect/vitest";
import { CustomTypes, Project } from "@macrograph/core";
import {
  Editor,
  EditorAccess,
  EditorEvents,
  EditorRpc,
  Packages,
  Presence,
} from "@macrograph/editor";
import { Executor, RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { Engine, Plugin } from "@macrograph/plugin";
import { Array, Cause, Effect, Exit, Layer, Option, Schema, Stream } from "effect";
import { RpcTest } from "effect/unstable/rpc";

const WorkspaceRpcs = EditorRpc.EditorRpcs.merge(RuntimeActivity.Rpcs).middleware(
  EditorRpc.ConnectionMiddleware,
);
const handlers = Layer.mergeAll(
  EditorRpc.handlerLayer,
  RuntimeActivity.handlerLayer,
  EditorRpc.connectionMiddlewareLayer,
).pipe(
  Layer.provide(Editor.layer),
  Layer.provideMerge(RuntimeActivity.layer),
  Layer.provide(EditorEvents.layer),
  Layer.provide(Packages.defaultLayer),
  Layer.provide(Presence.layer),
  Layer.provide(Persistence.layerMemory),
  Layer.provide(Engine.emptyCredentialsLayer),
);

describe("workspace runtime activity access", () => {
  for (const canEdit of [false, true]) {
    it.effect(
      canEdit
        ? "allows administrators to stream payloads and replay events"
        : "denies anonymous payload access and replay without breaking editor reads",
      () =>
        Effect.gen(function* () {
          const activity = yield* RuntimeActivity.Service;
          class Secret extends Schema.TaggedClass<Secret>()("Secret", { token: Schema.String }) {}
          class TestEngine extends Engine.make({ events: Array.empty<Secret>() }) {}
          const plugin = Plugin.make({
            id: "private",
            engine: TestEngine,
            effect: () => Effect.void,
          });
          let calls = 0;
          const event = new Secret({ token: "secret-payload" });
          const executor = activity.wrap({
            ...(yield* Executor.make(Project.empty())),
            handleEvent: (_plugin, input) =>
              Effect.sync(() => {
                assert.strictEqual(input, event);
                calls++;
              }),
          });
          yield* executor.handleEvent(plugin, event);
          const original = (yield* activity.snapshot)[0]!;
          const client = yield* RpcTest.makeClient(WorkspaceRpcs);
          const snapshot = yield* client.ActivityStream().pipe(Stream.runHead, Effect.exit);
          if (canEdit) {
            assert.isTrue(Exit.isSuccess(snapshot));
            if (Exit.isSuccess(snapshot)) {
              const event = Option.getOrThrow(snapshot.value)[0]!;
              assert.include(event.payload, "secret-payload");
            }
          } else {
            assert.isTrue(Exit.isFailure(snapshot));
            if (Exit.isFailure(snapshot))
              assert.deepStrictEqual(
                Cause.squash(snapshot.cause),
                new EditorAccess.Forbidden({ operation: "ActivityStream" }),
              );
          }
          const replayed = yield* client.ReplayEvent({ eventId: original.id }).pipe(Effect.exit);
          if (canEdit) {
            assert.isTrue(Exit.isSuccess(replayed));
            if (Exit.isSuccess(replayed)) assert.isUndefined(replayed.value);
            const replay = Option.getOrThrow(
              yield* client.ActivityStream().pipe(
                Stream.filter(
                  (events) => events[0]?.source === "Replay" && events[0]?.status === "complete",
                ),
                Stream.runHead,
              ),
            )[0]!;
            assert.notStrictEqual(replay.id, original.id);
            assert.isTrue(replay.replayable);
            assert.strictEqual(calls, 2);
          } else {
            assert.isTrue(Exit.isFailure(replayed));
            if (Exit.isFailure(replayed))
              assert.deepStrictEqual(
                Cause.squash(replayed.cause),
                new EditorAccess.Forbidden({ operation: "ReplayEvent" }),
              );
            yield* Effect.yieldNow;
            assert.strictEqual(calls, 1);
            assert.deepStrictEqual(yield* activity.snapshot, [original]);
          }
          assert.deepStrictEqual(yield* client.GetPackages({}), [CustomTypes.packageModel({})]);
          const presence = yield* client.PresenceStream().pipe(Stream.runHead);
          assert.isTrue(Option.isSome(presence));
        }).pipe(
          Effect.scoped,
          Effect.provide(handlers),
          Effect.provideService(EditorAccess.Policy, {
            resolve: (_headers, clientId) =>
              Effect.succeed({
                actor: { type: "CLIENT", id: String(clientId) },
                connectionId: String(clientId),
                displayName: "Test",
                projectId: "test",
                canEdit,
                canManageCredentials: canEdit,
              }),
          }),
        ),
    );
  }
});
