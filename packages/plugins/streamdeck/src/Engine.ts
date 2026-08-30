import * as WebSocket from "@macrograph/plugin-websocket-server/Definition";
import { make } from "@macrograph/plugin-websocket-server/Engine";
import { Adapter } from "@macrograph/plugin-websocket-server/Listener";
import * as Protocol from "@macrograph/streamdeck-protocol";
import * as Wire from "@macrograph/streamdeck-protocol/schema";
import { Effect, Layer, Option, Ref, Result, Schema, SubscriptionRef } from "effect";
import * as Headers from "effect/unstable/http/Headers";
import { Rpc } from "effect/unstable/rpc";
import { RequestId } from "effect/unstable/rpc/RpcMessage";

import {
  ButtonId,
  ButtonNotFound,
  ClientRpcs,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_SERVER_ID,
  DeviceId,
  DeviceState,
  InvalidButton,
  RuntimeRpcs,
  StreamDeckButton,
  StreamDeckButtonAppeared,
  StreamDeckButtonDisappeared,
  StreamDeckDevice,
  StreamDeckDeviceConnected,
  StreamDeckDeviceDisconnected,
  StreamDeckEngine,
  StreamDeckFailure,
  StreamDeckFromPropertyInspector,
  StreamDeckKeyDown,
  StreamDeckKeyUp,
  StreamDeckServer,
  StreamDeckSettingsChanged,
  type ButtonState,
} from "./Definition.ts";

type Binding = {
  readonly serverId: WebSocket.ServerId;
  readonly clientId: WebSocket.ClientId;
  readonly deviceId: DeviceId;
  readonly action: string;
  readonly context: string;
  readonly buttonId: ButtonId;
  readonly column: number;
  readonly row: number;
};

type DeviceEntry = {
  readonly id: DeviceId;
  readonly type: string;
  readonly size: { readonly column: number; readonly row: number } | null;
};

const buttonIdFromSettings = (settings: Readonly<Record<string, unknown>>) => {
  const value = settings[Protocol.BUTTON_SETTING_KEY];
  return typeof value === "string" && value.trim().length > 0
    ? Option.some(ButtonId.make(value.trim()))
    : Option.none();
};

const parseJsonRecord = (input: string) =>
  Effect.try({
    try: () => JSON.parse(input) as unknown,
    catch: (error) =>
      new StreamDeckFailure({
        reason: error instanceof Error ? error.message : "Invalid JSON",
      }),
  }).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(Wire.JsonRecord)(value).pipe(
        Effect.mapError(
          (error) =>
            new StreamDeckFailure({
              reason: error instanceof Error ? error.message : "Invalid JSON object",
            }),
        ),
      ),
    ),
  );

