import { assert, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { EditorRpc, EditorServer } from "../src/index.ts";

it("merges discovered RPC groups and rejects operation collisions", () => {
  const first = RpcGroup.make(Rpc.make("First", { success: Schema.String }));
  const second = RpcGroup.make(Rpc.make("Second", { success: Schema.String }));
  assert.deepStrictEqual(Array.from(EditorServer.mergeRpcGroups(first, second).requests.keys()), [
    "First",
    "Second",
  ]);
  assert.throws(
    () => EditorServer.mergeRpcGroups(first, first),
    /RPC operation already registered: First/,
  );
});

it("keeps credential reads read-only and authorizes refetch as a mutation", () => {
  assert.isFalse(EditorRpc.requiresWriteAccess("GetCredentialCatalog"));
  assert.isFalse(EditorRpc.requiresWriteAccess("GetCredentialAuth"));
  assert.isTrue(EditorRpc.requiresWriteAccess("RefetchCredentials"));
  assert.isTrue(EditorRpc.requiresWriteAccess("StartCredentialAuth"));
  const identity = {
    actor: { type: "CLIENT" as const, id: "viewer" },
    connectionId: "viewer",
    displayName: "Viewer",
    projectId: "project",
    canEdit: true,
    canManageCredentials: false,
  };
  assert.isTrue(Result.isSuccess(Effect.runSync(Effect.result(EditorRpc.authorize(identity, "GetCredentialAuth")))));
  assert.isTrue(Result.isFailure(Effect.runSync(Effect.result(EditorRpc.authorize(identity, "DisconnectCredentialAuth")))));
  assert.isTrue(
    Result.isSuccess(
      Effect.runSync(
        Effect.result(
          EditorRpc.authorize(
            { ...identity, canEdit: false, canManageCredentials: true },
            "StartCredentialAuth",
          ),
        ),
      ),
    ),
  );
});
