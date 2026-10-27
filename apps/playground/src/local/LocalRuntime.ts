import type { EditorConnection } from "@macrograph/editor-ui";
import type { ModuleCatalogSource, ModuleRpcProtocolFactory } from "@macrograph/editor-ui/modules";

import {
  Editor,
  EditorAccess,
  EditorEvents,
  EditorRpc,
  Packages,
  Presence,
  QueueRuntime,
} from "@macrograph/editor";
import { ModuleRpcProtocol } from "@macrograph/editor-ui/modules";
import { RuntimeActivity } from "@macrograph/execution";
import { LiveRuntime } from "@macrograph/live-runtime";
import { ModuleRegistry, ModuleTrust, Mounter, StaticRegistry } from "@macrograph/module-host/core";
import * as Engine from "@macrograph/module/Engine";
import { Context, Effect, Layer, Option, Stream, type Scope } from "effect";
import { RpcTest } from "effect/rpc";

import type { BrowserCredentialProvider } from "./BrowserCredentials";
import type { LocalProjectStore } from "./LocalStoragePersistence";

import { hostServices, modules } from "./PlaygroundModules";

export interface LocalEditorConnection extends EditorConnection {
  /** Module settings call the engines mounted in this page directly. */
  readonly moduleRpcProtocol: ModuleRpcProtocolFactory;
  /** The catalog of the bundled modules, read from the module registry. */
  readonly moduleCatalog: ModuleCatalogSource.Source;
  readonly modules: ModuleRegistry.Service["Service"];
}

const bundled = new Map(modules.map((module) => [StaticRegistry.id(module.static), module]));

export const makeLocalConnection = (
  store: LocalProjectStore,
  credentials?: BrowserCredentialProvider,
): Effect.Effect<LocalEditorConnection, unknown, Scope.Scope> => {
  const persistence = store.layer;
  const base = Layer.mergeAll(
    persistence,
    Packages.defaultLayer,
    Presence.layer,
    RuntimeActivity.layer,
    QueueRuntime.layer,
    credentials === undefined
      ? Engine.emptyCredentialsLayer
      : Layer.succeed(Engine.Credentials)(credentials.service),
  );
  const events = EditorEvents.layer.pipe(Layer.provideMerge(base));
  const editor = Editor.layer.pipe(Layer.provideMerge(events));
  const rpc = Layer.mergeAll(
    EditorRpc.handlerLayer,
    EditorRpc.connectionMiddlewareLayer,
    RuntimeActivity.handlerLayer,
  ).pipe(Layer.provideMerge(editor), Layer.provide(EditorAccess.permissivePolicy(store.projectId)));

  return Layer.build(rpc).pipe(
    Effect.flatMap((context) =>
      Effect.gen(function* () {
        const executor = yield* LiveRuntime.make({ projectId: store.projectId });

        // Engines whose RPCs the editor calls in-process, while their module is loaded.
        const contexts = new Map<string, Context.Context<never>>();
        const mounter = Layer.succeed(Mounter.Service)(
          Mounter.Service.of({
            mount: (input) =>
              Effect.gen(function* () {
                const module = bundled.get(input.id);
                if (module === undefined)
                  return yield* new Mounter.MountError({
                    id: input.id,
                    message: "The module is not bundled with the playground",
                  });
                const engine = yield* module
                  .mount(input.id, executor)
                  .pipe(
                    Effect.mapError(
                      (error) => new Mounter.MountError({ id: input.id, message: String(error) }),
                    ),
                  );
                if (Option.isSome(engine))
                  yield* Effect.acquireRelease(
                    Effect.sync(() => contexts.set(input.id, engine.value)),
                    () => Effect.sync(() => contexts.delete(input.id)),
                  );
                return { rpc: Option.none() };
              }).pipe(Effect.provide(context)),
          }),
        );
        const registryContext = yield* Layer.build(
          StaticRegistry.layer({
            modules: modules.map((module) => module.static),
            hostServices,
          }).pipe(Layer.provide([mounter, ModuleTrust.none])),
        );
        const registry = Context.get(registryContext, ModuleRegistry.Service);
        const client = yield* RpcTest.makeClient(EditorRpc.EditorRpcs);
        const runtimeClient = yield* RpcTest.makeClient(RuntimeActivity.Rpcs);
        return {
          client,
          activity: runtimeClient.ActivityStream(),
          replayEvent: (eventId: string) => runtimeClient.ReplayEvent({ eventId }),
          moduleRpcProtocol: ModuleRpcProtocol.inProcess(contexts),
          moduleCatalog: {
            fetch: () => registry.catalog,
            changes: Stream.drop(registry.changes, 1),
          },
          modules: registry,
        };
      }).pipe(Effect.provide(context)),
    ),
  );
};
