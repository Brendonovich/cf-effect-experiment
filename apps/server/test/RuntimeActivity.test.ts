import { assert, describe, it } from "@effect/vitest";
import {
  Editor,
  EditorAccess,
  EditorEvents,
  EditorRpc,
  Packages,
  Presence,
} from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { Persistence } from "@macrograph/persistence";
import { Engine } from "@macrograph/plugin";
import { Cause, Effect, Exit, Layer, Option, Stream } from "effect";
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
        ? "allows administrators to stream payloads"
        : "denies anonymous payload access without breaking editor reads",
      () =>
        Effect.gen(function* () {
          const activity = yield* RuntimeActivity.Service;
          yield* activity.track(
            "private",
            { _tag: "Secret", token: "secret-payload" },
            Effect.void,
          );
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
          assert.deepStrictEqual(yield* client.GetPackages({}), []);
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
