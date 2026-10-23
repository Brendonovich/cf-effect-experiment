import { Effect } from "effect";

import type { Instance, Instances } from "./Instance.ts";

import {
  ClientRpcs,
  type Connection,
  ConnectionId,
  type ConnectionState,
  type ConnectionTarget,
  type ConnectionTargetInput,
  OpenCodeConnection,
  OpenCodeEngine,
  RequestFailure,
  RuntimeRpcs,
} from "./Definition.ts";

const summary = (target: ConnectionTarget) =>
  target.type === "remote" ? { type: "remote" as const, url: target.url } : target;

const reasonOf = (error: unknown) =>
  error instanceof RequestFailure ? error.reason : "OpenCode request failed";

const newConnectionId = () => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return ConnectionId.make(
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
};

export const makeLayer = (instances: Instances) =>
  OpenCodeEngine.toLayer((context) => {
    const connections = context.storage.get.pipe(Effect.map((storage) => storage.connections));
    const lookup = (connectionId: ConnectionId) =>
      connections.pipe(
        Effect.flatMap((all) => {
          const connection = all[connectionId];
          return connection === undefined
            ? Effect.fail(
                new RequestFailure({
                  reason: `OpenCode connection ${connectionId} does not exist`,
                }),
              )
            : Effect.succeed(connection);
        }),
      );
    const resolve = (connectionId: ConnectionId) =>
      lookup(connectionId).pipe(
        Effect.flatMap((connection) =>
          instances.resolve({ id: connectionId, target: connection.target }),
        ),
      );
    const using = <A>(
      connectionId: ConnectionId,
      f: (instance: Instance) => Effect.Effect<A, RequestFailure>,
    ) => resolve(connectionId).pipe(Effect.flatMap(f));
    const validate = (target: ConnectionTarget) => {
      if (!instances.connectionTypes.includes(target.type))
        return Effect.fail(
          new RequestFailure({
            reason: `${target.type} OpenCode connections are unavailable in this deployment`,
          }),
        );
      if (target.type === "managed")
        return Effect.try({
          try: () => JSON.parse(target.config) as unknown,
          catch: () => new RequestFailure({ reason: "OpenCode config must be valid JSON" }),
        }).pipe(Effect.asVoid);
      return Effect.void;
    };
    const changed = Effect.all(
      [context.resource.refresh(OpenCodeConnection), context.client.refresh],
      {
        discard: true,
      },
    );
    const save = (connectionId: ConnectionId, connection: Connection) =>
      validate(connection.target).pipe(
        Effect.andThen(instances.resolve({ id: connectionId, target: connection.target })),
        Effect.andThen(
          context.storage.update((storage) => ({
            connections: { ...storage.connections, [connectionId]: connection },
          })),
        ),
        Effect.andThen(changed),
      );
    const withStoredPassword = (
      previous: Connection | undefined,
      target: ConnectionTargetInput,
    ): ConnectionTarget =>
      target.type !== "remote"
        ? target
        : {
            type: "remote",
            url: target.url,
            password:
              target.password ??
              (previous?.target.type === "remote" ? previous.target.password : ""),
          };
    const describe = (
      connectionId: ConnectionId,
      connection: Connection,
    ): Effect.Effect<ConnectionState> =>
      instances.resolve({ id: connectionId, target: connection.target }).pipe(
        Effect.flatMap((instance) =>
          Effect.all([instance.listCredentials, instance.listOAuthMethods]).pipe(
            Effect.map(([credentials, oauthMethods]) => ({
              status:
                connection.target.type === "managed" &&
                instance.appliedConfig !== undefined &&
                instance.appliedConfig !== connection.target.config
                  ? { state: "ready" as const, appliedConfig: instance.appliedConfig }
                  : { state: "ready" as const },
              credentials,
              oauthMethods,
            })),
          ),
        ),
        Effect.catch((error) =>
          Effect.succeed({
            status: { state: "error" as const, message: reasonOf(error) },
            credentials: [],
            oauthMethods: [],
          }),
        ),
        Effect.map((state) => ({
          id: connectionId,
          name: connection.name,
          target: summary(connection.target),
          ...state,
        })),
      );

    return Effect.succeed(
      OpenCodeEngine.of({
        resources: OpenCodeConnection.toLayer(
          connections.pipe(
            Effect.map((all) =>
              Object.entries(all).map(([id, connection]) => ({
                id: ConnectionId.make(id),
                display: connection.name,
              })),
            ),
          ),
        ),
        rpcs: RuntimeRpcs.toLayer({
          OpenCodeGenerateText: ({ connectionId, prompt, model }) =>
            using(connectionId, (instance) => instance.generateText({ prompt, model })),
          OpenCodeListModels: ({ connectionId }) =>
            using(connectionId, (instance) => instance.listModels),
        }),
        client: {
          state: connections.pipe(
            Effect.flatMap((all) =>
              Effect.forEach(
                Object.entries(all),
                ([id, connection]) => describe(ConnectionId.make(id), connection),
                { concurrency: "unbounded" },
              ),
            ),
            Effect.map((states) => ({
              connectionTypes: instances.connectionTypes,
              connections: states,
            })),
          ),
          rpcs: ClientRpcs.toLayer({
            OpenCodeCreateConnection: ({ name, target }) => {
              const connectionId = newConnectionId();
              return save(connectionId, { name: name.trim() || "OpenCode", target }).pipe(
                Effect.as(connectionId),
              );
            },
            OpenCodeUpdateConnection: ({ connectionId, name, target }) =>
              lookup(connectionId).pipe(
                Effect.flatMap((previous) =>
                  save(connectionId, {
                    name: name.trim() || previous.name,
                    target: withStoredPassword(previous, target),
                  }),
                ),
              ),
            OpenCodeRemoveConnection: ({ connectionId }) =>
              context.storage
                .update((storage) => ({
                  connections: Object.fromEntries(
                    Object.entries(storage.connections).filter(([id]) => id !== connectionId),
                  ),
                }))
                .pipe(Effect.andThen(changed)),
            OpenCodeConnectKey: ({ connectionId, ...input }) =>
              using(connectionId, (instance) => instance.connectKey(input)).pipe(
                Effect.andThen(context.client.refresh),
              ),
            OpenCodeRemoveCredential: ({ connectionId, credentialID }) =>
              using(connectionId, (instance) => instance.removeCredential(credentialID)).pipe(
                Effect.andThen(context.client.refresh),
              ),
            OpenCodeStartOAuth: ({ connectionId, ...input }) =>
              using(connectionId, (instance) => instance.startOAuth(input)),
            OpenCodeOAuthStatus: ({ connectionId, ...input }) =>
              using(connectionId, (instance) => instance.oauthStatus(input)).pipe(
                Effect.tap((status) =>
                  status.status === "complete" ? context.client.refresh : Effect.void,
                ),
              ),
            OpenCodeCompleteOAuth: ({ connectionId, ...input }) =>
              using(connectionId, (instance) => instance.completeOAuth(input)).pipe(
                Effect.andThen(context.client.refresh),
              ),
            OpenCodeCancelOAuth: ({ connectionId, ...input }) =>
              using(connectionId, (instance) => instance.cancelOAuth(input)),
          }),
        },
      }),
    );
  });
