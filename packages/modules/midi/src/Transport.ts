import { Context, Effect, Layer, Scope } from "effect";

import { InputId, MidiFailure, OutputId } from "./Definition.ts";

export interface Ports {
  readonly inputs: ReadonlyArray<InputId>;
  readonly outputs: ReadonlyArray<OutputId>;
}

export interface OutputPort {
  readonly send: (data: ReadonlyArray<number>) => Effect.Effect<void, MidiFailure>;
}

/** System MIDI ports. Port IDs are names, suffixed with `#n` when several ports share a name. */
export class Service extends Context.Service<
  Service,
  {
    readonly ports: Effect.Effect<Ports, MidiFailure>;
    readonly openInput: (
      id: InputId,
      onMessage: (data: ReadonlyArray<number>) => void,
    ) => Effect.Effect<void, MidiFailure, Scope.Scope>;
    readonly openOutput: (id: OutputId) => Effect.Effect<OutputPort, MidiFailure, Scope.Scope>;
  }
>()("@macrograph/module-midi/Transport") {}

export const uniqueNames = (names: ReadonlyArray<string>) => {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} #${count}`;
  });
};

const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const attempt = <A>(label: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new MidiFailure({ reason: `${label}: ${reason(cause)}` }),
  });

interface NativePort {
  getPortCount(): number;
  getPortName(port: number): string;
  openPort(port: number): void;
  closePort(): void;
  destroy(): void;
}

const portNames = (port: NativePort) =>
  uniqueNames(Array.from({ length: port.getPortCount() }, (_, index) => port.getPortName(index)));

const openPort = <Port extends NativePort>(port: Port, id: string, kind: string) => {
  try {
    const index = portNames(port).indexOf(id);
    if (index < 0) throw new Error(`MIDI ${kind} not connected: ${id}`);
    port.openPort(index);
    return port;
  } catch (error) {
    port.destroy();
    throw error;
  }
};

const release = (port: NativePort) =>
  Effect.sync(() => {
    try {
      port.closePort();
      port.destroy();
    } catch {
      // The device may already be gone; there is nothing left to release.
    }
  });

export const unavailable = (error: MidiFailure) =>
  Service.of({
    ports: Effect.fail(error),
    openInput: () => Effect.fail(error),
    openOutput: () => Effect.fail(error),
  });

/** RtMidi via `@julusian/midi`. Loads lazily so hosts without the native addon still start. */
export const layerNative = Layer.effect(Service)(
  Effect.tryPromise({
    try: () => import("@julusian/midi"),
    catch: (cause) =>
      new MidiFailure({ reason: `Native MIDI support is unavailable: ${reason(cause)}` }),
  }).pipe(
    Effect.map((midi) =>
      Service.of({
        ports: attempt("Failed to list MIDI ports", () => ({
          inputs: uniqueNames(midi.Input.getPortNames()).map((name) => InputId.make(name)),
          outputs: uniqueNames(midi.Output.getPortNames()).map((name) => OutputId.make(name)),
        })),
        openInput: (id, onMessage) =>
          Effect.acquireRelease(
            attempt(`Failed to open MIDI input ${id}`, () => {
              const input = new midi.Input();
              // Receive SysEx; drop clock and active-sensing traffic.
              input.ignoreTypes(false, true, true);
              input.on("message", (_deltaTime, message) => onMessage(message));
              return openPort(input, id, "input");
            }),
            (input) =>
              Effect.sync(() => input.removeAllListeners()).pipe(Effect.andThen(release(input))),
          ).pipe(Effect.asVoid),
        openOutput: (id) =>
          Effect.acquireRelease(
            attempt(`Failed to open MIDI output ${id}`, () =>
              openPort(new midi.Output(), id, "output"),
            ),
            release,
          ).pipe(
            Effect.map((output) => ({
              send: (data) =>
                attempt(`Failed to send to MIDI output ${id}`, () => output.sendMessage([...data])),
            })),
          ),
      }),
    ),
    Effect.catch((error) => Effect.succeed(unavailable(error))),
  ),
);
