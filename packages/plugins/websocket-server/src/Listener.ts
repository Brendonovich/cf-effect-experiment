import { Context, Effect, Schema, type Scope } from "effect";

export class ListenerError extends Schema.TaggedError<ListenerError>()(
  "WebSocketListenerError",
  { reason: Schema.String },
) {}

export interface Client {
  readonly closed: Effect.Effect<void>;
  readonly send: (message: string) => Effect.Effect<void, ListenerError>;
  readonly run: (
    onMessage: (message: unknown) => Effect.Effect<void>,
  ) => Effect.Effect<void, ListenerError>;
}

export interface Listener {
  readonly run: (
    onClient: (client: Client) => Effect.Effect<void>,
  ) => Effect.Effect<never, ListenerError, Scope.Scope>;
}

export class Adapter extends Context.Service<
  Adapter,
  {
    readonly listen: (options: {
      readonly host: string;
      readonly port: number;
      readonly maxMessageBytes: number;
      readonly maxBufferedBytes: number;
      readonly maxPendingMessages: number;
    }) => Effect.Effect<Listener, ListenerError, Scope.Scope>;
  }
>()("@macrograph/plugin-websocket-server/ListenerAdapter") {}

export * as ListenerAdapter from "./Listener.ts";
