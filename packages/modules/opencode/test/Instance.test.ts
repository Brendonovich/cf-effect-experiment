import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RpcTest } from "effect/rpc";

import type { Instance, Instances } from "../src/Instance.ts";

import {
  ConnectionId,
  OpenCodeConnection,
  OpenCodeEngine,
  RequestFailure,
  initialStorage,
} from "../src/Definition.ts";
import { makeLayer } from "../src/Engine.ts";

const instance = (calls: Array<unknown>, label: string, appliedConfig?: string): Instance => ({
  ...(appliedConfig === undefined ? {} : { appliedConfig }),
  generateText: (input) => Effect.sync(() => (calls.push([label, "generate", input]), label)),
  listModels: Effect.succeed([`${label}/model`]),
  listCredentials: Effect.succeed([
    { id: "credential", integrationID: "anthropic", label: "Key", active: true },
  ]),
  listOAuthMethods: Effect.succeed([
    { integrationID: "openai", integrationName: "OpenAI", methodID: "oauth", label: "Sign in" },
  ]),
  connectKey: (input) => Effect.sync(() => calls.push([label, "key", input])),
  removeCredential: (id) => Effect.sync(() => calls.push([label, "remove", id])),
  startOAuth: (input) =>
    Effect.sync(() => {
      calls.push([label, "start", input]);
      return {
        integrationID: input.integrationID,
        attemptID: "attempt",
        url: "https://opencode.ai/auth",
        instructions: "Authorize",
        mode: "auto" as const,
        expires: 100,
      };
    }),
  oauthStatus: (input) =>
    Effect.sync(() => (calls.push([label, "status", input]), { status: "complete" as const })),
  completeOAuth: (input) => Effect.sync(() => calls.push([label, "complete", input])),
  cancelOAuth: (input) => Effect.sync(() => calls.push([label, "cancel", input])),
});

const setup = (instances: Instances) =>
  Effect.gen(function* () {
    let storage = initialStorage;
    const refreshed: Array<string> = [];
    const context = Layer.succeed(OpenCodeEngine.EngineContext)(
      OpenCodeEngine.EngineContext.of({
        storage: {
          get: Effect.sync(() => storage),
          set: (value) => Effect.sync(() => void (storage = value)),
          update: (update) => Effect.sync(() => void (storage = update(storage))),
        },
        resource: { refresh: (resource) => Effect.sync(() => void refreshed.push(resource.key)) },
        credentials: {
          get: Effect.succeed([]),
          refresh: () => Effect.die("unused"),
          subscribe: () => Effect.void,
        },
        client: { refresh: Effect.void },
        emit: () => Effect.die("unused"),
      }),
    );
    const engine = yield* OpenCodeEngine.pipe(
      Effect.provide(makeLayer(instances)),
      Effect.provide(context),
    );
    const settings = yield* RpcTest.makeClient(OpenCodeEngine.ClientRpcs).pipe(
      Effect.provide(engine.client.rpcs),
    );
    const runtime = yield* RpcTest.makeClient(OpenCodeEngine.Rpcs).pipe(
      Effect.provide(engine.rpcs),
    );
    return { engine, settings, runtime, refreshed, storage: () => storage };
  });

