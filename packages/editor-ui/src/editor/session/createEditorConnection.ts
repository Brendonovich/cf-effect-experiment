import type { Package, Queue } from "@macrograph/core";
import type { Presence } from "@macrograph/editor";

import { Effect, Fiber, Schedule, Stream } from "effect";
import { createSignal, onSettled } from "solid-js";

import type { EditorControllerOptions } from "../createEditorController";
import type { EditorConnection, EditorRpcClient } from "../Editor";
import type { createEditorStore } from "../store";

import { runFork } from "../../observability/browserTracing";
import { createStateMachine } from "../../ui/createStateMachine";
import { createPluginData } from "../plugins/createPluginData";

type EditorStore = ReturnType<typeof createEditorStore>;

type EditorConnectionState = {
  context: {
    readonly pluginSettings: EditorConnection["pluginSettings"];
  };
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
  props: Pick<EditorControllerOptions, "connection" | "reconnect" | "settingsDescriptors">,
  editor: EditorStore,
  onProjectSnapshot: (project: Parameters<EditorStore["setProject"]>[0]) => void,
  onDispose: () => void,
): {
  client: () => EditorRpcClient | null;
  activeConnection: () => EditorConnection | null;
  connectionState: EditorConnectionState;
  reconnecting: () => boolean;
  pluginSettingsById: () => EditorConnection["pluginSettings"];
  pluginData: ReturnType<typeof createPluginData>;
  refreshPluginData: ReturnType<typeof createPluginData>["refresh"];
  presenceClients: () => ReadonlyArray<Presence.Client>;
  selfConnectionId: () => string | undefined;
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
    {
      context: { pluginSettings: new Map() },
      mode: { status: "connecting" },
    } as EditorConnectionState,
    {
      connected(state, connection: EditorConnection) {
        const reconnecting = state.mode.status === "reconnecting";
        connectedClient = connection.client;
        setActiveConnection(connection);
        state.context = { pluginSettings: connection.pluginSettings };
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
        state.context = {
          pluginSettings: reconnecting ? state.context.pluginSettings : new Map(),
        };
        state.mode = { status: reconnecting ? "reconnecting" : "connecting" };
      },
      failed(state, error: unknown) {
        connectedClient = null;
        setActiveConnection(null);
        state.context = { pluginSettings: new Map() };
        state.mode = { status: "failed", error };
      },
    },
  );
  const reconnecting = () => {
    const mode = connectionState.mode;
    return mode.status === "reconnecting" || (mode.status === "loading" && mode.reconnecting);
  };
  const pluginSettingsById = () => connectionState.context.pluginSettings;
  const [presenceClients, setPresenceClients] = createSignal<ReadonlyArray<Presence.Client>>([]);
  const [selfConnectionId, setSelfConnectionId] = createSignal<string>();
  const [queueStates, setQueueStates] = createSignal<ReadonlyArray<Queue.State>>([]);
  const selfPresence = () =>
    presenceClients().find((entry) => entry.connectionId === selfConnectionId());
  const canEdit = () =>
    connectionState.mode.status === "ready" && (selfPresence()?.canEdit ?? false);
  const pluginData = createPluginData(props.settingsDescriptors, applyEvent);
  const refreshPluginData = pluginData.refresh;
  let fiber: Fiber.Fiber<unknown, unknown> | null = null;

  onSettled(() => {
    const connect = Effect.scoped(
      Effect.gen(function* () {
        const connected = yield* props.connection;
        const activeClient = connected.client;
        connectionActions.connected(connected);

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            setPresenceClients([]);
            setQueueStates([]);
            setSelfConnectionId(undefined);
            pluginData.disconnect(props.reconnect === true);
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
                    setSelfConnectionId(event.selfConnectionId);
                  }
                  setPresenceClients(event.clients);
                }),
              ),
            ),
            Effect.gen(function* () {
              const packages = yield* activeClient.GetPackages({});
              setPackages(packages as Package.Model[]);
              connectionActions.packagesLoaded(activeClient);
              yield* Effect.promise(() => pluginData.connect(connected, packages));
            }),
            activeClient.ProjectEventsStream().pipe(
              Stream.runForEach((event) =>
                Effect.sync(() => {
                  if (event._tag === "ProjectSnapshot") {
                    const project = event.snapshot.project;
                    setProject(project, event.snapshot.nodeIO);
                    onProjectSnapshot(project);
                    connectionActions.projectLoaded(activeClient);
                    return;
                  }
                  applyEvent(event);
                }).pipe(
                  Effect.andThen(
                    event._tag === "EngineStateChanged" || event._tag === "PluginClientStateDirty"
                      ? Effect.sync(() => void refreshPluginData(event.pluginId))
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
            pluginData.disconnect();
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
    pluginSettingsById,
    pluginData,
    refreshPluginData,
    presenceClients,
    selfConnectionId,
    selfPresence,
    canEdit,
    editorReady,
    queueStates,
  };
}