export const layer = StreamDeckEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const adapter = yield* Adapter;

    // Ensure a default listener exists without writing storage during layer
    // construction (setState requires the engine to already be registered).
    const ensureDefaultListener = <A extends { readonly servers: ReadonlyArray<WebSocket.ServerDefinition> }>(
      storage: A,
    ): A =>
      storage.servers.length > 0
        ? storage
        : {
            ...storage,
            servers: [
              {
                id: DEFAULT_SERVER_ID,
                name: "Stream Deck",
                host: DEFAULT_HOST,
                port: DEFAULT_PORT,
                manuallyDisabled: false,
              },
            ],
          };

    const activeClients = yield* Ref.make(
      new Map<string, { readonly serverId: WebSocket.ServerId; readonly clientId: WebSocket.ClientId }>(),
    );
    const bindings = yield* SubscriptionRef.make(new Map<string, Binding>());
    const devices = yield* SubscriptionRef.make(
      new Map<WebSocket.ServerId, Map<DeviceId, DeviceEntry>>(),
    );
    const sendWire = yield* Ref.make<
      (
        serverId: WebSocket.ServerId,
        clientId: WebSocket.ClientId,
        message: Protocol.MasterMessage,
      ) => Effect.Effect<void>
    >(() => Effect.void);

    const clientKey = (serverId: WebSocket.ServerId, clientId: WebSocket.ClientId) =>
      `${serverId}:${clientId}`;

    const refreshClient = Effect.gen(function* () {
      yield* mg.client.refresh;
      yield* mg.resource.refresh(StreamDeckButton);
      yield* mg.resource.refresh(StreamDeckDevice);
      yield* mg.resource.refresh(StreamDeckServer);
    });

    const send = (
      serverId: WebSocket.ServerId,
      clientId: WebSocket.ClientId,
      message: Protocol.MasterMessage,
    ) => Ref.get(sendWire).pipe(Effect.flatMap((fn) => fn(serverId, clientId, message)));

    const clearClientState = (serverId: WebSocket.ServerId, clientId: WebSocket.ClientId) =>
      Effect.gen(function* () {
        yield* Ref.update(activeClients, (map) => {
          const next = new Map(map);
          next.delete(clientKey(serverId, clientId));
          return next;
        });
        yield* SubscriptionRef.update(bindings, (map) => {
          const next = new Map(map);
          for (const [context, binding] of map)
            if (binding.serverId === serverId && binding.clientId === clientId) next.delete(context);
          return next;
        });
        yield* SubscriptionRef.update(devices, (map) => {
          const next = new Map(map);
          next.delete(serverId);
          return next;
        });
        yield* refreshClient;
      });

    const bindContext = (
      serverId: WebSocket.ServerId,
      clientId: WebSocket.ClientId,
      message: {
        readonly deviceId: string;
        readonly action: string;
        readonly context: string;
        readonly coordinates: { readonly column: number; readonly row: number };
        readonly settings: Readonly<Record<string, unknown>>;
      },
    ) =>
      Effect.gen(function* () {
        const buttonId = buttonIdFromSettings(message.settings);
        if (Option.isNone(buttonId)) {
          yield* SubscriptionRef.update(bindings, (map) => {
            const next = new Map(map);
            next.delete(message.context);
            return next;
          });
          return Option.none<ButtonId>();
        }
        yield* SubscriptionRef.update(bindings, (map) =>
          new Map(map).set(message.context, {
            serverId,
            clientId,
            deviceId: DeviceId.make(message.deviceId),
            action: message.action,
            context: message.context,
            buttonId: buttonId.value,
            column: message.coordinates.column,
            row: message.coordinates.row,
          }),
        );
        return Option.some(buttonId.value);
      });

    const handleInbound = (
      serverId: WebSocket.ServerId,
      clientId: WebSocket.ClientId,
      raw: string,
    ) =>
      Effect.gen(function* () {
        const parsed = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (error) => error,
        }).pipe(Effect.result);
        if (Result.isFailure(parsed))
          return yield* Effect.logWarning("Dropped malformed Stream Deck JSON", { serverId });

        const decoded = yield* Schema.decodeUnknownEffect(Wire.PluginMessage)(parsed.success).pipe(
          Effect.result,
        );
        if (Result.isFailure(decoded))
          return yield* Effect.logWarning("Dropped unknown Stream Deck message", {
            serverId,
            type:
              typeof parsed.success === "object" &&
              parsed.success !== null &&
              "type" in parsed.success
                ? parsed.success.type
                : undefined,
            preview: JSON.stringify(parsed.success).slice(0, 300),
          });

        const message = decoded.success;
        const active = yield* Ref.get(activeClients);
        const isActive = active.has(clientKey(serverId, clientId));

        if (message.type === "hello") {
          if (
            message.version !== Protocol.PROTOCOL_VERSION ||
            message.client !== Protocol.CLIENT_ID
          ) {
            yield* Effect.logWarning("Rejected Stream Deck hello", {
              version: message.version,
              client: message.client,
            });
            yield* Ref.update(activeClients, (map) => {
              const next = new Map(map);
              next.delete(clientKey(serverId, clientId));
              return next;
            });
            return;
          }
          yield* Ref.update(activeClients, (map) =>
            new Map(map).set(clientKey(serverId, clientId), { serverId, clientId }),
          );
          yield* send(serverId, clientId, Protocol.helloAck());
          return;
        }

        if (!isActive) return;

        switch (message.type) {
          case "deviceConnected": {
            const deviceId = DeviceId.make(message.device.id);
            yield* SubscriptionRef.update(devices, (map) => {
              const perServer = new Map(map.get(serverId) ?? []);
              perServer.set(deviceId, {
                id: deviceId,
                type: message.device.type,
                size: message.device.size,
              });
              return new Map(map).set(serverId, perServer);
            });
            yield* refreshClient;
            yield* mg.emit(
              new StreamDeckDeviceConnected({
                deviceId,
                deviceType: message.device.type,
                ...(message.device.size === null
                  ? {}
                  : {
                      columns: message.device.size.column,
                      rows: message.device.size.row,
                    }),
              }),
            );
            return;
          }
          case "deviceDisconnected": {
            const deviceId = DeviceId.make(message.deviceId);
            yield* SubscriptionRef.update(devices, (map) => {
              const perServer = new Map(map.get(serverId) ?? []);
              perServer.delete(deviceId);
              return new Map(map).set(serverId, perServer);
            });
            yield* SubscriptionRef.update(bindings, (map) => {
              const next = new Map(map);
              for (const [context, binding] of map)
                if (binding.deviceId === deviceId) next.delete(context);
              return next;
            });
            yield* refreshClient;
            yield* mg.emit(new StreamDeckDeviceDisconnected({ deviceId }));
            return;
          }
          case "appear": {
            const buttonId = yield* bindContext(serverId, clientId, message);
            yield* refreshClient;
            yield* mg.emit(
              new StreamDeckButtonAppeared({
                deviceId: DeviceId.make(message.deviceId),
                context: message.context,
                column: message.coordinates.column,
                row: message.coordinates.row,
                settings: message.settings,
                ...(Option.isSome(buttonId) ? { buttonId: buttonId.value } : {}),
              }),
            );
            return;
          }
          case "disappear": {
            const existing = (yield* SubscriptionRef.get(bindings)).get(message.context);
            yield* SubscriptionRef.update(bindings, (map) => {
              const next = new Map(map);
              next.delete(message.context);
              return next;
            });
            yield* refreshClient;
            yield* mg.emit(
              new StreamDeckButtonDisappeared({
                deviceId: DeviceId.make(message.deviceId),
                context: message.context,
                ...(existing === undefined ? {} : { buttonId: existing.buttonId }),
              }),
            );
            return;
          }
          case "settingsChanged": {
            const existing = (yield* SubscriptionRef.get(bindings)).get(message.context);
            const buttonId = yield* bindContext(serverId, clientId, {
              deviceId: existing?.deviceId ?? "",
              action: message.action,
              context: message.context,
              coordinates: {
                column: existing?.column ?? 0,
                row: existing?.row ?? 0,
              },
              settings: message.settings,
            });
            yield* refreshClient;
            yield* mg.emit(
              new StreamDeckSettingsChanged({
                context: message.context,
                settings: message.settings,
                ...(Option.isSome(buttonId) ? { buttonId: buttonId.value } : {}),
              }),
            );
            return;
          }
          case "globalSettingsChanged":
            return;
          case "keyDown":
          case "keyUp": {
            const buttonId = buttonIdFromSettings(message.settings);
            if (Option.isNone(buttonId)) return;
            yield* bindContext(serverId, clientId, message);
            const buttonName =
              (yield* mg.storage.get).buttons.find((button) => button.id === buttonId.value)
                ?.name ?? buttonId.value;
            const rawState = message.payload?.state;
            const state =
              typeof rawState === "number" && Number.isFinite(rawState) ? Math.trunc(rawState) : 0;
            const event =
              message.type === "keyDown"
                ? new StreamDeckKeyDown({
                    deviceId: DeviceId.make(message.deviceId),
                    buttonId: buttonId.value,
                    buttonName,
                    context: message.context,
                    column: message.coordinates.column,
                    row: message.coordinates.row,
                    state,
                    settings: message.settings,
                    ...(message.payload === undefined ? {} : { payload: message.payload }),
                  })
                : new StreamDeckKeyUp({
                    deviceId: DeviceId.make(message.deviceId),
                    buttonId: buttonId.value,
                    context: message.context,
                    column: message.coordinates.column,
                    row: message.coordinates.row,
                    state,
                    settings: message.settings,
                    ...(message.payload === undefined ? {} : { payload: message.payload }),
                  });
            yield* mg.emit(event);
            return;
          }
          case "fromPropertyInspector": {
            const existing = (yield* SubscriptionRef.get(bindings)).get(message.context);
            yield* mg.emit(
              new StreamDeckFromPropertyInspector({
                context: message.context,
                payload: message.payload,
                ...(existing === undefined ? {} : { buttonId: existing.buttonId }),
              }),
            );
            return;
          }
          case "queryButtons": {
            const buttons = (yield* mg.storage.get).buttons.map(({ id, name }) => ({
              id,
              name,
            }));
            yield* send(serverId, clientId, Protocol.buttonList(message.requestId, buttons));
            return;
          }
        }
      });

    const base = yield* make(
      {
        ...mg,
        storage: {
          get: mg.storage.get.pipe(
            Effect.map((storage) => {
              const next = ensureDefaultListener(storage);
              return { servers: next.servers };
            }),
          ),
          set: (value) =>
            mg.storage.update((storage) =>
              ensureDefaultListener({
                ...storage,
                servers: value.servers,
              }),
            ),
          update: (update) =>
            mg.storage.update((storage) => {
              const withDefault = ensureDefaultListener(storage);
              return {
                ...withDefault,
                servers: update({ servers: withDefault.servers }).servers,
              };
            }),
        },
        resource: { refresh: () => mg.resource.refresh(StreamDeckServer) },
        emit: (event) =>
          Effect.gen(function* () {
            if (event._tag === "WebSocketServerClientDisconnected") {
              yield* clearClientState(event.serverId, event.clientId);
              return;
            }
            if (event._tag === "WebSocketServerClientConnected") return;
            yield* handleInbound(event.serverId, event.clientId, event.message);
          }),
      },
      adapter,
    );

    const sendToClientRaw = yield* WebSocket.RuntimeRpcs.accessHandler(
      "WebSocketServerSendToClient",
    ).pipe(Effect.provide(base.rpcs));
    const rpcCallOptions = {
      client: new Rpc.ServerClient(0),
      requestId: RequestId("0"),
      headers: Headers.empty,
    };
    yield* Ref.set(
      sendWire,
      (serverId, clientId, message) =>
        sendToClientRaw(
          {
            serverId,
            clientId,
            message: JSON.stringify(message),
          },
          rpcCallOptions,
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Stream Deck send failed", { cause }).pipe(Effect.asVoid),
          ),
        ),
    );

    const resolveBinding = (buttonId: ButtonId) =>
      Effect.gen(function* () {
        const map = yield* SubscriptionRef.get(bindings);
        for (const binding of map.values()) if (binding.buttonId === buttonId) return Option.some(binding);
        return Option.none<Binding>();
      });

    const withBinding = <A>(
      buttonId: ButtonId,
      command: string,
      run: (binding: Binding) => Effect.Effect<A, StreamDeckFailure>,
    ) =>
      Effect.gen(function* () {
        const binding = yield* resolveBinding(buttonId);
        if (Option.isNone(binding)) {
          yield* Effect.logWarning(`Stream Deck ${command}: button unbound`, { buttonId });
          return;
        }
        yield* run(binding.value);
      });

    const sendBound = (
      buttonId: ButtonId,
      command: string,
      message: (binding: Binding) => Protocol.MasterMessage,
    ) =>
      withBinding(buttonId, command, (binding) =>
        send(binding.serverId, binding.clientId, message(binding)).pipe(Effect.asVoid),
      );

    const sendAnyActive = (message: Protocol.MasterMessage) =>
      Effect.gen(function* () {
        const clients = yield* Ref.get(activeClients);
        if (clients.size === 0) {
          yield* Effect.logWarning("Stream Deck command: no plugin client connected");
          return;
        }
        for (const { serverId, clientId } of clients.values())
          yield* send(serverId, clientId, message);
      });

    const normalizeName = (name: string) => {
      const trimmed = name.trim();
      return trimmed.length === 0
        ? Effect.fail(new InvalidButton({ message: "Button name is required" }))
        : Effect.succeed(trimmed);
    };

    const add = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerAdd").pipe(
      Effect.provide(base.client.rpcs),
    );
    const update = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerUpdate").pipe(
      Effect.provide(base.client.rpcs),
    );
    const remove = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerRemove").pipe(
      Effect.provide(base.client.rpcs),
    );
    const start = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerStart").pipe(
      Effect.provide(base.client.rpcs),
    );
    const stop = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerStop").pipe(
      Effect.provide(base.client.rpcs),
    );
    const status = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerStatus").pipe(
      Effect.provide(base.client.rpcs),
    );

    const clientState = Effect.gen(function* () {
      const { servers } = yield* base.client.state;
      const deviceState = yield* SubscriptionRef.get(devices);
      const bindingState = yield* SubscriptionRef.get(bindings);
      const buttons = (yield* mg.storage.get).buttons;
      const deviceList: Array<typeof DeviceState.Type> = [];
      for (const perServer of deviceState.values())
        for (const entry of perServer.values()) {
          const summary = {
            id: entry.id,
            type: entry.type,
            bindingCount: [...bindingState.values()].filter(
              (binding) => binding.deviceId === entry.id,
            ).length,
          };
          deviceList.push(
            entry.size === null
              ? summary
              : { ...summary, columns: entry.size.column, rows: entry.size.row },
          );
        }
      const buttonList: Array<ButtonState> = buttons.map((button) => {
        const binding = [...bindingState.values()].find((entry) => entry.buttonId === button.id);
        return binding === undefined
          ? { id: button.id, name: button.name, bound: false }
          : {
              id: button.id,
              name: button.name,
              bound: true,
              deviceId: binding.deviceId,
              column: binding.column,
              row: binding.row,
            };
      });
      return { servers, buttons: buttonList, devices: deviceList };
    });

    return StreamDeckEngine.of({
      resources: Layer.mergeAll(
        StreamDeckServer.toLayer(
          base.client.state.pipe(
            Effect.map(({ servers }) =>
              servers.map(({ definition }) => ({
                id: definition.id,
                display: definition.name,
              })),
            ),
          ),
        ),
        StreamDeckButton.toLayer(
          mg.storage.get.pipe(
            Effect.map(({ buttons }) =>
              buttons.map((button) => ({ id: button.id, display: button.name })),
            ),
          ),
        ),
        StreamDeckDevice.toLayer(
          SubscriptionRef.get(devices).pipe(
            Effect.map((map) => {
              const list: Array<{ id: DeviceId; display: string }> = [];
              for (const perServer of map.values())
                for (const entry of perServer.values())
                  list.push({ id: entry.id, display: entry.type });
              return list;
            }),
          ),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({
        StreamDeckSetTitle: ({ button, title, state }) =>
          sendBound(button, "setTitle", (binding) =>
            Protocol.setTitle(binding.context, title, state),
          ),
        StreamDeckSetImage: ({ button, image, state }) =>
          sendBound(button, "setImage", (binding) =>
            Protocol.setImage(binding.context, image, state),
          ),
        StreamDeckSetState: ({ button, state }) =>
          sendBound(button, "setState", (binding) => Protocol.setState(binding.context, state)),
        StreamDeckShowOk: ({ button }) =>
          sendBound(button, "showOk", (binding) => Protocol.showOk(binding.context)),
        StreamDeckShowAlert: ({ button }) =>
          sendBound(button, "showAlert", (binding) => Protocol.showAlert(binding.context)),
        StreamDeckSetSettings: ({ button, settingsJson }) =>
          Effect.gen(function* () {
            const settings = yield* parseJsonRecord(settingsJson);
            yield* sendBound(button, "setSettings", (binding) =>
              Protocol.setSettings(binding.context, settings),
            );
          }),
        StreamDeckSendToPropertyInspector: ({ button, payloadJson }) =>
          Effect.gen(function* () {
            const payload = yield* parseJsonRecord(payloadJson);
            yield* sendBound(button, "sendToPropertyInspector", (binding) =>
              Protocol.sendToPropertyInspector({
                action: binding.action,
                context: binding.context,
                payload,
              }),
            );
          }),
        StreamDeckOpenUrl: ({ url }) => sendAnyActive(Protocol.openUrl(url)),
        StreamDeckSetProfile: ({ device, profile }) =>
          sendAnyActive(Protocol.setProfile(device, profile)),
        StreamDeckSwitchToProfile: ({ device, profile, page }) =>
          sendAnyActive(Protocol.switchToProfile(device, profile, page)),
      }),
      client: {
        state: clientState,
        rpcs: ClientRpcs.toLayer({
          StreamDeckWebSocketServerAdd: add,
          StreamDeckWebSocketServerUpdate: update,
          StreamDeckWebSocketServerRemove: remove,
          StreamDeckWebSocketServerStart: start,
          StreamDeckWebSocketServerStop: stop,
          StreamDeckWebSocketServerStatus: status,
          StreamDeckAddButton: ({ name }) =>
            Effect.gen(function* () {
              const normalized = yield* normalizeName(name);
              const id = ButtonId.make(globalThis.crypto.randomUUID());
              yield* mg.storage.update((storage) => ({
                ...storage,
                buttons: [...storage.buttons, { id, name: normalized }],
              }));
              yield* refreshClient;
              return id;
            }),
          StreamDeckUpdateButton: ({ id, name }) =>
            Effect.gen(function* () {
              const normalized = yield* normalizeName(name);
              const storage = yield* mg.storage.get;
              if (!storage.buttons.some((button) => button.id === id))
                return yield* new ButtonNotFound({ id });
              yield* mg.storage.update((current) => ({
                ...current,
                buttons: current.buttons.map((button) =>
                  button.id === id ? { ...button, name: normalized } : button,
                ),
              }));
              yield* refreshClient;
            }),
          StreamDeckRemoveButton: ({ id }) =>
            Effect.gen(function* () {
              const storage = yield* mg.storage.get;
              if (!storage.buttons.some((button) => button.id === id))
                return yield* new ButtonNotFound({ id });
              yield* mg.storage.update((current) => ({
                ...current,
                buttons: current.buttons.filter((button) => button.id !== id),
              }));
              yield* refreshClient;
            }),
        }),
      },
    });
  }),
);

export default layer;