describe("OpenCode connections", () => {
  it.effect("routes each node request to its explicitly bound connection", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const instances: Instances = {
        connectionTypes: ["managed", "remote"],
        resolve: ({ id, target }) =>
          Effect.sync(() => {
            calls.push(["resolve", id, target.type]);
            return instance(calls, target.type);
          }),
      };
      const { settings, runtime, refreshed, storage } = yield* setup(instances);
      const managed = yield* settings.OpenCodeCreateConnection({
        name: "Writer",
        target: { type: "managed", config: "{}" },
      });
      const remote = yield* settings.OpenCodeCreateConnection({
        name: "Remote",
        target: { type: "remote", url: "https://opencode.example.com", password: "secret" },
      });
      assert.notStrictEqual(managed, remote);
      assert.deepStrictEqual(refreshed, ["OpenCodeConnection", "OpenCodeConnection"]);
      assert.deepStrictEqual(storage().connections[managed], {
        name: "Writer",
        target: { type: "managed", config: "{}" },
      });

      assert.strictEqual(
        yield* runtime.OpenCodeGenerateText({ connectionId: managed, prompt: "A", model: "" }),
        "managed",
      );
      assert.strictEqual(
        yield* runtime.OpenCodeGenerateText({ connectionId: remote, prompt: "B", model: "" }),
        "remote",
      );
      assert.deepStrictEqual(yield* runtime.OpenCodeListModels({ connectionId: remote }), [
        "remote/model",
      ]);
      assert.deepStrictEqual(
        calls.filter((call) => Array.isArray(call) && call[1] === "generate"),
        [
          ["managed", "generate", { prompt: "A", model: "" }],
          ["remote", "generate", { prompt: "B", model: "" }],
        ],
      );
    }),
  );

  it.effect("exposes connections as resource values for constants and node properties", () =>
    Effect.gen(function* () {
      const instances: Instances = {
        connectionTypes: ["managed"],
        resolve: () => Effect.succeed(instance([], "managed")),
      };
      const { settings, engine } = yield* setup(instances);
      const id = yield* settings.OpenCodeCreateConnection({
        name: "Writer",
        target: { type: "managed", config: "{}" },
      });
      const values = yield* OpenCodeConnection.values.pipe(Effect.provide(engine.resources));
      assert.deepStrictEqual(values, [{ id, display: "Writer" }]);
    }),
  );

  it.effect("scopes credentials and OAuth to the selected connection", () =>
    Effect.gen(function* () {
      const calls: Array<unknown> = [];
      const instances: Instances = {
        connectionTypes: ["managed"],
        resolve: ({ id }) => Effect.succeed(instance(calls, id)),
      };
      const { settings } = yield* setup(instances);
      const id = yield* settings.OpenCodeCreateConnection({
        name: "Writer",
        target: { type: "managed", config: "{}" },
      });
      yield* settings.OpenCodeConnectKey({
        connectionId: id,
        integrationID: "anthropic",
        key: "k",
      });
      yield* settings.OpenCodeStartOAuth({
        connectionId: id,
        integrationID: "openai",
        methodID: "oauth",
      });
      yield* settings.OpenCodeOAuthStatus({
        connectionId: id,
        integrationID: "openai",
        attemptID: "attempt",
      });
      assert.deepStrictEqual(
        calls.map((call) => (Array.isArray(call) ? [call[0], call[1]] : call)),
        [
          [id, "key"],
          [id, "start"],
          [id, "status"],
        ],
      );
    }),
  );

  it.effect("reports queued managed config and resolve errors instead of hiding them", () =>
    Effect.gen(function* () {
      let fail = false;
      const instances: Instances = {
        connectionTypes: ["managed", "remote"],
        resolve: ({ target }) =>
          fail
            ? Effect.fail(new RequestFailure({ reason: "Instance unreachable" }))
            : Effect.succeed(instance([], target.type, '{"applied":true}')),
      };
      const { settings, engine } = yield* setup(instances);
      const id = yield* settings.OpenCodeCreateConnection({
        name: "Writer",
        target: { type: "managed", config: "{}" },
      });
      const [connection] = (yield* engine.client.state).connections;
      assert.deepStrictEqual(connection?.status, {
        state: "ready",
        appliedConfig: '{"applied":true}',
      });
      assert.strictEqual(connection?.id, id);
      fail = true;
      const [failed] = (yield* engine.client.state).connections;
      assert.deepStrictEqual(failed?.status, {
        state: "error",
        message: "Instance unreachable",
      });
    }),
  );

  it.effect("keeps the stored remote password when an edit omits it", () =>
    Effect.gen(function* () {
      const instances: Instances = {
        connectionTypes: ["remote"],
        resolve: () => Effect.succeed(instance([], "remote")),
      };
      const { settings, storage } = yield* setup(instances);
      const id = yield* settings.OpenCodeCreateConnection({
        name: "Remote",
        target: { type: "remote", url: "https://a.example", password: "secret" },
      });
      yield* settings.OpenCodeUpdateConnection({
        connectionId: id,
        name: "Renamed",
        target: { type: "remote", url: "https://b.example" },
      });
      assert.deepStrictEqual(storage().connections[ConnectionId.make(id)], {
        name: "Renamed",
        target: { type: "remote", url: "https://b.example", password: "secret" },
      });
      yield* settings.OpenCodeRemoveConnection({ connectionId: id });
      assert.deepStrictEqual(storage().connections, {});
    }),
  );
});
