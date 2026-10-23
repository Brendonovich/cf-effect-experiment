import {
  Effect,
  Exit,
  FiberMap,
  Layer,
  Queue,
  Result,
  Schedule,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";

import {
  ClientRpcs,
  type ClientState,
  type InputId,
  MidiEngine,
  MidiFailure,
  MidiInput,
  MidiMessage,
  MidiOutput,
  type OutputId,
  RuntimeRpcs,
} from "./Definition.ts";
import { validateRaw } from "./Protocol.ts";
import * as Transport from "./Transport.ts";

export const SCAN_INTERVAL = "2 seconds";

type State = {
  readonly ports: Transport.Ports;
  readonly error: string | undefined;
  readonly listening: ReadonlyArray<InputId>;
  readonly inputErrors: ReadonlyMap<InputId, string>;
  readonly openOutputs: ReadonlyArray<OutputId>;
};

const sameIds = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

export const runtimeLayer = MidiEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const transport = yield* Transport.Service;
    const engineScope = yield* Effect.scope;
    const lock = yield* Semaphore.make(1);
    const listeners = yield* FiberMap.make<InputId>();
    const started = new Set<InputId>();
    const outputs = new Map<
      OutputId,
      { readonly port: Transport.OutputPort; readonly scope: Scope.Closeable }
    >();
    const state = yield* SubscriptionRef.make<State>({
      ports: { inputs: [], outputs: [] },
      error: undefined,
      listening: [],
      inputErrors: new Map(),
      openOutputs: [],
    });
    yield* Stream.runForEach(SubscriptionRef.changes(state), () => mg.client.refresh).pipe(
      Effect.forkScoped,
    );
    const update = (f: (state: State) => State) => SubscriptionRef.update(state, f);
    const setInputError = (id: InputId, error: string | undefined) =>
      update((current) => {
        const inputErrors = new Map(current.inputErrors);
        if (error === undefined) inputErrors.delete(id);
        else inputErrors.set(id, error);
        return { ...current, inputErrors };
      });

    const listen = (id: InputId) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ReadonlyArray<number>>();
        yield* transport.openInput(id, (data) => {
          Queue.offerUnsafe(queue, data);
        });
        yield* setInputError(id, undefined);
        yield* update((current) => ({ ...current, listening: [...current.listening, id] }));
        return yield* Queue.take(queue).pipe(
          Effect.flatMap((data) => mg.emit(new MidiMessage({ inputId: id, data: [...data] }))),
          Effect.forever,
        );
      }).pipe(
        Effect.scoped,
        Effect.catch((error) => setInputError(id, error.reason)),
        Effect.ensuring(
          update((current) => ({
            ...current,
            listening: current.listening.filter((entry) => entry !== id),
          })),
        ),
      );

    // Opens enabled, connected inputs and closes the rest. Failed inputs are not retried
    // until they reconnect, are re-enabled, or a rescan is requested.
    const reconcile = Effect.gen(function* () {
      const { enabledInputs } = yield* mg.storage.get;
      const current = yield* SubscriptionRef.get(state);
      const wanted = enabledInputs.filter((id) => current.ports.inputs.includes(id));
      for (const id of started)
        if (!wanted.includes(id)) {
          started.delete(id);
          yield* FiberMap.remove(listeners, id);
        }
      for (const id of wanted)
        if (!current.inputErrors.has(id) && !(yield* FiberMap.has(listeners, id))) {
          started.add(id);
          yield* FiberMap.run(listeners, id, { onlyIfMissing: true })(listen(id));
        }
    });

    const closeOutput = (id: OutputId) =>
      Effect.gen(function* () {
        const entry = outputs.get(id);
        if (!entry) return;
        outputs.delete(id);
        yield* Scope.close(entry.scope, Exit.void);
        yield* update((current) => ({
          ...current,
          openOutputs: current.openOutputs.filter((output) => output !== id),
        }));
      });

    const scan = (force: boolean) =>
      Effect.gen(function* () {
        const result = yield* Effect.result(transport.ports);
        const current = yield* SubscriptionRef.get(state);
        if (Result.isFailure(result)) {
          if (current.error !== result.failure.reason)
            yield* update((state) => ({ ...state, error: result.failure.reason }));
          return;
        }
        const ports = result.success;
        const changed =
          current.error !== undefined ||
          !sameIds(current.ports.inputs, ports.inputs) ||
          !sameIds(current.ports.outputs, ports.outputs);
        if (changed || force) {
          for (const id of outputs.keys()) if (!ports.outputs.includes(id)) yield* closeOutput(id);
          yield* update((state) => ({
            ...state,
            ports,
            error: undefined,
            inputErrors: force
              ? new Map()
              : new Map([...state.inputErrors].filter(([id]) => ports.inputs.includes(id))),
          }));
          yield* mg.resource.refresh(MidiInput);
          yield* mg.resource.refresh(MidiOutput);
        }
        yield* reconcile;
      }).pipe(lock.withPermit);

    const output = (id: OutputId) =>
      Effect.gen(function* () {
        const existing = outputs.get(id);
        if (existing) return existing.port;
        const { ports, error } = yield* SubscriptionRef.get(state);
        if (error !== undefined) return yield* new MidiFailure({ reason: error });
        if (!ports.outputs.includes(id))
          return yield* new MidiFailure({ reason: `MIDI output not connected: ${id}` });
        const scope = yield* Scope.fork(engineScope);
        const port = yield* transport.openOutput(id).pipe(
          Scope.provide(scope),
          Effect.tapError(() => Scope.close(scope, Exit.void)),
        );
        outputs.set(id, { port, scope });
        yield* update((current) => ({ ...current, openOutputs: [...current.openOutputs, id] }));
        return port;
      });

    const send = (id: OutputId, data: ReadonlyArray<number>) =>
      Effect.gen(function* () {
        const bytes = yield* validateRaw(data);
        const port = yield* output(id);
        yield* port.send(bytes).pipe(Effect.tapError(() => closeOutput(id)));
      }).pipe(lock.withPermit);

    yield* scan(false);
    yield* Effect.sleep(SCAN_INTERVAL).pipe(
      Effect.andThen(scan(false).pipe(Effect.repeat(Schedule.spaced(SCAN_INTERVAL)))),
      Effect.forkScoped,
    );

    const clientState = Effect.gen(function* () {
      const { enabledInputs } = yield* mg.storage.get;
      const current = yield* SubscriptionRef.get(state);
      const ids = [...current.ports.inputs];
      for (const id of enabledInputs) if (!ids.includes(id)) ids.push(id);
      const error = current.error;
      return {
        available: error === undefined,
        ...(error === undefined ? {} : { error }),
        inputs: ids.map((id) => {
          const inputError = current.inputErrors.get(id);
          return {
            id,
            connected: current.ports.inputs.includes(id),
            enabled: enabledInputs.includes(id),
            listening: current.listening.includes(id),
            ...(inputError === undefined ? {} : { error: inputError }),
          };
        }),
        outputs: current.ports.outputs.map((id) => ({
          id,
          open: current.openOutputs.includes(id),
        })),
      } satisfies ClientState;
    });

    return MidiEngine.of({
      resources: Layer.mergeAll(
        MidiInput.toLayer(
          Effect.gen(function* () {
            const { enabledInputs } = yield* mg.storage.get;
            const { ports } = yield* SubscriptionRef.get(state);
            return enabledInputs.map((id) => ({
              id,
              display: ports.inputs.includes(id) ? id : `${id} (disconnected)`,
            }));
          }),
        ),
        MidiOutput.toLayer(
          SubscriptionRef.get(state).pipe(
            Effect.map(({ ports }) => ports.outputs.map((id) => ({ id, display: id }))),
          ),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({
        MidiSend: ({ outputId, data }) => send(outputId, data),
      }),
      client: {
        state: clientState,
        rpcs: ClientRpcs.toLayer({
          MidiSetInputEnabled: ({ id, enabled }) =>
            Effect.gen(function* () {
              yield* mg.storage.update(({ enabledInputs }) => ({
                enabledInputs: enabled
                  ? enabledInputs.includes(id)
                    ? enabledInputs
                    : [...enabledInputs, id]
                  : enabledInputs.filter((entry) => entry !== id),
              }));
              yield* setInputError(id, undefined);
              yield* reconcile;
              yield* mg.resource.refresh(MidiInput);
              yield* mg.client.refresh;
            }).pipe(lock.withPermit),
          MidiRescan: () => scan(true),
        }),
      },
    });
  }),
);

export const layer = runtimeLayer.pipe(Layer.provide(Transport.layerNative));
export default layer;
