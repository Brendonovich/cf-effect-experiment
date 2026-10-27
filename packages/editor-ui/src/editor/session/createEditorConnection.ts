import type { Package, Queue } from "@macrograph/core";
import type { EditorEvent, Presence } from "@macrograph/editor";
import type { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";

import { Cause, Effect, Fiber, Schedule, Stream, type Scope } from "effect";
import { createMemo, createSignal, onSettled } from "solid-js";

import type { EditorConnection, EditorRpcClient } from "../Editor";
import type { ConnectionModules } from "../modules/EditorModules";
import type { ModuleUILoader } from "../modules/ModuleUILoader";
import type { createEditorStore } from "../store";

import { runFork } from "../../observability/browserTracing";
import { createStateMachine } from "../../ui/createStateMachine";
import { createModuleCatalog } from "../modules/createModuleCatalog";
import { createModuleData } from "../modules/createModuleData";

type EditorStore = ReturnType<typeof createEditorStore>;

/** `ModulesChanged` arrives on the project event stream once the server sends it there. */
const isModulesChanged = (event: {
  readonly _tag: string;
}): event is ModuleAdminRpc.ModulesChanged => event._tag === "ModulesChanged";

/** A host connection with the module catalog and RPC protocols derived from it. */
export interface BoundEditorConnection {
  readonly connection: EditorConnection;
  readonly modules: ConnectionModules;
}

type EditorConnectionState = {
  mode:
    | { readonly status: "connecting" }
    | {
        readonly status: "loading";
        readonly reconnecting: boolean;
        packagesLoaded: boolean;
        projectLoaded: boolean;
      }
    | { readonly status: "ready" }
    | { readonly status: "reconnecting" }
    | { readonly status: "failed"; readonly error: unknown };
};

export function createEditorConnection(
  props: {
    readonly connection: Effect.Effect<BoundEditorConnection, unknown, Scope.Scope>;
    readonly reconnect?: boolean;
    readonly loader: ModuleUILoader;
  },
  editor: EditorStore,
  onProjectSnapshot: (project: Parameters<EditorStore["setProject"]>[0]) => void,
  onDispose: () => void,
  /** Receives each event from other clients after it has been applied to the store. */
  onRemoteEvent: (event: EditorEvent.EditorEvent) => void = () => {},
): {
  client: () => EditorRpcClient | null;
  activeConnection: () => EditorConnection | null;
  connectionState: EditorConnectionState;
  reconnecting: () => boolean;
  moduleCatalog: ReturnType<typeof createModuleCatalog>;
  moduleData: ReturnType<typeof createModuleData>;
  refreshModuleData: ReturnType<typeof createModuleData>["refresh"];
  presenceClients: () => ReadonlyArray<Presence.Client>;
  selfId: () => string | undefined;
  selfPresence: () => Presence.Client | undefined;
  canEdit: () => boolean;
  editorReady: () => boolean;
  queueStates: () => ReadonlyArray<Queue.State>;
} {
  const { store, applyEvent, setProject, setPackages } = editor;
  const [activeConnection, setActiveConnection] = createSignal<EditorConnection | null>(null);
  const client = () => activeConnection()?.client ?? null;
  let connectedClient: EditorRpcClient | null = null;
  const [connectionState, connectionActions] = createStateMachine(
    { mode: { status: "connecting" } } as EditorConnectionState,
    {
      connected(state, connection: EditorConnection) {
        const reconnecting = state.mode.status === "reconnecting";
        connectedClient = connection.client;
        setActiveConnection(connection);
        state.mode = {
          status: "loading",
          reconnecting,
          packagesLoaded: false,
          projectLoaded: false,
        };
      },
      packagesLoaded(state, activeClient: EditorRpcClient) {
        if (state.mode.status !== "loading" || connectedClient !== activeClient) return;
        state.mode.packagesLoaded = true;
        if (state.mode.projectLoaded) state.mode = { status: "ready" };
      },
      projectLoaded(state, activeClient: EditorRpcClient) {
        if (state.mode.status !== "loading" || connectedClient !== activeClient) return;
        state.mode.projectLoaded = true;
        if (state.mode.packagesLoaded) state.mode = { status: "ready" };
      },
      disconnected(state, reconnecting: boolean) {
        connectedClient = null;
        setActiveConnection(null);
        state.mode = { status: reconnecting ? "reconnecting" : "connecting" };
      },
      failed(state, error: unknown) {
        connectedClient = null;
        setActiveConnection(null);
        state.mode = { status: "failed", error };
      },
    },
  );
  const reconnecting = () => {
    const mode = connectionState.mode;
    return mode.status === "reconnecting" || (mode.status === "loading" && mode.reconnecting);
  };
  const [presenceClients, setPresenceClients] = createSignal<ReadonlyArray<Presence.Client>>([]);
  const [selfId, setSelfId] = createSignal<string>();
  const [queueStates, setQueueStates] = createSignal<ReadonlyArray<Queue.State>>([]);
  const selfPresence = () => presenceClients().find((entry) => entry.id === selfId());
  const canEdit = createMemo(
    () => connectionState.mode.status === "ready" && (selfPresence()?.canEdit ?? false),
  );
  const moduleCatalog = createModuleCatalog();
  const moduleData = createModuleData({ catalog: moduleCatalog, loader: props.loader }, applyEvent);
  const refreshModuleData = moduleData.refresh;
  let fiber: Fiber.Fiber<unknown, unknown> | null = null;

  onSettled(() => {
    const connect = Effect.scoped(
      Effect.gen(function* () {
        const { connection: connected, modules } = yield* props.connection;
        const activeClient = connected.client;
        // Fetch packages and the catalog again after the host's modules changed.
        const syncModules = Effect.gen(function* () {
          const packages = yield* activeClient.GetPackages({});
          setPackages(packages as Package.Model[]);
          yield* moduleCatalog.load(modules.catalog, packages);
          yield* Effect.promise(() => moduleData.setPackages(packages));
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logError("Failed to refresh modules", cause),
          ),
        );
        connectionActions.connected(connected);

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            setPresenceClients([]);
            setQueueStates([]);
            setSelfId(undefined);
            moduleData.disconnect(props.reconnect === true);
            moduleCatalog.clear(props.reconnect === true);
            connectionActions.disconnected(props.reconnect === true);
          }),
        );

        yield* Effect.all(
          [
            activeClient
              .QueueStateStream()
              .pipe(Stream.runForEach((states) => Effect.sync(() => setQueueStates(states)))),
            activeClient.PresenceStream().pipe(
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  if (event._tag === "PresenceSnapshot") {
                    setSelfId(event.selfId);
                  }
                  setPresenceClients(event.clients);
                }),
              ),
            ),
            Effect.gen(function* () {
              const packages = yield* activeClient.GetPackages({});
              setPackages(packages as Package.Model[]);
              yield* moduleCatalog.load(modules.catalog, packages);
              connectionActions.packagesLoaded(activeClient);
              yield* Effect.promise(() =>
                moduleData.connect(connected, packages, modules.rpcProtocol),
              );
            }),
            modules.catalog.changes === undefined
              ? Effect.void
              : modules.catalog.changes.pipe(Stream.runForEach(() => syncModules)),
            activeClient.ProjectEventsStream().pipe(
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  if (isModulesChanged(event)) return;
                  if (event._tag === "ProjectSnapshot") {
                    const project = event.snapshot.project;
                    setProject(project, event.snapshot.nodeIO);
                    onProjectSnapshot(project);
                    connectionActions.projectLoaded(activeClient);
                    return;
                  }
                  applyEvent(event);
                  onRemoteEvent(event);
                }).pipe(
                  Effect.andThen(
                    isModulesChanged(event)
                      ? syncModules
                      : event._tag === "EngineStateChanged" ||
                          event._tag === "ModuleClientStateDirty"
                        ? Effect.sync(() => void refreshModuleData(event.moduleId))
                        : Effect.void,
                  ),
                ),
              ),
            ),
          ],
          { concurrency: "unbounded", discard: true },
        );
      }),
    );

    fiber = runFork(
      connect.pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (props.reconnect === true) {
              if (connectionState.mode.status !== "reconnecting")
                connectionActions.disconnected(true);
            } else connectionActions.failed(error);
          }),
        ),
        props.reconnect === true
          ? Effect.retry(Schedule.spaced(1000))
          : Effect.tapError(Effect.log),
        Effect.tapError(Effect.log),
        Effect.tapDefect((error) =>
          Effect.sync(() => {
            connectionActions.failed(error);
            moduleData.disconnect();
            moduleCatalog.clear();
          }),
        ),
        Effect.tapDefect(Effect.log),
      ),
    );
    return () => {
      onDispose();
      if (fiber) {
        runFork(Fiber.interrupt(fiber));
        fiber = null;
      }
    };
  });

  const editorReady = () => {
    const mode = connectionState.mode;
    return mode.status === "ready" || (reconnecting() && store.project !== null);
  };

  return {
    client,
    activeConnection,
    connectionState,
    reconnecting,
    moduleCatalog,
    moduleData,
    refreshModuleData,
    presenceClients,
    selfId,
    selfPresence,
    canEdit,
    editorReady,
    queueStates,
  };
}
