import { u as unwrapScoped$1, e as embedInput$1, G as GenericTag, w as withFiberRuntime, s as succeed, a as acquireRelease, b as succeed$1, f as flatMap, m as map, c as sync, d as unsafeMakeLatch, g as scopedWith, h as fnUntraced, i as make, j as extend, p as provideService, r as runtime, k as unsafeMake, l as unsafeDone, _ as _void, n as _await, t as timeoutFail, o as raceFirst, q as join, v as catchIf, x as promise, y as andThen, z as isEffect, A as fail, B as mapInputContext, C as merge, D as ensuring, E as interruptible, F as hasProperty, T as TypeIdError, H as gen, I as scope, J as make$1, K as fork, L as sequential, M as into, N as forkIn, O as toChannel$1, P as close, Q as void_, R as zipRight, S as catchAllCause, U as EngineDef, V as pipe, W as EngineState, X as fromEntries, Y as map$1, Z as die, $ as runFork, a0 as tryPromise, a1 as all, a2 as map$2, a3 as zipLeft, a4 as catchAll, a5 as LookupRef, a6 as SocketAddress, a7 as ignore, a8 as Event, a9 as ConnectionFailed, aa as EngineDef$1, ab as make$2, ac as isNone, ad as make$3, ae as make$4, af as HttpClient, ag as withTracerPropagation, ah as mapRequestEffect, ai as orDie, aj as fromNullable, ak as match, al as bearerToken, am as make$5, an as fromInput, ao as getOrUndefined, ap as get, aq as provide, ar as layer, as as makeWith, at as HelixApi, au as unsafeMakeSemaphore, av as never, aw as pipeThroughChannel, ax as decodeText, ay as mapEffect, az as decodeUnknown, aA as parseJson, aB as EventSubMessage, aC as toPull, aD as Scope, aE as get$1, aF as getOrThrowWith, aG as ConnectionFailed$1, aH as fn, aI as get$2, aJ as log, aK as map$3, aL as tap, aM as withSpan, aN as logError, aO as fromPull, aP as runForEach, aQ as decode, aR as SubscriptionEvent, aS as option, aT as isSome, aU as complete, aV as succeed$2, aW as forkScoped, aX as filterStatusOk, aY as catchTags, aZ as retry, a_ as update, a$ as TwitchAPIError, b0 as AccountId, b1 as forkDaemon, b2 as MissingCredential, b3 as isArray, b4 as TaggedError, b5 as EngineDef$2, b6 as TickEvent, b7 as never$1, b8 as EngineDef$3, b9 as empty, ba as entries, bb as EngineState$1, bc as ConnectionFailed$2, bd as set, be as done, bf as catchTag, bg as modify, bh as tapError, bi as fail$1, bj as get$3, bk as WebSocketUrl, bl as remove, bm as has, bn as keys, bo as Event$1 } from "./index-CuhQExW9.js";
import { j as json_default } from "./json-ZCfGR0vq.js";
import "./preload-helper-DPb_hSpc.js";
import "./web-Dl2sEcME.js";
import "./solid-COykZtSy.js";
import "./dots-horizontal-ZGk_uH4H.js";
import "./ZUHR2BAH-DciGzthU.js";
import "./R5675YMU-C6EXqLl_.js";
import "./index-Canl0i0r.js";
import "./store-12zX8qse.js";
import "./button-dTk4F7f6.js";
const embedInput = embedInput$1;
const unwrapScoped = unwrapScoped$1;
const TypeId = /* @__PURE__ */ Symbol.for("@effect/platform/Socket");
const Socket = /* @__PURE__ */ GenericTag("@effect/platform/Socket");
const CloseEventTypeId = /* @__PURE__ */ Symbol.for("@effect/platform/Socket/CloseEvent");
class CloseEvent {
  code;
  reason;
  /**
   * @since 1.0.0
   */
  [CloseEventTypeId];
  constructor(code = 1e3, reason) {
    this.code = code;
    this.reason = reason;
    this[CloseEventTypeId] = CloseEventTypeId;
  }
  /**
   * @since 1.0.0
   */
  toString() {
    return this.reason ? `${this.code}: ${this.reason}` : `${this.code}`;
  }
}
const isCloseEvent = (u) => hasProperty(u, CloseEventTypeId);
const SocketErrorTypeId = /* @__PURE__ */ Symbol.for("@effect/platform/Socket/SocketError");
const isSocketError = (u) => hasProperty(u, SocketErrorTypeId);
class SocketGenericError extends (/* @__PURE__ */ TypeIdError(SocketErrorTypeId, "SocketError")) {
  get message() {
    return `An error occurred during ${this.reason}`;
  }
}
class SocketCloseError extends (/* @__PURE__ */ TypeIdError(SocketErrorTypeId, "SocketError")) {
  /**
   * @since 1.0.0
   */
  static is(u) {
    return isSocketError(u) && u.reason === "Close";
  }
  /**
   * @since 1.0.0
   */
  static isClean(isClean) {
    return function(u) {
      return SocketCloseError.is(u) && isClean(u.code);
    };
  }
  get message() {
    if (this.closeReason) {
      return `${this.reason}: ${this.code}: ${this.closeReason}`;
    }
    return `${this.reason}: ${this.code}`;
  }
}
const toChannelMap = (self, f) => gen(function* () {
  const scope$1 = yield* scope;
  const mailbox = yield* make$1();
  const writeScope = yield* fork(scope$1, sequential);
  const write = yield* extend(self.writer, writeScope);
  function* emit(chunk) {
    for (const data of chunk) {
      yield* write(data);
    }
  }
  const input = {
    awaitRead: () => _void,
    emit(chunk) {
      return catchAllCause(gen(() => emit(chunk)), (cause) => mailbox.failCause(cause));
    },
    error(error) {
      return zipRight(close(writeScope, void_), mailbox.failCause(error));
    },
    done() {
      return close(writeScope, void_);
    }
  };
  yield* self.runRaw((data) => {
    mailbox.unsafeOffer(f(data));
  }).pipe(into(mailbox), forkIn(scope$1), interruptible);
  return embedInput(toChannel$1(mailbox), input);
}).pipe(unwrapScoped);
const toChannel = (self) => {
  const encoder = new TextEncoder();
  return toChannelMap(self, (data) => typeof data === "string" ? encoder.encode(data) : data);
};
const toChannelWith = () => (self) => toChannel(self);
const defaultCloseCodeIsError = (code) => code !== 1e3 && code !== 1006;
const WebSocket = /* @__PURE__ */ GenericTag("@effect/platform/Socket/WebSocket");
const WebSocketConstructor = /* @__PURE__ */ GenericTag("@effect/platform/Socket/WebSocketConstructor");
const layerWebSocketConstructorGlobal = /* @__PURE__ */ succeed(WebSocketConstructor, (url, protocols) => new globalThis.WebSocket(url, protocols));
const makeWebSocket = (url, options) => fromWebSocket(acquireRelease((typeof url === "string" ? succeed$1(url) : url).pipe(flatMap((url2) => map(WebSocketConstructor, (f) => f(url2, options?.protocols)))), (ws) => sync(() => ws.close(1e3))), options);
const fromWebSocket = (acquire, options) => withFiberRuntime((fiber) => {
  let currentWS;
  const latch = unsafeMakeLatch(false);
  const acquireContext = fiber.currentContext;
  const closeCodeIsError = options?.closeCodeIsError ?? defaultCloseCodeIsError;
  const runRaw = (handler, opts) => scopedWith(fnUntraced(function* (scope2) {
    const fiberSet = yield* make().pipe(extend(scope2));
    const ws = yield* extend(acquire, scope2);
    const run2 = yield* provideService(runtime(fiberSet)(), WebSocket, ws);
    let open = false;
    function onMessage(event) {
      if (event.data instanceof Blob) {
        return promise(() => event.data.arrayBuffer()).pipe(andThen((buffer) => handler(new Uint8Array(buffer))), run2);
      }
      const result = handler(event.data);
      if (isEffect(result)) {
        run2(result);
      }
    }
    function onError(cause) {
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
      unsafeDone(fiberSet.deferred, fail(new SocketGenericError({
        reason: open ? "Read" : "Open",
        cause
      })));
    }
    function onClose(event) {
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("error", onError);
      unsafeDone(fiberSet.deferred, fail(new SocketCloseError({
        reason: "Close",
        code: event.code,
        closeReason: event.reason
      })));
    }
    ws.addEventListener("close", onClose, {
      once: true
    });
    ws.addEventListener("error", onError, {
      once: true
    });
    ws.addEventListener("message", onMessage);
    if (ws.readyState !== 1) {
      const openDeferred = unsafeMake(fiber.id());
      ws.addEventListener("open", () => {
        open = true;
        unsafeDone(openDeferred, _void);
      }, {
        once: true
      });
      yield* _await(openDeferred).pipe(timeoutFail({
        duration: options?.openTimeout ?? 1e4,
        onTimeout: () => new SocketGenericError({
          reason: "OpenTimeout",
          cause: 'timeout waiting for "open"'
        })
      }), raceFirst(join(fiberSet)));
    }
    open = true;
    currentWS = ws;
    yield* latch.open;
    if (opts?.onOpen) yield* opts.onOpen;
    return yield* join(fiberSet).pipe(catchIf(SocketCloseError.isClean((_) => !closeCodeIsError(_)), (_) => _void));
  })).pipe(mapInputContext((input) => merge(acquireContext, input)), ensuring(sync(() => {
    latch.unsafeClose();
    currentWS = void 0;
  })), interruptible);
  const encoder = new TextEncoder();
  const run = (handler, opts) => runRaw((data) => typeof data === "string" ? handler(encoder.encode(data)) : data instanceof Uint8Array ? handler(data) : handler(new Uint8Array(data)), opts);
  const write = (chunk) => latch.whenOpen(sync(() => {
    const ws = currentWS;
    if (isCloseEvent(chunk)) {
      ws.close(chunk.code, chunk.reason);
    } else {
      ws.send(chunk);
    }
  }));
  const writer = succeed$1(write);
  return succeed$1(Socket.of({
    [TypeId]: TypeId,
    run,
    runRaw,
    writer
  }));
});
const makeWebSocketChannel = (url, options) => unwrapScoped(map(makeWebSocket(url, options), toChannelWith()));
const obs = EngineDef.toLayer((ctx) => gen(function* () {
  const sockets = /* @__PURE__ */ new Map();
  const saveState = gen(function* () {
    if (!ctx.saveState) return;
    yield* pipe(sockets.entries(), map$1(([key, value]) => [key, {
      password: value.password ?? void 0,
      connectOnStartup: true
    }]), fromEntries, (sockets2) => new EngineState({
      sockets: sockets2
    }), ctx.saveState);
  });
  const callSocket = fnUntraced(function* (address, requestType, requestData) {
    const socket = sockets.get(address);
    if (!socket) return yield* die("Socket not found");
    return yield* promise(() => socket.ws.call(requestType, requestData));
  });
  const createSocket = fnUntraced(function* (address, password) {
    const ws = new json_default();
    const socket = {
      address,
      password: password ?? null,
      ws,
      state: "disconnected"
    };
    sockets.set(address, socket);
    yield* saveState;
    const runSocketEdit = (e) => pipe(e, andThen(ctx.dirtyState), runFork);
    ws.on("ConnectionError", () => sync(() => {
      socket.state = "disconnected";
    }).pipe(runSocketEdit));
    ws.on("ConnectionClosed", () => sync(() => {
      socket.state = "disconnected";
    }).pipe(runSocketEdit));
    ws.on("ConnectionOpened", () => sync(() => {
      socket.state = "connected";
    }).pipe(runSocketEdit));
    addWsEventListeners(ws, address, ctx.emitEvent);
    return socket;
  });
  const connectSocket = fnUntraced(function* (address) {
    const socket = sockets.get(address);
    if (!socket) return;
    socket.state = "connecting";
    yield* ctx.dirtyState;
    yield* tryPromise({
      try: () => socket.ws.connect(address, socket.password ?? void 0),
      catch: () => new ConnectionFailed()
    });
  });
  if (ctx.initialState) yield* all(pipe(ctx.initialState.sockets, map$2((value, address) => createSocket(address, value.password ?? void 0).pipe(zipLeft(value.connectOnStartup ? connectSocket(address).pipe(catchAll(() => _void)) : _void)))));
  return {
    clientState: gen(function* () {
      return {
        sockets: [...sockets.entries()].map(([address, socket]) => ({
          name: address,
          address,
          state: socket.state
        }))
      };
    }),
    resources: {
      OBSWebSocket: yield* LookupRef.make(sync(() => [...sockets.keys()].map((address) => ({
        id: address,
        display: address
      }))))
    },
    clientRpcs: {
      AddSocket: fnUntraced(function* (opts) {
        const socket = yield* createSocket(opts.address, opts.password);
        yield* ctx.dirtyState;
        yield* tryPromise({
          try: () => socket.ws.connect(opts.address, opts.password),
          catch: () => new ConnectionFailed()
        });
      }),
      RemoveSocket: fnUntraced(function* ({
        address: address_
      }) {
        const address = SocketAddress.make(address_);
        const socket = sockets.get(address);
        if (!socket) return;
        yield* promise(() => socket.ws.disconnect()).pipe(ignore);
        sockets.delete(address);
        yield* ctx.dirtyState;
        yield* saveState;
      }),
      ConnectSocket: ({
        address
      }) => connectSocket(address),
      DisconnectSocket: fnUntraced(function* ({
        address: address_
      }) {
        const address = SocketAddress.make(address_);
        const socket = sockets.get(address);
        if (!socket) return;
        yield* promise(() => socket.ws.disconnect()).pipe(ignore);
      })
    },
    runtimeRpcs: {
      BroadcastCustomEvent: ({
        address,
        eventData
      }) => callSocket(address, "BroadcastCustomEvent", {
        eventData
      }),
      CallVendorRequest: ({
        address,
        vendorName,
        requestType,
        requestData
      }) => callSocket(address, "CallVendorRequest", {
        vendorName,
        requestType,
        requestData
      }),
      CreateInput: ({
        address,
        sceneName,
        inputName,
        inputKind,
        inputSettings,
        sceneItemEnabled
      }) => callSocket(address, "CreateInput", {
        sceneName,
        inputName,
        inputKind,
        inputSettings,
        sceneItemEnabled
      }),
      CreateProfile: ({
        address,
        profileName
      }) => callSocket(address, "CreateProfile", {
        profileName
      }),
      CreateRecordChapter: ({
        address,
        chapterName
      }) => callSocket(address, "CreateRecordChapter", {
        chapterName
      }),
      CreateScene: ({
        address,
        sceneName
      }) => callSocket(address, "CreateScene", {
        sceneName
      }),
      CreateSceneCollection: ({
        address,
        sceneCollectionName
      }) => callSocket(address, "CreateSceneCollection", {
        sceneCollectionName
      }),
      CreateSceneItem: ({
        address,
        sceneName,
        sourceName,
        sceneItemEnabled
      }) => callSocket(address, "CreateSceneItem", {
        sceneName,
        sourceName,
        sceneItemEnabled
      }),
      CreateSourceFilter: ({
        address,
        sourceName,
        filterName,
        filterKind,
        filterSettings
      }) => callSocket(address, "CreateSourceFilter", {
        sourceName,
        filterName,
        filterKind,
        filterSettings
      }),
      DuplicateSceneItem: ({
        address,
        sceneName,
        sceneItemId,
        destinationSceneName
      }) => callSocket(address, "DuplicateSceneItem", {
        sceneName,
        sceneItemId,
        destinationSceneName
      }),
      GetCurrentPreviewScene: ({
        address
      }) => callSocket(address, "GetCurrentPreviewScene"),
      GetCurrentProgramScene: ({
        address
      }) => callSocket(address, "GetCurrentProgramScene"),
      GetCurrentSceneTransition: ({
        address
      }) => callSocket(address, "GetCurrentSceneTransition"),
      GetCurrentSceneTransitionCursor: ({
        address
      }) => callSocket(address, "GetCurrentSceneTransitionCursor"),
      GetGroupList: ({
        address
      }) => callSocket(address, "GetGroupList"),
      GetGroupSceneItemList: ({
        address,
        sceneName
      }) => callSocket(address, "GetGroupSceneItemList", {
        sceneName
      }),
      GetHotkeyList: ({
        address
      }) => callSocket(address, "GetHotkeyList"),
      GetInputAudioBalance: ({
        address,
        inputName
      }) => callSocket(address, "GetInputAudioBalance", {
        inputName
      }),
      GetInputAudioMonitorType: ({
        address,
        inputName
      }) => callSocket(address, "GetInputAudioMonitorType", {
        inputName
      }),
      GetInputAudioSyncOffset: ({
        address,
        inputName
      }) => callSocket(address, "GetInputAudioSyncOffset", {
        inputName
      }),
      GetInputAudioTracks: ({
        address,
        inputName
      }) => callSocket(address, "GetInputAudioTracks", {
        inputName
      }),
      GetInputDefaultSettings: ({
        address,
        inputKind
      }) => callSocket(address, "GetInputDefaultSettings", {
        inputKind
      }),
      GetInputDeinterlaceFieldOrder: ({
        address,
        inputName
      }) => callSocket(address, "GetInputDeinterlaceFieldOrder", {
        inputName
      }),
      GetInputDeinterlaceMode: ({
        address,
        inputName
      }) => callSocket(address, "GetInputDeinterlaceMode", {
        inputName
      }),
      GetInputKindList: ({
        address,
        unversioned
      }) => callSocket(address, "GetInputKindList", {
        unversioned
      }),
      GetInputList: ({
        address,
        inputKind
      }) => callSocket(address, "GetInputList", {
        inputKind
      }),
      GetInputMute: ({
        address,
        inputName
      }) => callSocket(address, "GetInputMute", {
        inputName
      }),
      GetInputPropertiesListPropertyItems: ({
        address,
        inputName,
        propertyName
      }) => callSocket(address, "GetInputPropertiesListPropertyItems", {
        inputName,
        propertyName
      }),
      GetInputSettings: ({
        address,
        inputName
      }) => callSocket(address, "GetInputSettings", {
        inputName
      }),
      GetInputVolume: ({
        address,
        inputName
      }) => callSocket(address, "GetInputVolume", {
        inputName
      }),
      GetLastReplayBufferReplay: ({
        address
      }) => callSocket(address, "GetLastReplayBufferReplay"),
      GetMediaInputStatus: ({
        address,
        inputName
      }) => callSocket(address, "GetMediaInputStatus", {
        inputName
      }),
      GetMonitorList: ({
        address
      }) => callSocket(address, "GetMonitorList"),
      GetOutputList: ({
        address
      }) => callSocket(address, "GetOutputList"),
      GetOutputSettings: ({
        address,
        outputName
      }) => callSocket(address, "GetOutputSettings", {
        outputName
      }),
      GetOutputStatus: ({
        address,
        outputName
      }) => callSocket(address, "GetOutputStatus", {
        outputName
      }),
      GetPersistentData: ({
        address,
        realm,
        slotName
      }) => callSocket(address, "GetPersistentData", {
        realm,
        slotName
      }),
      GetProfileList: ({
        address
      }) => callSocket(address, "GetProfileList"),
      GetProfileParameter: ({
        address,
        parameterCategory,
        parameterName
      }) => callSocket(address, "GetProfileParameter", {
        parameterCategory,
        parameterName
      }),
      GetRecordDirectory: ({
        address
      }) => callSocket(address, "GetRecordDirectory"),
      GetRecordStatus: ({
        address
      }) => callSocket(address, "GetRecordStatus"),
      GetReplayBufferStatus: ({
        address
      }) => callSocket(address, "GetReplayBufferStatus"),
      GetSceneCollectionList: ({
        address
      }) => callSocket(address, "GetSceneCollectionList"),
      GetSceneItemBlendMode: ({
        address,
        sceneName,
        sceneItemId
      }) => callSocket(address, "GetSceneItemBlendMode", {
        sceneName,
        sceneItemId
      }),
      GetSceneItemEnabled: ({
        address,
        sceneName,
        sceneItemId
      }) => callSocket(address, "GetSceneItemEnabled", {
        sceneName,
        sceneItemId
      }),
      GetSceneItemId: ({
        address,
        sceneName,
        sourceName,
        searchOffset
      }) => callSocket(address, "GetSceneItemId", {
        sceneName,
        sourceName,
        searchOffset
      }),
      GetSceneItemIndex: ({
        address,
        sceneName,
        sceneItemId
      }) => callSocket(address, "GetSceneItemIndex", {
        sceneName,
        sceneItemId
      }),
      GetSceneItemList: ({
        address,
        sceneName
      }) => callSocket(address, "GetSceneItemList", {
        sceneName
      }),
      GetSceneItemLocked: ({
        address,
        sceneName,
        sceneItemId
      }) => callSocket(address, "GetSceneItemLocked", {
        sceneName,
        sceneItemId
      }),
      GetSceneItemSource: ({
        address,
        sceneName,
        sceneItemId
      }) => callSocket(address, "GetSceneItemSource", {
        sceneName,
        sceneItemId
      }),
      GetSceneItemTransform: ({
        address,
        sceneName,
        sceneItemId
      }) => callSocket(address, "GetSceneItemTransform", {
        sceneName,
        sceneItemId
      }),
      GetSceneList: ({
        address
      }) => callSocket(address, "GetSceneList").pipe(map((v) => v)),
      GetSceneSceneTransitionOverride: ({
        address,
        sceneName
      }) => callSocket(address, "GetSceneSceneTransitionOverride", {
        sceneName
      }),
      GetSceneTransitionList: ({
        address
      }) => callSocket(address, "GetSceneTransitionList"),
      GetSourceActive: ({
        address,
        sourceName
      }) => callSocket(address, "GetSourceActive", {
        sourceName
      }),
      GetSourceFilter: ({
        address,
        sourceName,
        filterName
      }) => callSocket(address, "GetSourceFilter", {
        sourceName,
        filterName
      }),
      GetSourceFilterDefaultSettings: ({
        address,
        filterKind
      }) => callSocket(address, "GetSourceFilterDefaultSettings", {
        filterKind
      }),
      GetSourceFilterKindList: ({
        address
      }) => callSocket(address, "GetSourceFilterKindList"),
      GetSourceFilterList: ({
        address,
        sourceName
      }) => callSocket(address, "GetSourceFilterList", {
        sourceName
      }),
      GetSourceScreenshot: ({
        address,
        sourceName,
        imageFormat,
        imageWidth,
        imageHeight,
        imageCompressionQuality
      }) => callSocket(address, "GetSourceScreenshot", {
        sourceName,
        imageFormat,
        imageWidth,
        imageHeight,
        imageCompressionQuality
      }),
      GetSpecialInputs: ({
        address
      }) => callSocket(address, "GetSpecialInputs"),
      GetStats: ({
        address
      }) => callSocket(address, "GetStats"),
      GetStreamServiceSettings: ({
        address
      }) => callSocket(address, "GetStreamServiceSettings"),
      GetStreamStatus: ({
        address
      }) => callSocket(address, "GetStreamStatus"),
      GetStudioModeEnabled: ({
        address
      }) => callSocket(address, "GetStudioModeEnabled"),
      GetTransitionKindList: ({
        address
      }) => callSocket(address, "GetTransitionKindList"),
      GetVersion: ({
        address
      }) => callSocket(address, "GetVersion"),
      GetVideoSettings: ({
        address
      }) => callSocket(address, "GetVideoSettings"),
      GetVirtualCamStatus: ({
        address
      }) => callSocket(address, "GetVirtualCamStatus"),
      OffsetMediaInputCursor: ({
        address,
        inputName,
        mediaCursorOffset
      }) => callSocket(address, "OffsetMediaInputCursor", {
        inputName,
        mediaCursorOffset
      }),
      OpenInputFiltersDialog: ({
        address,
        inputName
      }) => callSocket(address, "OpenInputFiltersDialog", {
        inputName
      }),
      OpenInputInteractDialog: ({
        address,
        inputName
      }) => callSocket(address, "OpenInputInteractDialog", {
        inputName
      }),
      OpenInputPropertiesDialog: ({
        address,
        inputName
      }) => callSocket(address, "OpenInputPropertiesDialog", {
        inputName
      }),
      OpenSourceProjector: ({
        address,
        sourceName,
        monitorIndex,
        projectorGeometry
      }) => callSocket(address, "OpenSourceProjector", {
        sourceName,
        monitorIndex,
        projectorGeometry
      }),
      OpenVideoMixProjector: ({
        address,
        videoMixType,
        monitorIndex,
        projectorGeometry
      }) => callSocket(address, "OpenVideoMixProjector", {
        videoMixType,
        monitorIndex,
        projectorGeometry
      }),
      PauseRecord: ({
        address
      }) => callSocket(address, "PauseRecord"),
      PressInputPropertiesButton: ({
        address,
        inputName,
        propertyName
      }) => callSocket(address, "PressInputPropertiesButton", {
        inputName,
        propertyName
      }),
      RemoveInput: ({
        address,
        inputName
      }) => callSocket(address, "RemoveInput", {
        inputName
      }),
      RemoveProfile: ({
        address,
        profileName
      }) => callSocket(address, "RemoveProfile", {
        profileName
      }),
      RemoveScene: ({
        address,
        sceneName
      }) => callSocket(address, "RemoveScene", {
        sceneName
      }),
      RemoveSceneItem: ({
        address,
        sceneName,
        sceneItemId
      }) => callSocket(address, "RemoveSceneItem", {
        sceneName,
        sceneItemId
      }),
      RemoveSourceFilter: ({
        address,
        sourceName,
        filterName
      }) => callSocket(address, "RemoveSourceFilter", {
        sourceName,
        filterName
      }),
      ResumeRecord: ({
        address
      }) => callSocket(address, "ResumeRecord"),
      SaveReplayBuffer: ({
        address
      }) => callSocket(address, "SaveReplayBuffer"),
      SaveSourceScreenshot: ({
        address,
        sourceName,
        imageFormat,
        imageFilePath,
        imageWidth,
        imageHeight,
        imageCompressionQuality
      }) => callSocket(address, "SaveSourceScreenshot", {
        sourceName,
        imageFormat,
        imageFilePath,
        imageWidth,
        imageHeight,
        imageCompressionQuality
      }),
      SendStreamCaption: ({
        address,
        captionText
      }) => callSocket(address, "SendStreamCaption", {
        captionText
      }),
      SetCurrentPreviewScene: ({
        address,
        sceneName
      }) => callSocket(address, "SetCurrentPreviewScene", {
        sceneName
      }),
      SetCurrentProfile: ({
        address,
        profileName
      }) => callSocket(address, "SetCurrentProfile", {
        profileName
      }),
      SetCurrentProgramScene: ({
        address,
        sceneName
      }) => callSocket(address, "SetCurrentProgramScene", {
        sceneName
      }),
      SetCurrentSceneCollection: ({
        address,
        sceneCollectionName
      }) => callSocket(address, "SetCurrentSceneCollection", {
        sceneCollectionName
      }),
      SetCurrentSceneTransition: ({
        address,
        transitionName
      }) => callSocket(address, "SetCurrentSceneTransition", {
        transitionName
      }),
      SetCurrentSceneTransitionDuration: ({
        address,
        transitionDuration
      }) => callSocket(address, "SetCurrentSceneTransitionDuration", {
        transitionDuration
      }),
      SetCurrentSceneTransitionSettings: ({
        address,
        transitionSettings,
        overlay
      }) => callSocket(address, "SetCurrentSceneTransitionSettings", {
        transitionSettings,
        overlay
      }),
      SetInputAudioBalance: ({
        address,
        inputName,
        inputAudioBalance
      }) => callSocket(address, "SetInputAudioBalance", {
        inputName,
        inputAudioBalance
      }),
      SetInputAudioMonitorType: ({
        address,
        inputName,
        monitorType
      }) => callSocket(address, "SetInputAudioMonitorType", {
        inputName,
        monitorType
      }),
      SetInputAudioSyncOffset: ({
        address,
        inputName,
        inputAudioSyncOffset
      }) => callSocket(address, "SetInputAudioSyncOffset", {
        inputName,
        inputAudioSyncOffset
      }),
      SetInputAudioTracks: ({
        address,
        inputName,
        inputAudioTracks
      }) => callSocket(address, "SetInputAudioTracks", {
        inputName,
        inputAudioTracks
      }),
      SetInputDeinterlaceFieldOrder: ({
        address,
        inputName,
        inputDeinterlaceFieldOrder
      }) => callSocket(address, "SetInputDeinterlaceFieldOrder", {
        inputName,
        inputDeinterlaceFieldOrder
      }),
      SetInputDeinterlaceMode: ({
        address,
        inputName,
        inputDeinterlaceMode
      }) => callSocket(address, "SetInputDeinterlaceMode", {
        inputName,
        inputDeinterlaceMode
      }),
      SetInputMute: ({
        address,
        inputName,
        inputMuted
      }) => callSocket(address, "SetInputMute", {
        inputName,
        inputMuted
      }),
      SetInputName: ({
        address,
        inputName,
        newInputName
      }) => callSocket(address, "SetInputName", {
        inputName,
        newInputName
      }),
      SetInputSettings: ({
        address,
        inputName,
        inputSettings,
        overlay
      }) => callSocket(address, "SetInputSettings", {
        inputName,
        inputSettings,
        overlay
      }),
      SetInputVolume: ({
        address,
        inputName,
        inputVolumeMul,
        inputVolumeDb
      }) => callSocket(address, "SetInputVolume", {
        inputName,
        inputVolumeMul,
        inputVolumeDb
      }),
      SetMediaInputCursor: ({
        address,
        inputName,
        mediaCursor
      }) => callSocket(address, "SetMediaInputCursor", {
        inputName,
        mediaCursor
      }),
      SetOutputSettings: ({
        address,
        outputName,
        outputSettings
      }) => callSocket(address, "SetOutputSettings", {
        outputName,
        outputSettings
      }),
      SetPersistentData: ({
        address,
        realm,
        slotName,
        slotValue
      }) => callSocket(address, "SetPersistentData", {
        realm,
        slotName,
        slotValue
      }),
      SetProfileParameter: ({
        address,
        parameterCategory,
        parameterName,
        parameterValue
      }) => callSocket(address, "SetProfileParameter", {
        parameterCategory,
        parameterName,
        parameterValue
      }),
      SetRecordDirectory: ({
        address,
        recordDirectory
      }) => callSocket(address, "SetRecordDirectory", {
        recordDirectory
      }),
      SetSceneItemBlendMode: ({
        address,
        sceneName,
        sceneItemId,
        sceneItemBlendMode
      }) => callSocket(address, "SetSceneItemBlendMode", {
        sceneName,
        sceneItemId,
        sceneItemBlendMode
      }),
      SetSceneItemEnabled: ({
        address,
        sceneName,
        sceneItemId,
        sceneItemEnabled
      }) => callSocket(address, "SetSceneItemEnabled", {
        sceneName,
        sceneItemId,
        sceneItemEnabled
      }),
      SetSceneItemIndex: ({
        address,
        sceneName,
        sceneItemId,
        sceneItemIndex
      }) => callSocket(address, "SetSceneItemIndex", {
        sceneName,
        sceneItemId,
        sceneItemIndex
      }),
      SetSceneItemLocked: ({
        address,
        sceneName,
        sceneItemId,
        sceneItemLocked
      }) => callSocket(address, "SetSceneItemLocked", {
        sceneName,
        sceneItemId,
        sceneItemLocked
      }),
      SetSceneItemTransform: ({
        address,
        sceneName,
        sceneItemId,
        sceneItemTransform
      }) => callSocket(address, "SetSceneItemTransform", {
        sceneName,
        sceneItemId,
        sceneItemTransform
      }),
      SetSceneName: ({
        address,
        sceneName,
        newSceneName
      }) => callSocket(address, "SetSceneName", {
        sceneName,
        newSceneName
      }),
      SetSceneSceneTransitionOverride: ({
        address,
        sceneName,
        transitionName,
        transitionDuration
      }) => callSocket(address, "SetSceneSceneTransitionOverride", {
        sceneName,
        transitionName,
        transitionDuration
      }),
      SetSourceFilterEnabled: ({
        address,
        sourceName,
        filterName,
        filterEnabled
      }) => callSocket(address, "SetSourceFilterEnabled", {
        sourceName,
        filterName,
        filterEnabled
      }),
      SetSourceFilterIndex: ({
        address,
        sourceName,
        filterName,
        filterIndex
      }) => callSocket(address, "SetSourceFilterIndex", {
        sourceName,
        filterName,
        filterIndex
      }),
      SetSourceFilterName: ({
        address,
        sourceName,
        filterName,
        newFilterName
      }) => callSocket(address, "SetSourceFilterName", {
        sourceName,
        filterName,
        newFilterName
      }),
      SetSourceFilterSettings: ({
        address,
        sourceName,
        filterName,
        filterSettings,
        overlay
      }) => callSocket(address, "SetSourceFilterSettings", {
        sourceName,
        filterName,
        filterSettings,
        overlay
      }),
      SetStreamServiceSettings: ({
        address,
        streamServiceType,
        streamServiceSettings
      }) => callSocket(address, "SetStreamServiceSettings", {
        streamServiceType,
        streamServiceSettings
      }),
      SetStudioModeEnabled: ({
        address,
        studioModeEnabled
      }) => callSocket(address, "SetStudioModeEnabled", {
        studioModeEnabled
      }),
      SetTBarPosition: ({
        address,
        position,
        release
      }) => callSocket(address, "SetTBarPosition", {
        position,
        release
      }),
      SetVideoSettings: ({
        address,
        fpsNumerator,
        fpsDenominator,
        baseWidth,
        baseHeight,
        outputWidth,
        outputHeight
      }) => callSocket(address, "SetVideoSettings", {
        fpsNumerator,
        fpsDenominator,
        baseWidth,
        baseHeight,
        outputWidth,
        outputHeight
      }),
      Sleep: ({
        address,
        sleepMillis,
        sleepFrames
      }) => callSocket(address, "Sleep", {
        sleepMillis,
        sleepFrames
      }),
      SplitRecordFile: ({
        address
      }) => callSocket(address, "SplitRecordFile"),
      StartOutput: ({
        address,
        outputName
      }) => callSocket(address, "StartOutput", {
        outputName
      }),
      StartRecord: ({
        address
      }) => callSocket(address, "StartRecord"),
      StartReplayBuffer: ({
        address
      }) => callSocket(address, "StartReplayBuffer"),
      StartStream: ({
        address
      }) => callSocket(address, "StartStream"),
      StartVirtualCam: ({
        address
      }) => callSocket(address, "StartVirtualCam"),
      StopOutput: ({
        address,
        outputName
      }) => callSocket(address, "StopOutput", {
        outputName
      }),
      StopRecord: ({
        address
      }) => callSocket(address, "StopRecord"),
      StopReplayBuffer: ({
        address
      }) => callSocket(address, "StopReplayBuffer"),
      StopStream: ({
        address
      }) => callSocket(address, "StopStream"),
      StopVirtualCam: ({
        address
      }) => callSocket(address, "StopVirtualCam"),
      ToggleInputMute: ({
        address,
        inputName
      }) => callSocket(address, "ToggleInputMute", {
        inputName
      }),
      ToggleOutput: ({
        address,
        outputName
      }) => callSocket(address, "ToggleOutput", {
        outputName
      }),
      ToggleRecord: ({
        address
      }) => callSocket(address, "ToggleRecord"),
      ToggleRecordPause: ({
        address
      }) => callSocket(address, "ToggleRecordPause"),
      ToggleReplayBuffer: ({
        address
      }) => callSocket(address, "ToggleReplayBuffer"),
      ToggleStream: ({
        address
      }) => callSocket(address, "ToggleStream"),
      ToggleVirtualCam: ({
        address
      }) => callSocket(address, "ToggleVirtualCam"),
      TriggerHotkeyByKeySequence: ({
        address,
        keyId,
        keyModifiers
      }) => callSocket(address, "TriggerHotkeyByKeySequence", {
        keyId,
        keyModifiers
      }),
      TriggerHotkeyByName: ({
        address,
        hotkeyName,
        contextName
      }) => callSocket(address, "TriggerHotkeyByName", {
        hotkeyName,
        contextName
      }),
      TriggerMediaInputAction: ({
        address,
        inputName,
        mediaAction
      }) => callSocket(address, "TriggerMediaInputAction", {
        inputName,
        mediaAction
      }),
      TriggerStudioModeTransition: ({
        address
      }) => callSocket(address, "TriggerStudioModeTransition")
    }
  };
}));
function addWsEventListeners(ws, address, onEvent) {
  ws.on("CurrentProgramSceneChanged", (e) => {
    onEvent(new Event.CurrentProgramSceneChanged({
      ...e,
      address
    }));
  });
  ws.on("ExitStarted", () => {
    onEvent(new Event.ExitStarted({
      address
    }));
  });
  ws.on("CustomEvent", (e) => {
    onEvent(new Event.CustomEvent({
      address,
      eventData: JSON.stringify(e.eventData)
    }));
  });
  ws.on("CurrentSceneCollectionChanging", (e) => {
    onEvent(new Event.CurrentSceneCollectionChanging({
      ...e,
      address
    }));
  });
  ws.on("CurrentSceneCollectionChanged", (e) => {
    onEvent(new Event.CurrentSceneCollectionChanged({
      ...e,
      address
    }));
  });
  ws.on("SceneCollectionListChanged", (e) => {
    onEvent(new Event.SceneCollectionListChanged({
      address,
      sceneCollections: JSON.stringify(e.sceneCollections)
    }));
  });
  ws.on("CurrentProfileChanging", (e) => {
    onEvent(new Event.CurrentProfileChanging({
      ...e,
      address
    }));
  });
  ws.on("CurrentProfileChanged", (e) => {
    onEvent(new Event.CurrentProfileChanged({
      ...e,
      address
    }));
  });
  ws.on("ProfileListChanged", (e) => {
    onEvent(new Event.ProfileListChanged({
      address,
      profiles: JSON.stringify(e.profiles)
    }));
  });
  ws.on("SourceFilterListReindexed", (e) => {
    onEvent(new Event.SourceFilterListReindexed({
      address,
      sourceName: e.sourceName,
      filters: JSON.stringify(e.filters)
    }));
  });
  ws.on("SourceFilterCreated", (e) => {
    onEvent(new Event.SourceFilterCreated({
      address,
      sourceName: e.sourceName,
      filterName: e.filterName,
      filterKind: e.filterKind,
      filterIndex: e.filterIndex,
      filterSettings: JSON.stringify(e.filterSettings)
    }));
  });
  ws.on("SourceFilterRemoved", (e) => {
    onEvent(new Event.SourceFilterRemoved({
      ...e,
      address
    }));
  });
  ws.on("SourceFilterNameChanged", (e) => {
    onEvent(new Event.SourceFilterNameChanged({
      ...e,
      address
    }));
  });
  ws.on("SourceFilterSettingsChanged", (e) => {
    onEvent(new Event.SourceFilterSettingsChanged({
      address,
      sourceName: e.sourceName,
      filterName: e.filterName,
      filterSettings: JSON.stringify(e.filterSettings)
    }));
  });
  ws.on("SourceFilterEnableStateChanged", (e) => {
    onEvent(new Event.SourceFilterEnableStateChanged({
      ...e,
      address
    }));
  });
  ws.on("InputCreated", (e) => {
    onEvent(new Event.InputCreated({
      address,
      inputName: e.inputName,
      inputUuid: e.inputUuid,
      inputKind: e.inputKind,
      inputSettings: JSON.stringify(e.inputSettings)
    }));
  });
  ws.on("InputRemoved", (e) => {
    onEvent(new Event.InputRemoved({
      ...e,
      address
    }));
  });
  ws.on("InputNameChanged", (e) => {
    onEvent(new Event.InputNameChanged({
      ...e,
      address
    }));
  });
  ws.on("InputSettingsChanged", (e) => {
    onEvent(new Event.InputSettingsChanged({
      address,
      inputName: e.inputName,
      inputUuid: e.inputUuid,
      inputSettings: JSON.stringify(e.inputSettings)
    }));
  });
  ws.on("InputMuteStateChanged", (e) => {
    onEvent(new Event.InputMuteStateChanged({
      ...e,
      address
    }));
  });
  ws.on("InputVolumeChanged", (e) => {
    onEvent(new Event.InputVolumeChanged({
      ...e,
      address
    }));
  });
  ws.on("InputAudioBalanceChanged", (e) => {
    onEvent(new Event.InputAudioBalanceChanged({
      ...e,
      address
    }));
  });
  ws.on("InputAudioSyncOffsetChanged", (e) => {
    onEvent(new Event.InputAudioSyncOffsetChanged({
      ...e,
      address
    }));
  });
  ws.on("InputAudioTracksChanged", (e) => {
    onEvent(new Event.InputAudioTracksChanged({
      address,
      inputName: e.inputName,
      inputUuid: e.inputUuid,
      inputAudioTracks: JSON.stringify(e.inputAudioTracks)
    }));
  });
  ws.on("InputAudioMonitorTypeChanged", (e) => {
    onEvent(new Event.InputAudioMonitorTypeChanged({
      ...e,
      address
    }));
  });
  ws.on("MediaInputPlaybackStarted", (e) => {
    onEvent(new Event.MediaInputPlaybackStarted({
      ...e,
      address
    }));
  });
  ws.on("MediaInputPlaybackEnded", (e) => {
    onEvent(new Event.MediaInputPlaybackEnded({
      ...e,
      address
    }));
  });
  ws.on("MediaInputActionTriggered", (e) => {
    onEvent(new Event.MediaInputActionTriggered({
      ...e,
      address
    }));
  });
  ws.on("StreamStateChanged", (e) => {
    onEvent(new Event.StreamStateChanged({
      ...e,
      address
    }));
  });
  ws.on("RecordStateChanged", (e) => {
    onEvent(new Event.RecordStateChanged({
      ...e,
      address
    }));
  });
  ws.on("ReplayBufferStateChanged", (e) => {
    onEvent(new Event.ReplayBufferStateChanged({
      ...e,
      address
    }));
  });
  ws.on("VirtualcamStateChanged", (e) => {
    onEvent(new Event.VirtualcamStateChanged({
      ...e,
      address
    }));
  });
  ws.on("ReplayBufferSaved", (e) => {
    onEvent(new Event.ReplayBufferSaved({
      ...e,
      address
    }));
  });
  ws.on("SceneItemCreated", (e) => {
    onEvent(new Event.SceneItemCreated({
      ...e,
      address
    }));
  });
  ws.on("SceneItemRemoved", (e) => {
    onEvent(new Event.SceneItemRemoved({
      ...e,
      address
    }));
  });
  ws.on("SceneItemListReindexed", (e) => {
    onEvent(new Event.SceneItemListReindexed({
      address,
      sceneName: e.sceneName,
      sceneUuid: e.sceneUuid,
      sceneItems: JSON.stringify(e.sceneItems)
    }));
  });
  ws.on("SceneItemEnableStateChanged", (e) => {
    onEvent(new Event.SceneItemEnableStateChanged({
      ...e,
      address
    }));
  });
  ws.on("SceneItemLockStateChanged", (e) => {
    onEvent(new Event.SceneItemLockStateChanged({
      ...e,
      address
    }));
  });
  ws.on("SceneItemSelected", (e) => {
    onEvent(new Event.SceneItemSelected({
      ...e,
      address
    }));
  });
  ws.on("SceneCreated", (e) => {
    onEvent(new Event.SceneCreated({
      ...e,
      address
    }));
  });
  ws.on("SceneRemoved", (e) => {
    onEvent(new Event.SceneRemoved({
      ...e,
      address
    }));
  });
  ws.on("SceneNameChanged", (e) => {
    onEvent(new Event.SceneNameChanged({
      ...e,
      address
    }));
  });
  ws.on("CurrentPreviewSceneChanged", (e) => {
    onEvent(new Event.CurrentPreviewSceneChanged({
      ...e,
      address
    }));
  });
  ws.on("SceneListChanged", (e) => {
    onEvent(new Event.SceneListChanged({
      address,
      scenes: JSON.stringify(e.scenes)
    }));
  });
  ws.on("CurrentSceneTransitionChanged", (e) => {
    onEvent(new Event.CurrentSceneTransitionChanged({
      ...e,
      address
    }));
  });
  ws.on("CurrentSceneTransitionDurationChanged", (e) => {
    onEvent(new Event.CurrentSceneTransitionDurationChanged({
      ...e,
      address
    }));
  });
  ws.on("SceneTransitionStarted", (e) => {
    onEvent(new Event.SceneTransitionStarted({
      ...e,
      address
    }));
  });
  ws.on("SceneTransitionEnded", (e) => {
    onEvent(new Event.SceneTransitionEnded({
      ...e,
      address
    }));
  });
  ws.on("SceneTransitionVideoEnded", (e) => {
    onEvent(new Event.SceneTransitionVideoEnded({
      ...e,
      address
    }));
  });
  ws.on("StudioModeStateChanged", (e) => {
    onEvent(new Event.StudioModeStateChanged({
      ...e,
      address
    }));
  });
  ws.on("ScreenshotSaved", (e) => {
    onEvent(new Event.ScreenshotSaved({
      ...e,
      address
    }));
  });
  ws.on("VendorEvent", (e) => {
    onEvent(new Event.VendorEvent({
      address,
      vendorName: e.vendorName,
      eventType: e.eventType,
      eventData: JSON.stringify(e.eventData)
    }));
  });
}
const CLIENT_ID = "ldbp0fkq9yalf2lzsi146i0cip8y59";
class RetryRequest extends TaggedError("RetryRequest") {
}
const twitch = EngineDef$1.toLayer((ctx) => gen(function* () {
  const sockets = /* @__PURE__ */ new Map();
  const activeSubscriptions = /* @__PURE__ */ new Map();
  const enabledSubscriptionsRef = yield* make$2(ctx.initialState?.enabledSubscriptions ?? {});
  const runSocketEdit = (e) => pipe(e, andThen(ctx.dirtyState), forkDaemon);
  const getEnabledSubscriptions = (accountId) => get$2(enabledSubscriptionsRef).pipe(map((state) => state[accountId] ?? []));
  const getCredential = (accountId) => ctx.credentials.get.pipe(map((c) => c.find((c2) => c2.provider === "twitch" && c2.id === accountId)), map(fromNullable));
  const createHelixClient = (accountId) => gen(function* () {
    const CredentialRefresh = (c) => c.pipe(filterStatusOk, catchTags({
      ResponseError: fnUntraced(function* (e) {
        if (e.response.status === 401) {
          yield* ctx.refreshCredential("twitch", accountId);
          return yield* new RetryRequest();
        }
        return yield* fail(e);
      })
    }), retry({
      times: 1,
      while: (e) => e._tag === "RetryRequest"
    }));
    const credential = yield* getCredential(accountId);
    if (isNone(credential)) return yield* new MissingCredential();
    const httpClient = yield* HttpClient.pipe(map((client) => pipe(client, mapRequestEffect((req) => succeed$1(make$5(req.method)(req.url, {
      urlParams: req.urlParams,
      hash: getOrUndefined(req.hash),
      headers: fromInput({
        Authorization: pipe(req.headers, get("authorization"), getOrUndefined),
        "Client-Id": CLIENT_ID,
        "Content-Type": "application/json"
      }),
      body: req.body
    }))), mapRequestEffect((req) => succeed$1(bearerToken(req, credential.value.token.access_token))), CredentialRefresh, withTracerPropagation(false))), provide(layer));
    return yield* makeWith(HelixApi, {
      baseUrl: "https://api.twitch.tv/helix",
      httpClient
    });
  });
  const connectEventSub = fnUntraced(function* ({
    accountId
  }) {
    if (sockets.get(accountId)) return;
    const credential = yield* getCredential(accountId);
    if (isNone(credential)) return;
    const lock = unsafeMakeSemaphore(1);
    const closed = yield* make$3();
    const scope2 = yield* make$4();
    const CredentialRefresh = (c) => c.pipe(filterStatusOk, catchTags({
      ResponseError: fnUntraced(function* (e) {
        if (e.response.status === 401) {
          yield* ctx.refreshCredential("twitch", accountId);
          return yield* new RetryRequest();
        }
        return yield* fail(e);
      })
    }), retry({
      times: 1,
      while: (e) => e._tag === "RetryRequest"
    }));
    const httpClient = yield* HttpClient.pipe(map((client) => pipe(client, mapRequestEffect((req) => succeed$1(make$5(req.method)(req.url, {
      urlParams: req.urlParams,
      hash: getOrUndefined(req.hash),
      headers: fromInput({
        Authorization: pipe(req.headers, get("authorization"), getOrUndefined),
        "Client-Id": CLIENT_ID,
        "Content-Type": "application/json"
      }),
      body: req.body
    }))), mapRequestEffect((req) => gen(function* () {
      const credentials = yield* ctx.credentials.get.pipe(orDie);
      const credential2 = fromNullable(credentials.find((c) => c.id === accountId));
      return match(credential2, {
        onNone: () => req,
        onSome: (credential3) => bearerToken(req, credential3.token.access_token)
      });
    })), CredentialRefresh, withTracerPropagation(false))), provide(layer));
    const helixClient = yield* makeWith(HelixApi, {
      baseUrl: "https://api.twitch.tv/helix",
      httpClient
    });
    const socket = {
      displayName: credential.value.displayName ?? accountId,
      lock,
      state: "connecting",
      closed,
      scope: scope2
    };
    yield* sync(() => {
      sockets.set(accountId, socket);
    }).pipe(runSocketEdit);
    const getEvent = yield* never.pipe(pipeThroughChannel(makeWebSocketChannel("wss://eventsub.wss.twitch.tv/ws")), decodeText(), mapEffect((s) => decodeUnknown(parseJson(EventSubMessage.EventSubMessage))(s)), toPull, provideService(Scope, scope2));
    const firstEvent = yield* getEvent.pipe(map(get$1(0)), map(getOrThrowWith(() => new Error("Welcome event not received"))));
    if (!EventSubMessage.isType(firstEvent, "session_welcome")) return yield* new ConnectionFailed$1({
      cause: "session-welcome-expected"
    });
    const sessionId = firstEvent.payload.session.id;
    yield* gen(function* () {
      yield* deleteOldSubscriptions(helixClient);
      const enabledSubs = yield* getEnabledSubscriptions(accountId);
      const accountActiveSubs = /* @__PURE__ */ new Map();
      activeSubscriptions.set(accountId, accountActiveSubs);
      if (enabledSubs.length > 0) {
        yield* log(`Creating ${enabledSubs.length} enabled subscriptions`);
        yield* all(pipe(enabledSubs, map$3((subType) => {
          const def = getSubscriptionDef(subType);
          if (!def) return _void;
          return helixClient.createEventSubSubscription({
            payload: {
              type: def.type,
              version: def.version.toString(),
              condition: buildCondition(def, accountId),
              transport: {
                method: "websocket",
                session_id: sessionId
              }
            }
          }).pipe(tap((result) => {
            if (result?.data?.[0]?.id) {
              accountActiveSubs.set(subType, result.data[0].id);
            }
          }), withSpan("createSubscription", {
            attributes: {
              "eventsub.type": def.type
            }
          }), catchAll((error) => {
            logError(`Failed to create subscription ${subType}:`, error);
            return _void;
          }));
        })), {
          concurrency: 5
        }).pipe(withSpan("createEnabledSubscriptions"));
      } else {
        yield* log("No enabled subscriptions to create");
      }
      sockets.set(accountId, {
        ...socket,
        state: "connected",
        sessionId
      });
      yield* log("Socket Connected");
    }).pipe(ensuring(ctx.dirtyState));
    yield* fromPull(succeed$1(getEvent)).pipe(runForEach((event) => {
      const spanName = `Message.${event.metadata.message_type}`;
      return gen(function* () {
        if (EventSubMessage.isType(event, "session_welcome")) throw new Error("Unexpected session welcome");
        if (EventSubMessage.isType(event, "notification")) {
          const notif = yield* decode(SubscriptionEvent.Any)({
            _tag: event.payload.subscription.type,
            ...event.payload.event
          }).pipe(option);
          if (isSome(notif)) ctx.emitEvent(notif.value);
        }
      }).pipe(withSpan(spanName, {
        attributes: flattenObject(event)
      }));
    }), withSpan(`twitch.EventSub{${accountId}}`, {
      root: true
    }), ensuring(all([sync(() => sockets.delete(accountId)).pipe(lock.withPermits(1)), close(scope2, succeed$2(null)), ctx.dirtyState, log("Socket Disconnected"), complete(closed, _void)])), forkScoped, extend(scope2));
  });
  const disconnectEventSub = fnUntraced(function* ({
    accountId
  }) {
    const socket = sockets.get(accountId);
    if (!socket) return;
    activeSubscriptions.delete(accountId);
    yield* close(socket.scope, succeed$2(null));
    yield* _await(socket.closed);
  });
  const getSubscriptionDef = (type) => {
    return Object.values(SubscriptionEvent.Any.members).find((def) => def.type === type);
  };
  const toggleEventSubSubscription = fnUntraced(function* ({
    accountId,
    subscriptionType,
    enabled
  }) {
    const currentEnabled = yield* getEnabledSubscriptions(accountId);
    const newEnabled = enabled ? [...currentEnabled, subscriptionType] : currentEnabled.filter((t) => t !== subscriptionType);
    yield* update(enabledSubscriptionsRef, (state) => ({
      ...state,
      [accountId]: newEnabled
    }));
    if (ctx.saveState) {
      const currentState = yield* get$2(enabledSubscriptionsRef);
      yield* ctx.saveState({
        enabledSubscriptions: currentState
      });
    }
    const socket = sockets.get(accountId);
    if (socket?.state === "connected") {
      const client = yield* createHelixClient(accountId);
      const accountActiveSubs = activeSubscriptions.get(accountId);
      if (enabled) {
        const def = getSubscriptionDef(subscriptionType);
        if (!def) return;
        yield* client.createEventSubSubscription({
          payload: {
            type: def.type,
            version: def.version.toString(),
            condition: buildCondition(def, accountId),
            transport: {
              method: "websocket",
              session_id: socket.sessionId
            }
          }
        }).pipe(tap((result) => {
          if (result?.data?.[0]?.id) {
            accountActiveSubs?.set(subscriptionType, result.data[0].id);
          }
        }), catchAll((error) => {
          logError(`Failed to create subscription ${subscriptionType}:`, error);
          return _void;
        }));
      } else {
        const subId = accountActiveSubs?.get(subscriptionType);
        if (subId) {
          yield* client.deleteEventSubSubscription({
            urlParams: {
              id: subId
            }
          }).pipe(tap(() => {
            accountActiveSubs?.delete(subscriptionType);
          }), catchAll((error) => {
            logError(`Failed to delete subscription ${subId}:`, error);
            return _void;
          }));
        }
      }
    }
    yield* ctx.dirtyState;
  });
  const callHelix = (fn2) => fnUntraced(function* (args) {
    const client = yield* createHelixClient(args.accountId ?? args.account_id);
    return yield* fn2(client)({
      payload: args
    }).pipe(catchAll((cause) => fail(new TwitchAPIError({
      cause
    }))));
  });
  return {
    clientState: gen(function* () {
      const creds = yield* ctx.credentials.get;
      const subState = yield* get$2(enabledSubscriptionsRef);
      return {
        accounts: creds.filter((c) => c.provider === "twitch").map((c) => {
          const id = AccountId.make(c.id);
          return {
            id,
            displayName: c.displayName ?? c.id,
            eventSubSocket: {
              state: sockets.get(id)?.state ?? "disconnected"
            },
            enabledSubscriptions: subState[id] ?? []
          };
        })
      };
    }),
    resources: {
      TwitchEventSub: yield* LookupRef.make(sync(() => [...sockets.entries()].map(([id, socket]) => ({
        id,
        display: socket.displayName
      })))),
      TwitchAccount: yield* LookupRef.derive(ctx.credentials, (creds) => creds.filter((c) => c.provider === "twitch").map((c) => ({
        id: AccountId.make(c.id),
        display: c.displayName ?? c.id
      })))
    },
    clientRpcs: {
      ConnectEventSub: (opts) => connectEventSub(opts).pipe(catchAll((cause) => fail(new TwitchAPIError({
        cause
      }))), provide(layerWebSocketConstructorGlobal)),
      DisconnectEventSub: disconnectEventSub,
      ToggleEventSubSubscription: toggleEventSubSubscription
    },
    runtimeRpcs: {
      // All 75 Helix API RPCs
      // Each RPC calls the corresponding Helix API endpoint via the HTTP client
      // NOTE: These implementations are functional but require proper OAuth token access
      AddChannelVip: callHelix((client) => client.addChannelVip),
      BlockUser: callHelix((client) => client.blockUser),
      CancelRaid: callHelix((client) => client.cancelRaid),
      CheckUserSubscription: callHelix((client) => client.checkUserSubscription),
      CreateClip: callHelix((client) => client.createClip),
      CreateCustomReward: callHelix((client) => client.createCustomReward),
      CreatePoll: callHelix((client) => client.createPoll),
      CreatePrediction: callHelix((client) => client.createPrediction),
      CreateScheduleSegment: callHelix((client) => client.createScheduleSegment),
      CreateStreamMarker: callHelix((client) => client.createStreamMarker),
      DeleteCustomRewards: callHelix((client) => client.deleteCustomRewards),
      DeleteEventSubSubscription: callHelix((client) => client.deleteEventSubSubscription),
      DeleteScheduleSegment: callHelix((client) => client.deleteScheduleSegment),
      DeleteVideos: callHelix((client) => client.deleteVideos),
      EndPoll: callHelix((client) => client.endPoll),
      EndPrediction: callHelix((client) => client.endPrediction),
      GetBitsLeaderboard: callHelix((client) => client.getBitsLeaderboard),
      GetChannelChatBadges: callHelix((client) => client.getChannelChatBadges),
      GetChannelEditors: callHelix((client) => client.getChannelEditors),
      GetChannelEmotes: callHelix((client) => client.getChannelEmotes),
      GetChannelFollowers: callHelix((client) => client.getChannelFollowers),
      GetChannelInformation: callHelix((client) => client.getChannelInformation),
      GetChannelVips: callHelix((client) => client.getChannelVips),
      GetCharityCampaigns: callHelix((client) => client.getCharityCampaigns),
      GetCharityDonations: callHelix((client) => client.getCharityDonations),
      GetChatChatters: callHelix((client) => client.getChatChatters),
      GetChatSettings: callHelix((client) => client.getChatSettings),
      GetCheermotes: callHelix((client) => client.getCheermotes),
      GetClips: callHelix((client) => client.getClips),
      GetCreatorGoals: callHelix((client) => client.getCreatorGoals),
      GetCustomRewards: callHelix((client) => client.getCustomRewards),
      GetCustomRewardsRedemptions: callHelix((client) => client.getCustomRewardsRedemptions),
      GetDropsEntitlements: callHelix((client) => client.getDropsEntitlements),
      GetEmoteSets: callHelix((client) => client.getEmoteSets),
      GetEventSubSubscriptions: callHelix((client) => client.getEventSubSubscriptions),
      GetExtensionAnalytics: callHelix((client) => client.getExtensionAnalytics),
      GetFollowedChannels: callHelix((client) => client.getFollowedChannels),
      GetFollowedStreams: callHelix((client) => client.getFollowedStreams),
      GetGameAnalytics: callHelix((client) => client.getGameAnalytics),
      GetGames: callHelix((client) => client.getGames),
      GetGlobalChatBadges: callHelix((client) => client.getGlobalChatBadges),
      GetGlobalEmotes: callHelix((client) => client.getGlobalEmotes),
      GetHypeTrainEvents: callHelix((client) => client.getHypeTrainEvents),
      GetPolls: callHelix((client) => client.getPolls),
      GetPredictions: callHelix((client) => client.getPredictions),
      GetSchedule: callHelix((client) => client.getSchedule),
      GetStreamKey: callHelix((client) => client.getStreamKey),
      GetStreamMarkers: callHelix((client) => client.getStreamMarkers),
      GetStreams: callHelix((client) => client.getStreams),
      GetSubscriptions: callHelix((client) => client.getSubscriptions),
      GetTopGames: callHelix((client) => client.getTopGames),
      GetUserChatColor: callHelix((client) => client.getUserChatColor),
      GetUsers: callHelix((client) => client.getUsers),
      GetUsersBlocked: callHelix((client) => client.getUsersBlocked),
      GetUsersFollows: callHelix((client) => client.getUsersFollows),
      GetVideos: callHelix((client) => client.getVideos),
      ModifyChannelInformation: callHelix((client) => client.modifyChannelInformation),
      RemoveChannelVip: callHelix((client) => client.removeChannelVip),
      SearchCategories: callHelix((client) => client.searchCategories),
      SearchChannels: callHelix((client) => client.searchChannels),
      SendChatAnnouncement: callHelix((client) => client.sendChatAnnouncement),
      SendChatMessage: callHelix((client) => client.sendChatMessage),
      SendWhisper: callHelix((client) => client.sendWhisper),
      StartCommercial: callHelix((client) => client.startCommercial),
      StartRaid: callHelix((client) => client.startRaid),
      UnblockUser: callHelix((client) => client.unblockUser),
      UpdateChannelCustomRewardsRedemptionStatus: callHelix((client) => client.updateChannelCustomRewardsRedemptionStatus),
      UpdateChatSettings: callHelix((client) => client.updateChatSettings),
      UpdateCustomReward: callHelix((client) => client.updateCustomReward),
      UpdateDropsEntitlements: callHelix((client) => client.updateDropsEntitlements),
      UpdateSchedule: callHelix((client) => client.updateSchedule),
      UpdateScheduleSegment: callHelix((client) => client.updateScheduleSegment),
      UpdateUser: callHelix((client) => client.updateUser),
      UpdateUserChatColor: callHelix((client) => client.updateUserChatColor)
    }
  };
}));
const deleteOldSubscriptions = fn("deleteOldSubscriptions")(function* (helixClient) {
  const subs = yield* helixClient.getEventSubSubscriptions({
    urlParams: {}
  });
  yield* log(`Found ${subs.data.length} existing subscriptions`);
  yield* all(subs.data.map((sub) => sub.status === "websocket_disconnected" ? helixClient.deleteEventSubSubscription({
    urlParams: {
      id: sub.id
    }
  }) : _void), {
    concurrency: 10
  });
});
function flattenObject(obj, prefix = "", res = {}) {
  for (const key in obj) {
    if (key in obj) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (typeof obj[key] === "object" && obj[key] !== null && !isArray(obj[key])) {
        flattenObject(obj[key], newKey, res);
      } else {
        res[newKey] = obj[key];
      }
    }
  }
  return res;
}
const buildCondition = (def, accountId) => {
  return Object.fromEntries(Object.keys(def.condition).map((key) => [key, accountId]));
};
const util = EngineDef$2.toLayer((ctx) => gen(function* () {
  let i = 0;
  setInterval(() => {
    ctx.emitEvent(new TickEvent({
      tick: i++
    }));
  }, 1e3);
  return {
    clientState: never$1,
    resources: {},
    clientRpcs: {},
    runtimeRpcs: {}
  };
}));
const websocketClient = EngineDef$3.toLayer((ctx) => gen(function* () {
  const socketConstructor = yield* WebSocketConstructor;
  const connectionsRef = yield* make$2(empty());
  const saveState = gen(function* () {
    if (!ctx.saveState) return;
    const connectionsRecord = {};
    for (const [url] of entries(yield* connectionsRef)) {
      connectionsRecord[url] = {
        connectOnStartup: true
      };
    }
    yield* ctx.saveState(new EngineState$1({
      connections: connectionsRecord
    }));
  });
  const emitMessage = (url, data) => {
    ctx.emitEvent(new Event$1.WebSocketMessage({
      url,
      data
    }));
  };
  const createConnection = fnUntraced(function* (url) {
    const socket = yield* makeWebSocket(url, {
      openTimeout: 5e3
      // 5 second timeout
    }).pipe(provideService(WebSocketConstructor, socketConstructor), catchAll((error) => new ConnectionFailed$2({
      message: `Failed to connect to ${url}: ${error}`
    })));
    const scope2 = yield* make$4();
    const connection = {
      url,
      state: "connecting",
      reconnectAttempts: 0,
      maxReconnectAttempts: 3
    };
    yield* update(connectionsRef, set(url, connection));
    yield* saveState;
    yield* ctx.dirtyState;
    const open = yield* make$3();
    yield* socket.runRaw((data) => sync(() => {
      const messageData = typeof data === "string" ? data : "";
      emitMessage(url, messageData);
    }), {
      onOpen: done(open, succeed$2(void 0))
    }).pipe(catchTag("SocketError", (e) => gen(function* () {
      yield* update(connectionsRef, modify(url, (c) => ({
        ...c,
        state: "disconnected"
      })));
      yield* ctx.dirtyState;
      return yield* new ConnectionFailed$2({
        message: e.toString()
      });
    }).pipe(tapError((e2) => done(open, fail$1(e2))))), extend(scope2), forkDaemon);
    const writer = yield* socket.writer.pipe(extend(scope2));
    yield* _await(open);
    yield* update(connectionsRef, modify(url, (c) => ({
      ...c,
      state: "connected",
      writer
    })));
    yield* ctx.dirtyState;
    return connection;
  });
  const connectWebSocket = fnUntraced(function* (url) {
    const connections = yield* get$2(connectionsRef);
    const connectionOption = get$3(connections, url);
    if (isNone(connectionOption)) return;
    const connection = connectionOption.value;
    if (connection.state === "connected" || connection.state === "connecting") return;
    yield* update(connectionsRef, (map2) => set(map2, url, {
      ...connection,
      state: "connecting"
    }));
    yield* ctx.dirtyState;
    const newConnection = yield* createConnection(url).pipe(tapError(() => gen(function* () {
      const connections2 = yield* get$2(connectionsRef);
      const connOption = get$3(connections2, url);
      if (isSome(connOption)) {
        yield* update(connectionsRef, (map2) => set(map2, url, {
          ...connOption.value,
          state: "disconnected"
        }));
        yield* ctx.dirtyState;
      }
    })), catchAll((error) => new ConnectionFailed$2({
      message: `Failed to connect to ${url}: ${error}`
    })));
    return newConnection;
  });
  const disconnectWebSocket = fnUntraced(function* (url) {
    const connections = yield* get$2(connectionsRef);
    const connectionOption = get$3(connections, url);
    if (isNone(connectionOption)) return;
    const connection = connectionOption.value;
    if (connection.state === "connected") yield* connection.writer(new CloseEvent()).pipe(ignore);
    yield* update(connectionsRef, modify(url, (c) => ({
      ...c,
      state: "disconnected"
    })));
    yield* ctx.dirtyState;
  });
  if (ctx.initialState) {
    for (const [urlStr, value] of Object.entries(ctx.initialState.connections)) {
      const url = WebSocketUrl.make(urlStr);
      if (value.connectOnStartup) {
        yield* createConnection(url).pipe(ignore);
      }
    }
  }
  return {
    clientState: gen(function* () {
      const connections = yield* get$2(connectionsRef);
      return {
        connections: [...entries(connections)].map(([url, connection]) => ({
          name: url,
          url,
          state: connection.state
        }))
      };
    }),
    resources: {
      WebSocket: yield* LookupRef.make(gen(function* () {
        const connections = yield* get$2(connectionsRef);
        return [...keys(connections)].map((url) => ({
          id: url,
          display: url
        }));
      }))
    },
    clientRpcs: {
      AddWebSocket: fnUntraced(function* (opts) {
        const url = WebSocketUrl.make(opts.url);
        const connections = yield* get$2(connectionsRef);
        if (has(connections, url)) {
          return yield* new ConnectionFailed$2({
            message: `WebSocket ${url} already exists`
          });
        }
        yield* createConnection(url).pipe(catchTag("ConnectionFailed", (e) => new ConnectionFailed$2({
          message: e.message
        })));
        if (opts.connectOnStartup !== false) {
          yield* connectWebSocket(url).pipe(catchAll(() => _void));
        }
        yield* ctx.dirtyState;
      }),
      RemoveWebSocket: fnUntraced(function* ({
        url
      }) {
        const connections = yield* get$2(connectionsRef);
        const connectionOption = get$3(connections, url);
        if (isNone(connectionOption)) return;
        yield* update(connectionsRef, remove(url));
        yield* ctx.dirtyState;
        yield* saveState;
      }),
      ConnectWebSocket: ({
        url
      }) => connectWebSocket(url).pipe(catchTag("ConnectionFailed", (e) => new ConnectionFailed$2({
        message: e.message
      }))),
      DisconnectWebSocket: ({
        url
      }) => disconnectWebSocket(url)
    },
    runtimeRpcs: {
      SendMessage: ({
        url,
        data
      }) => gen(function* () {
        const connections = yield* get$2(connectionsRef);
        const connectionOption = get$3(connections, url);
        if (isSome(connectionOption) && connectionOption.value.state === "connected") {
          const writer = connectionOption.value.writer;
          yield* writer(data).pipe(ignore);
        }
      })
    }
  };
}));
const engines_browser = {
  obs,
  twitch,
  util,
  "websocket-client": websocketClient
};
export {
  engines_browser as default
};
